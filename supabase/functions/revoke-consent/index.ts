// Edge Function: revoke-consent — отзыв согласия субъекта (152-ФЗ).
// Контракт: SPECIFICATION.md §6.5 («Отозвать согласие»), edge case §9 п.8.
//
// POST { "consent_id": "..." }, JWT субъекта (гостя или хоста).
// Успех 200: { ok: true, photos_removed: N, guests_removed: M }
//            либо { ok: true, already_revoked: true } при идемпотентном повторе.
//
// Функция под service-role (обходит RLS) и САМА проверяет права:
//   - субъект может отозвать ТОЛЬКО своё согласие (consents.subject_uid == auth_uid);
//   - повторный отзыв — идемпотентный no-op (revoked_at уже проставлен).
//
// КАСКАД (§6.5): отзыв согласия → физическое удаление ВСЕХ фото СУБЪЕКТА (объекты
// Storage + строки photos) и удаление строк guests субъекта. Каскад строится по
// subject_uid согласия (= auth_uid субъекта), НЕ по guests.consent_id: у гостя
// consent_id может быть NULL, либо субъект может быть гостем в нескольких событиях.
// Привязка по consent_id раньше пропускала такие фото — это нарушало «удаление ЕГО
// photos» из §6.5. Поэтому удаляем по субъекту: все его guests во всех событиях.
// (FK photos.guest_id on delete cascade снесёт его photos при удалении guests.)
//
// ПОРЯДОК (инвариант 152-ФЗ): объекты Storage удаляются ДО строк БД — иначе теряем
// storage_path и объекты осиротеют в приватном бакете. Один сбой Storage не валит
// весь прогон (try/catch, ошибки копим в errors[]), но в этом случае строки гостей
// НЕ удаляем (RPC не вызываем) — согласие остаётся неотозванным, повторный вызов
// идемпотентно дочистит остаток.
//
// АТОМАРНОСТЬ (H3): БД-мутации (delete guests + set consents.revoked_at + insert
// deletion_requests) выполняются ОДНОЙ security-definer транзакцией revoke_consent_atomic
// (миграция 0005, по образцу join_guest_atomic в 0003). Storage-удаление — здесь, ДО RPC.
//
// АУДИТ (H1): пишется внутри RPC в deletion_requests как
// { subject_uid, scope='guest', target_id=NULL, processed_at=now() }. target_id=NULL
// потому что удаляется субъект целиком, а не один конкретный гость; класть consent_id
// в target_id (поле под uuid гостя) было бы искажением аудита. CHECK схемы
// (scope in photo/guest/account) не меняем. Сбой записи аудита → ошибка транзакции
// → 500 (клиент узнаёт, что отзыв не зафиксирован), а не молчаливое игнорирование.

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersFor, handlePreflight } from "../_shared/cors.ts";
import { jsonError, jsonOk } from "../_shared/errors.ts";

const BUCKET = "event-photos";
const REMOVE_BATCH = 1000; // объектов за один storage.remove

interface RevokeBody {
  consent_id?: unknown;
}

Deno.serve(async (req: Request): Promise<Response> => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  // M5: origin-зависимые CORS-заголовки.
  const cors = corsHeadersFor(req);

  if (req.method !== "POST") {
    return jsonError("method_not_allowed", "Только POST.", 405, cors);
  }

  // 1. Авторизация: JWT субъекта.
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

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: userData, error: userErr } = await supabase.auth.getUser(jwt);
  if (userErr || !userData?.user) {
    return jsonError("unauthorized", "Невалидный токен.", 401, cors);
  }
  const authUid = userData.user.id;

  // 2. Валидация тела.
  let body: RevokeBody;
  try {
    body = await req.json() as RevokeBody;
  } catch {
    return jsonError("validation", "Тело запроса должно быть JSON.", 422, cors);
  }
  const consentId = typeof body.consent_id === "string"
    ? body.consent_id.trim()
    : "";
  if (!consentId) {
    return jsonError("validation", "Поле consent_id обязательно.", 422, cors);
  }

  // 3. Поиск согласия.
  const { data: consent, error: consentErr } = await supabase
    .from("consents")
    .select("id, subject_uid, revoked_at")
    .eq("id", consentId)
    .maybeSingle();
  if (consentErr) {
    return jsonError("server_error", "Ошибка чтения согласия.", 500, cors);
  }
  if (!consent) {
    return jsonError("not_found", "Согласие не найдено.", 404, cors);
  }

  // 4. Право: субъект отзывает ТОЛЬКО своё согласие.
  if (consent.subject_uid !== authUid) {
    return jsonError("forbidden", "Нельзя отозвать чужое согласие.", 403, cors);
  }

  // 5. Идемпотентность: уже отозвано → no-op.
  if (consent.revoked_at !== null) {
    return jsonOk({ ok: true, already_revoked: true }, 200, cors);
  }

  // 6. Каскад по СУБЪЕКТУ: все гости субъекта во всех событиях
  //    (по auth_uid, не по consent_id — см. шапку H2).
  const { data: guests, error: guestsErr } = await supabase
    .from("guests")
    .select("id")
    .eq("auth_uid", authUid);
  if (guestsErr) {
    return jsonError("server_error", "Ошибка чтения гостей.", 500, cors);
  }

  // 6а. Собрать пути всех фото субъекта (Storage чистим ДО удаления строк).
  const errors: { stage: string; message: string }[] = [];
  const allPaths: string[] = [];

  for (const guest of guests ?? []) {
    const guestId = guest.id as string;
    const { data: photos, error: photosErr } = await supabase
      .from("photos")
      .select("storage_path")
      .eq("guest_id", guestId);
    if (photosErr) {
      errors.push({ stage: `select photos ${guestId}`, message: photosErr.message });
      continue;
    }
    for (const p of photos ?? []) {
      const path = (p.storage_path as string | null) ?? "";
      if (path.length > 0) allPaths.push(path);
    }
  }

  // Если не смогли даже перечислить фото — не трогаем БД, отдаём 500 (повторный
  // вызов дочистит: согласие ещё не отозвано).
  if (errors.length > 0) {
    console.error("[revoke-consent] enumerate failure:", JSON.stringify(errors));
    return jsonError("server_error", "Не удалось перечислить фото субъекта.", 500, cors);
  }

  // 6б. Физическое удаление объектов Storage (батчами ≤1000) — ДО строк БД.
  try {
    await removeObjects(supabase, allPaths);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[revoke-consent] storage remove failed:", message);
    // Не удаляем строки и не помечаем согласие отозванным → повторный вызов
    // идемпотентно дочистит (согласие остаётся неотозванным).
    return jsonError("server_error", "Не удалось удалить объекты Storage.", 500, cors);
  }

  // 7. Атомарная БД-часть: delete guests субъекта + set revoked_at + аудит
  //    (одна security-definer транзакция, миграция 0005).
  const { data: rpcData, error: rpcErr } = await supabase.rpc(
    "revoke_consent_atomic",
    { p_consent_id: consentId, p_subject_uid: authUid },
  );
  if (rpcErr) {
    // Аудит/отзыв НЕ зафиксированы → клиент должен знать (152-ФЗ доказательная база).
    console.error("[revoke-consent] rpc failed:", rpcErr.message);
    return jsonError("server_error", "Не удалось зафиксировать отзыв согласия.", 500, cors);
  }

  const row = Array.isArray(rpcData) ? rpcData[0] : rpcData;
  if (row?.already_revoked) {
    // Гонка: кто-то отозвал между нашим select (шаг 5) и RPC. Объекты Storage уже
    // могли быть снесены — это безопасно (remove идемпотентен).
    return jsonOk({ ok: true, already_revoked: true }, 200, cors);
  }

  return jsonOk({
    ok: true,
    photos_removed: allPaths.length,
    guests_removed: (row?.guests_removed as number | undefined) ?? 0,
  }, 200,
  cors);
});

// Удаляет объекты Storage батчами ≤1000. remove на несуществующий путь — no-op.
async function removeObjects(
  supabase: SupabaseClient,
  paths: string[],
): Promise<void> {
  for (let i = 0; i < paths.length; i += REMOVE_BATCH) {
    const batch = paths.slice(i, i + REMOVE_BATCH);
    if (batch.length === 0) continue;
    const { error } = await supabase.storage.from(BUCKET).remove(batch);
    if (error) {
      throw new Error(`remove objects: ${error.message}`);
    }
  }
}
