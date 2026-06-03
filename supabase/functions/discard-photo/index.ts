// Edge Function: discard-photo — явное удаление зарезервированного кадра гостем.
// Контракт: SPECIFICATION.md §6.3 (upload-url резервирует photos с uploaded=false),
//           §9 п.5 (сценарий «Переснять»: клиент бросает резерв). Закрывает MEDIUM
//           бэклога — мусор photos(uploaded=false), копящийся при пересъёмке.
//
// POST (концептуально DELETE/POST /photos/:id/discard), авторизация — JWT гостя.
// Тело: { "photo_id": "..." }.
// Успех 200: { ok: true }.
//
// Функция под service-role (обходит RLS) и САМА проверяет права/инварианты:
//   - JWT гостя обязателен (нет → 401);
//   - photo_id обязателен (нет → 422 validation);
//   - кадр должен существовать (нет → 404 not_found);
//   - кадр должен принадлежать гостю ТЕКУЩЕЙ сессии: guest по (photo.event_id,
//     auth_uid), guest.id == photo.guest_id (иначе → 403 forbidden);
//   - удалять можно ТОЛЬКО резерв (uploaded=false). Если uploaded=true — это
//     полноценный кадр галереи, не резерв → 409 already_uploaded, НЕ удаляем
//     (удаление настоящих кадров идёт штатным DELETE под RLS / отзывом согласия).
//
// Объекта Storage у резерва ещё нет (PUT/confirm не прошёл), но на всякий случай
// пробуем storage.remove(storage_path) в try/catch — ошибка не валит удаление строки.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handlePreflight } from "../_shared/cors.ts";
import { jsonError, jsonOk } from "../_shared/errors.ts";

const BUCKET = "event-photos";

interface DiscardBody {
  photo_id?: unknown;
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

  // 2. Валидация тела.
  let body: DiscardBody;
  try {
    body = await req.json() as DiscardBody;
  } catch {
    return jsonError("validation", "Тело запроса должно быть JSON.", 422);
  }
  const photoId = typeof body.photo_id === "string" ? body.photo_id.trim() : "";
  if (!photoId) {
    return jsonError("validation", "Поле photo_id обязательно.", 422);
  }

  // 3. Поиск кадра.
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

  // 4. Право: кадр должен принадлежать гостю ТЕКУЩЕЙ сессии в событии кадра.
  const { data: guest, error: guestErr } = await supabase
    .from("guests")
    .select("id")
    .eq("event_id", photo.event_id)
    .eq("auth_uid", authUid)
    .maybeSingle();
  if (guestErr) {
    return jsonError("server_error", "Ошибка проверки гостя.", 500);
  }
  if (!guest || guest.id !== photo.guest_id) {
    return jsonError("forbidden", "Кадр принадлежит другому гостю.", 403);
  }

  // 5. Удалять можно ТОЛЬКО резерв. Загруженный кадр — не резерв, не трогаем.
  if (photo.uploaded === true) {
    return jsonError(
      "already_uploaded",
      "Кадр уже загружен — это не резерв, удаление здесь запрещено.",
      409,
    );
  }

  // 6. Объекта Storage у резерва быть не должно (uploaded=false), но на всякий
  //    случай пробуем удалить по storage_path. remove на несуществующий путь —
  //    no-op; ошибку Storage НЕ считаем фатальной (строку всё равно чистим).
  const storagePath = (photo.storage_path as string | null) ?? "";
  if (storagePath.length > 0) {
    try {
      const { error: rmErr } = await supabase.storage
        .from(BUCKET)
        .remove([storagePath]);
      if (rmErr) {
        console.warn("[discard-photo] storage remove warn:", rmErr.message);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.warn("[discard-photo] storage remove threw:", message);
    }
  }

  // 7. Удаляем строку резерва. Условие uploaded=false дублируем в delete как защиту
  //    от гонки (confirm-upload мог проставить uploaded=true между шагом 5 и сюда).
  const { error: delErr } = await supabase
    .from("photos")
    .delete()
    .eq("id", photoId)
    .eq("uploaded", false);
  if (delErr) {
    return jsonError("server_error", "Не удалось удалить резерв кадра.", 500);
  }

  return jsonOk({ ok: true }, 200);
});
