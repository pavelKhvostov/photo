// Edge Function: upload-url — выдача подписанного PUT-URL для загрузки кадра.
// Контракт: SPECIFICATION.md §6.3 («Запрос URL на загрузку»), §5 (Storage), §9 п.3.
//
// POST (концептуально POST /events/:id/photos/upload-url), авторизация — JWT гостя.
// Тело: { "event_id": "...", "filter": "vintage", "width": 1536, "height": 2048 }.
// Успех 200: { photo_id, upload_url, token, storage_path, expires_in: 600 }.
//
// Функция работает под service-role (обходит RLS) и сама проверяет права/лимиты:
//  - права гостя из anon-JWT (auth.getUser);
//  - съёмка закрыта до events.starts_at (§9 п.3): если starts_at в будущем → 409
//    event_not_started (null = ограничения нет, старт сразу);
//  - лимит кадров считается ДО выдачи URL по uploaded-фото и events.shots_per_guest
//    (безлимит, если plans.shots_per_guest == 0 для events.plan);
//  - Storage отдаётся только подписанным URL (152-ФЗ инвариант), бакет приватный.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handlePreflight } from "../_shared/cors.ts";
import { jsonError, jsonOk } from "../_shared/errors.ts";

const BUCKET = "event-photos";
const ALLOWED_FILTERS = ["film35", "vintage", "bw", "summer"];
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface UploadBody {
  event_id?: unknown;
  filter?: unknown;
  width?: unknown;
  height?: unknown;
}

// Валидация опционального положительного int.
function parseDimension(v: unknown): { ok: boolean; value: number | null } {
  if (v === undefined || v === null) return { ok: true, value: null };
  if (typeof v !== "number" || !Number.isInteger(v) || v <= 0) {
    return { ok: false, value: null };
  }
  return { ok: true, value: v };
}

Deno.serve(async (req: Request): Promise<Response> => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return jsonError("method_not_allowed", "Только POST.", 405);
  }

  // 1. Авторизация: JWT гостя.
  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!jwt) {
    return jsonError("unauthorized", "Отсутствует Bearer-токен.", 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return jsonError("server_misconfigured", "Сервер не настроен.", 500);
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: userData, error: userErr } = await supabase.auth.getUser(jwt);
  if (userErr || !userData?.user) {
    return jsonError("unauthorized", "Невалидный токен гостя.", 401);
  }
  const authUid = userData.user.id;

  // 2. Парсинг и валидация тела.
  let body: UploadBody;
  try {
    body = await req.json() as UploadBody;
  } catch {
    return jsonError("validation", "Тело запроса должно быть JSON.", 422);
  }

  const eventId = typeof body.event_id === "string" ? body.event_id.trim() : "";
  if (!eventId || !UUID_RE.test(eventId)) {
    return jsonError("validation", "Поле event_id обязательно (uuid).", 422);
  }

  const filter = typeof body.filter === "string" ? body.filter : "";
  if (!ALLOWED_FILTERS.includes(filter)) {
    return jsonError(
      "validation",
      `filter должен быть одним из: ${ALLOWED_FILTERS.join(", ")}.`,
      422,
    );
  }

  const width = parseDimension(body.width);
  if (!width.ok) {
    return jsonError("validation", "width должен быть положительным int.", 422);
  }
  const height = parseDimension(body.height);
  if (!height.ok) {
    return jsonError("validation", "height должен быть положительным int.", 422);
  }

  // 3. Гость текущей сессии в этом событии — по (event_id, auth_uid).
  const { data: guest, error: guestErr } = await supabase
    .from("guests")
    .select("id")
    .eq("event_id", eventId)
    .eq("auth_uid", authUid)
    .maybeSingle();
  if (guestErr) {
    return jsonError("server_error", "Ошибка проверки гостя.", 500);
  }
  if (!guest) {
    return jsonError("not_guest", "Вы не гость этого события.", 403);
  }
  const guestId = guest.id as string;

  // 4. Событие и его статус.
  const { data: event, error: eventErr } = await supabase
    .from("events")
    .select("id, status, plan, shots_per_guest, starts_at")
    .eq("id", eventId)
    .maybeSingle();
  if (eventErr) {
    return jsonError("server_error", "Ошибка чтения события.", 500);
  }
  if (!event) {
    return jsonError("not_guest", "Вы не гость этого события.", 403);
  }
  if (event.status === "archived" || event.status === "deleted") {
    return jsonError("event_closed", "Событие закрыто.", 410);
  }

  // 4a. Съёмка закрыта до старта события (§9 п.3). starts_at == null → старт сразу.
  if (
    event.starts_at !== null &&
    new Date(event.starts_at).getTime() > Date.now()
  ) {
    return jsonError("event_not_started", "Событие ещё не началось.", 409);
  }

  // 5. Лимит кадров. Безлимит, если plans.shots_per_guest == 0 для плана события.
  const { data: plan, error: planErr } = await supabase
    .from("plans")
    .select("shots_per_guest")
    .eq("code", event.plan)
    .maybeSingle();
  if (planErr || !plan) {
    return jsonError("server_error", "Тариф события не найден.", 500);
  }

  const unlimited = plan.shots_per_guest === 0;
  if (!unlimited) {
    const { count, error: countErr } = await supabase
      .from("photos")
      .select("id", { count: "exact", head: true })
      .eq("guest_id", guestId)
      .eq("uploaded", true);
    if (countErr) {
      return jsonError("server_error", "Ошибка подсчёта кадров.", 500);
    }
    const uploaded = count ?? 0;
    if (uploaded >= event.shots_per_guest) {
      return jsonError(
        "shot_limit_reached",
        "Достигнут лимит кадров по тарифу события.",
        409,
      );
    }
  }

  // 6. Генерируем photo_id и путь строго {event_id}/{guest_id}/{photo_id}.jpg.
  const photoId = crypto.randomUUID();
  const storagePath = `${eventId}/${guestId}/${photoId}.jpg`;

  // 7. Строка photos (uploaded=false) — резервируем кадр до фактической загрузки.
  const { error: insErr } = await supabase
    .from("photos")
    .insert({
      id: photoId,
      event_id: eventId,
      guest_id: guestId,
      storage_path: storagePath,
      filter,
      width: width.value,
      height: height.value,
      uploaded: false,
    });
  if (insErr) {
    return jsonError("server_error", "Не удалось создать кадр.", 500);
  }

  // 8. Подписанный PUT-URL (приватный бакет, 152-ФЗ). token нужен клиенту для
  // uploadToSignedUrl. TTL createSignedUploadUrl не переопределяется в API —
  // возвращаем expires_in=600 как договорённость по спеке.
  const { data: signed, error: signErr } = await supabase.storage
    .from(BUCKET)
    .createSignedUploadUrl(storagePath);
  if (signErr || !signed) {
    // Откатываем резерв кадра, чтобы он не занимал лимит.
    await supabase.from("photos").delete().eq("id", photoId);
    return jsonError("server_error", "Не удалось выдать URL загрузки.", 500);
  }

  return jsonOk({
    photo_id: photoId,
    upload_url: signed.signedUrl,
    token: signed.token,
    storage_path: storagePath,
    expires_in: 600,
  }, 200);
});
