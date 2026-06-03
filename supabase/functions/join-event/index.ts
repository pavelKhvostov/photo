// Edge Function: join-event — вступление гостя в событие.
// Контракт: SPECIFICATION.md §6.3 («Вступление гостя»), edge cases §9 п.2, п.3, п.6.
//
// POST (концептуально POST /events/:short_code/join), авторизация — анонимный JWT гостя.
// short_code принимаем из тела запроса, чтобы не зависеть от роутинга путей.
//
// Тело:
//   { "short_code": "k7p2qx", "display_name": "Дима",
//     "consent": { "policy_version": "2026-06-01", "purpose": "photo_upload" } }
// Успех 201 (новый) / 200 (идемпотентный повтор):
//   { "guest_id", "event_id", "shots_left", "reveal_at" | null,
//     "starts_at" | null, "camera_style" }
//
// Функция работает под service-role (обходит RLS) и сама проверяет права/лимиты:
//  - права гостя извлекаются из anon-JWT (auth.getUser);
//  - consent пишется ДО создания гостя (152-ФЗ: IP/UA из заголовков);
//  - лимит гостей берётся из таблицы plans (не хардкод);
//  - идемпотентность по (event_id, auth_uid).
//
// СТАРТ СОБЫТИЯ (§9 п.3): вступление ДО starts_at РАЗРЕШЕНО — гость может зайти на
// лендинг и ждать. В ответ кладём starts_at (или null), чтобы клиент блокировал
// съёмку и показывал отсчёт. Серверный запрет съёмки — в upload-url.
//
// АТОМАРНОСТЬ ЛИМИТА (QA HIGH): подсчёт гостей и insert нового выполняются в одной
// security-definer RPC join_guest_atomic под транзакционным advisory-lock по event_id
// (миграция 0003) — нет окна гонки между count и insert.
//
// ОТЗЫВ СОГЛАСИЯ (152-ФЗ): при идемпотентном повторе проверяем, не отозвано ли
// согласие гостя (consents.revoked_at) и не пустой ли consent_id. Если согласие
// недействительно — НЕ выдаём рабочую сессию молча: переоформляем согласие из
// тела текущего запроса (purpose/policy_version уже провалидированы, IP/UA из
// заголовков), обновляем guests.consent_id и только тогда возвращаем сессию.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersFor, handlePreflight } from "../_shared/cors.ts";
import { jsonError, jsonOk } from "../_shared/errors.ts";

// Очень большое число для безлимитных планов (plans.shots_per_guest == 0).
const UNLIMITED_SHOTS = 1_000_000;

interface ConsentBody {
  policy_version?: unknown;
  purpose?: unknown;
}

interface JoinBody {
  short_code?: unknown;
  display_name?: unknown;
  consent?: ConsentBody | null;
}

// Достаёт IP клиента из заголовков прокси.
function clientIp(req: Request): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("cf-connecting-ip");
}

Deno.serve(async (req: Request): Promise<Response> => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  // M5: origin-зависимые CORS-заголовки.
  const cors = corsHeadersFor(req);

  if (req.method !== "POST") {
    return jsonError("method_not_allowed", "Только POST.", 405, cors);
  }

  // 1. Авторизация: анонимный JWT гостя.
  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!jwt) {
    return jsonError("unauthorized", "Отсутствует Bearer-токен.", 401, cors);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return jsonError("server_misconfigured", "Сервер не настроен.", 500, cors);
  }

  // service-role клиент: обходит RLS, проверки делаем сами.
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: userData, error: userErr } = await supabase.auth.getUser(jwt);
  if (userErr || !userData?.user) {
    return jsonError("unauthorized", "Невалидный токен гостя.", 401, cors);
  }
  const authUid = userData.user.id;

  // 2. Парсинг и валидация тела.
  let body: JoinBody;
  try {
    body = await req.json() as JoinBody;
  } catch {
    return jsonError("validation", "Тело запроса должно быть JSON.", 422, cors);
  }

  const shortCode = typeof body.short_code === "string"
    ? body.short_code.trim()
    : "";
  if (!shortCode) {
    return jsonError("validation", "Поле short_code обязательно.", 422, cors);
  }

  const displayName = typeof body.display_name === "string"
    ? body.display_name.trim()
    : "";
  if (displayName.length < 1 || displayName.length > 60) {
    return jsonError(
      "validation",
      "display_name должен быть от 1 до 60 символов.",
      422,
      cors
    );
  }

  // consent — отдельный код ошибки (consent_required), 152-ФЗ.
  const consent = body.consent;
  const policyVersion =
    consent && typeof consent.policy_version === "string"
      ? consent.policy_version.trim()
      : "";
  const purpose = consent && typeof consent.purpose === "string"
    ? consent.purpose
    : "";
  if (!consent || purpose !== "photo_upload" || !policyVersion) {
    return jsonError(
      "consent_required",
      "Требуется согласие на загрузку фото (purpose=photo_upload, policy_version).",
      422,
      cors
    );
  }

  // 3. Поиск события по short_code.
  const { data: event, error: eventErr } = await supabase
    .from("events")
    .select("id, status, plan, shots_per_guest, reveal_at, starts_at, camera_style")
    .eq("short_code", shortCode)
    .maybeSingle();

  if (eventErr) {
    return jsonError("server_error", "Ошибка чтения события.", 500, cors);
  }
  if (!event) {
    return jsonError("not_found", "Событие не найдено.", 404, cors);
  }

  // 4. Статус события.
  if (event.status === "archived" || event.status === "deleted") {
    return jsonError("event_closed", "Событие закрыто.", 410, cors);
  }
  if (event.status === "draft") {
    const { error: liveErr } = await supabase
      .from("events")
      .update({ status: "live" })
      .eq("id", event.id)
      .eq("status", "draft"); // не перетираем, если статус уже сменился
    if (liveErr) {
      return jsonError("server_error", "Не удалось активировать событие.", 500, cors);
    }
  }

  // Лимиты плана — из таблицы plans (не хардкод).
  const { data: plan, error: planErr } = await supabase
    .from("plans")
    .select("max_guests, shots_per_guest")
    .eq("code", event.plan)
    .maybeSingle();
  if (planErr || !plan) {
    return jsonError("server_error", "Тариф события не найден.", 500, cors);
  }

  // Подсчёт shots_left для гостя.
  const computeShotsLeft = async (guestId: string): Promise<number> => {
    // Безлимитный план → безлимит кадров.
    if (plan.shots_per_guest === 0) return UNLIMITED_SHOTS;
    const { count } = await supabase
      .from("photos")
      .select("id", { count: "exact", head: true })
      .eq("guest_id", guestId)
      .eq("uploaded", true);
    const uploaded = count ?? 0;
    const left = event.shots_per_guest - uploaded;
    return left > 0 ? left : 0;
  };

  // Записывает НОВОЕ согласие гостя (152-ФЗ: IP/UA/policy_version из текущего запроса).
  // Возвращает id строки consents или null при ошибке.
  const writeConsent = async (): Promise<string | null> => {
    const { data: row, error } = await supabase
      .from("consents")
      .insert({
        subject_uid: authUid,
        subject_type: "guest",
        purpose: "photo_upload",
        policy_version: policyVersion,
        ip: clientIp(req),
        user_agent: req.headers.get("user-agent"),
      })
      .select("id")
      .single();
    if (error || !row) return null;
    return row.id as string;
  };

  // 5. Идемпотентность по (event_id, auth_uid).
  // Подтягиваем существующего гостя ВМЕСТЕ с его согласием (consent_id → revoked_at),
  // чтобы проверить действительность согласия до выдачи сессии (152-ФЗ).
  const { data: existing, error: existingErr } = await supabase
    .from("guests")
    .select("id, consent_id, consents:consent_id (revoked_at)")
    .eq("event_id", event.id)
    .eq("auth_uid", authUid)
    .maybeSingle();
  if (existingErr) {
    return jsonError("server_error", "Ошибка проверки гостя.", 500, cors);
  }

  // Идемпотентный ответ существующего гостя с проверкой/переоформлением согласия.
  // consentJoin — связанная строка consents (или null, если consent_id пуст).
  const respondExisting = async (
    guestId: string,
    consentId: string | null,
    consentJoin: { revoked_at: string | null } | null,
  ): Promise<Response> => {
    const consentInvalid = !consentId || !consentJoin ||
      consentJoin.revoked_at !== null;

    if (consentInvalid) {
      // 152-ФЗ: согласие отозвано или отсутствует — нельзя молча выдавать сессию.
      // Тело запроса содержит свежее согласие (purpose=photo_upload + policy_version,
      // уже провалидированы выше). Переоформляем: пишем НОВЫЙ consent с IP/UA из
      // текущего запроса и перепривязываем guests.consent_id. Это корректно по 152-ФЗ —
      // гость заново выразил согласие в этом же запросе, UX не ломается.
      const newConsentId = await writeConsent();
      if (!newConsentId) {
        return jsonError(
          "server_error",
          "Не удалось переоформить согласие.",
          500,
          cors
        );
      }
      const { error: updErr } = await supabase
        .from("guests")
        .update({ consent_id: newConsentId })
        .eq("id", guestId);
      if (updErr) {
        return jsonError(
          "server_error",
          "Не удалось обновить согласие гостя.",
          500,
          cors
        );
      }
    }

    const shotsLeft = await computeShotsLeft(guestId);
    return jsonOk({
      guest_id: guestId,
      event_id: event.id,
      shots_left: shotsLeft,
      reveal_at: event.reveal_at ?? null,
      starts_at: event.starts_at ?? null,
      camera_style: event.camera_style,
    }, 200,
    cors);
  };

  if (existing) {
    // PostgREST возвращает join либо объектом, либо массивом — нормализуем.
    const rawJoin = (existing as { consents?: unknown }).consents;
    const consentJoin = Array.isArray(rawJoin)
      ? (rawJoin[0] as { revoked_at: string | null } | undefined) ?? null
      : (rawJoin as { revoked_at: string | null } | null) ?? null;
    return await respondExisting(
      existing.id as string,
      (existing.consent_id as string | null) ?? null,
      consentJoin,
    );
  }

  // 6. Согласие пишем ДО создания гостя (152-ФЗ: IP/UA из заголовков).
  const consentId = await writeConsent();
  if (!consentId) {
    return jsonError("server_error", "Не удалось зафиксировать согласие.", 500, cors);
  }

  // 7. Атомарное вступление: проверка лимита + insert под advisory-lock (миграция 0003).
  // Исключает гонку count↔insert между параллельными join (QA HIGH).
  const { data: rpcRows, error: rpcErr } = await supabase.rpc(
    "join_guest_atomic",
    {
      p_event_id: event.id,
      p_auth_uid: authUid,
      p_display_name: displayName,
      p_consent_id: consentId,
      p_max_guests: plan.max_guests,
    },
  );
  if (rpcErr) {
    return jsonError("server_error", "Не удалось создать гостя.", 500, cors);
  }

  const result = Array.isArray(rpcRows) ? rpcRows[0] : rpcRows;
  if (!result) {
    return jsonError("server_error", "Не удалось создать гостя.", 500, cors);
  }

  // 7a. Лимит гостей достигнут — гость НЕ вставлен.
  if (result.limit_reached) {
    return jsonError(
      "guests_limit_reached",
      "Достигнут лимит гостей по тарифу события.",
      409,
      cors
    );
  }

  // 7b. Гонка под локом: гость уже существовал (вставлен параллельным запросом).
  // Согласие тут только что записано (шаг 6) и привязано к гостю не было — но гость
  // создавался ДРУГИМ запросом со своим consent. Проверяем действительность того
  // согласия и при необходимости переоформляем (152-ФЗ), как в идемпотентной ветке.
  if (result.raced) {
    const { data: racedRow } = await supabase
      .from("guests")
      .select("id, consent_id, consents:consent_id (revoked_at)")
      .eq("id", result.guest_id)
      .maybeSingle();
    if (!racedRow) {
      return jsonError("server_error", "Не удалось создать гостя.", 500, cors);
    }
    const rawJoin = (racedRow as { consents?: unknown }).consents;
    const consentJoin = Array.isArray(rawJoin)
      ? (rawJoin[0] as { revoked_at: string | null } | undefined) ?? null
      : (rawJoin as { revoked_at: string | null } | null) ?? null;
    return await respondExisting(
      racedRow.id as string,
      (racedRow.consent_id as string | null) ?? null,
      consentJoin,
    );
  }

  // 8. Новый гость успешно создан (uploaded = 0).
  const shotsLeft = plan.shots_per_guest === 0
    ? UNLIMITED_SHOTS
    : event.shots_per_guest;

  return jsonOk({
    guest_id: result.guest_id,
    event_id: event.id,
    shots_left: shotsLeft,
    reveal_at: event.reveal_at ?? null,
    starts_at: event.starts_at ?? null,
    camera_style: event.camera_style,
  }, 201,
  cors);
});
