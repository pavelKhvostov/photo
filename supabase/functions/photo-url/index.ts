// Edge Function: photo-url — выдача подписанного GET-URL на кадр.
// Контракт: SPECIFICATION.md §6.3 («Отдача файла»), правила видимости — §4.4 RLS.
//
// GET ?photo_id=...  (также POST { "photo_id": "..." }), JWT гостя или хоста.
// Успех 200: { url, expires_in: 600 }.
//
// Функция под service-role (обходит RLS) и САМА воспроизводит правила видимости
// RLS-политик photos:
//  - хост события видит всегда;
//  - гость видит своё фото всегда;
//  - чужое фото видно только после проявки (reveal_at null/прошёл или status='revealed');
//  - посторонний (не хост/не гость) — forbidden.
// Фото отдаётся ТОЛЬКО подписанным URL с TTL (152-ФЗ инвариант), бакет приватный.
//
// БАГ-ФИКС (HIGH §6.3): незагруженный кадр (uploaded=false) не имеет объекта в
// Storage — выдавать на него URL нельзя (битая картинка). Возвращаем 404
// not_found, как будто кадра нет (не раскрываем существование резерва).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handlePreflight } from "../_shared/cors.ts";
import { jsonError, jsonOk } from "../_shared/errors.ts";

const BUCKET = "event-photos";
const TTL = 600;

interface PhotoBody {
  photo_id?: unknown;
}

Deno.serve(async (req: Request): Promise<Response> => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  if (req.method !== "GET" && req.method !== "POST") {
    return jsonError("method_not_allowed", "Только GET или POST.", 405);
  }

  // 1. Авторизация: JWT гостя или хоста.
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
    return jsonError("unauthorized", "Невалидный токен.", 401);
  }
  const authUid = userData.user.id;

  // 2. photo_id из query (GET) или тела (POST).
  let photoId = "";
  if (req.method === "GET") {
    photoId = new URL(req.url).searchParams.get("photo_id")?.trim() ?? "";
  } else {
    try {
      const body = await req.json() as PhotoBody;
      photoId = typeof body.photo_id === "string" ? body.photo_id.trim() : "";
    } catch {
      photoId = "";
    }
  }
  if (!photoId) {
    return jsonError("not_found", "Кадр не найден.", 404);
  }

  const { data: photo, error: photoErr } = await supabase
    .from("photos")
    .select("id, event_id, guest_id, storage_path, uploaded")
    .eq("id", photoId)
    .maybeSingle();
  if (photoErr) {
    return jsonError("server_error", "Ошибка чтения кадра.", 500);
  }
  if (!photo) {
    return jsonError("not_found", "Кадр не найден.", 404);
  }

  // 2a. Незагруженный кадр (резерв) — для всех = «не найден» (§6.3). Объекта в
  // Storage ещё нет, выдача URL дала бы битую картинку.
  if (photo.uploaded !== true) {
    return jsonError("not_found", "Кадр не найден.", 404);
  }

  // 3. Видимость по правилам RLS photos (воспроизводим вручную под service-role).
  const { data: event, error: eventErr } = await supabase
    .from("events")
    .select("id, host_id, reveal_at, status")
    .eq("id", photo.event_id)
    .maybeSingle();
  if (eventErr || !event) {
    return jsonError("server_error", "Ошибка чтения события.", 500);
  }

  const isHost = event.host_id === authUid;

  let visible = false;
  if (isHost) {
    // Хост события видит всегда.
    visible = true;
  } else {
    // Гость события (если есть) — определяем его guest_id.
    const { data: guest, error: guestErr } = await supabase
      .from("guests")
      .select("id")
      .eq("event_id", photo.event_id)
      .eq("auth_uid", authUid)
      .maybeSingle();
    if (guestErr) {
      return jsonError("server_error", "Ошибка проверки гостя.", 500);
    }
    if (!guest) {
      // Не хост и не гость события.
      return jsonError("forbidden", "Нет доступа к кадру.", 403);
    }
    if (guest.id === photo.guest_id) {
      // Своё фото — видно всегда.
      visible = true;
    } else {
      // Чужое фото — только после проявки.
      const revealed = event.reveal_at === null ||
        new Date(event.reveal_at).getTime() <= Date.now() ||
        event.status === "revealed";
      visible = revealed;
    }
  }

  if (!visible) {
    return jsonError("forbidden", "Кадр ещё не проявлен.", 403);
  }

  // 4. Подписанный GET-URL с TTL.
  const { data: signed, error: signErr } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(photo.storage_path, TTL);
  if (signErr || !signed) {
    return jsonError("server_error", "Не удалось выдать URL.", 500);
  }

  return jsonOk({ url: toPublicUrl(signed.signedUrl), expires_in: TTL }, 200);
});

// На локалке storage подписывает URL внутренним хостом Docker-сети (http://kong:8000),
// который НЕ резолвится из браузера. Подменяем origin на публичный, доступный клиенту.
// PUBLIC_STORAGE_URL задаётся в окружении; на проде = публичный домен (подмена no-op,
// т.к. SUPABASE_URL уже публичный). Путь и подпись (токен) не трогаем.
function toPublicUrl(signedUrl: string): string {
  const publicBase = Deno.env.get("PUBLIC_STORAGE_URL") ??
    Deno.env.get("PUBLIC_SUPABASE_URL") ??
    "http://127.0.0.1:54321";
  try {
    const u = new URL(signedUrl);
    const pub = new URL(publicBase);
    u.protocol = pub.protocol;
    u.host = pub.host; // host включает порт
    return u.toString();
  } catch {
    return signedUrl;
  }
}
