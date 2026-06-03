// Edge Function: confirm-upload — подтверждение фактической загрузки кадра.
// Контракт: SPECIFICATION.md §6.3 («Подтверждение загрузки»).
//
// POST (концептуально POST /photos/:id/confirm), авторизация — JWT гостя.
// Тело: { "photo_id": "..." }.
// Успех 200: { ok: true, thumb_ready: false }.
//
// Функция работает под service-role (обходит RLS) и сама проверяет, что кадр
// принадлежит гостю текущей сессии. Идемпотентно ставит uploaded=true.
//
// БАГ-ФИКС (HIGH §6.3): нельзя подтверждать кадр, файла которого нет в Storage.
// До update проверяем наличие объекта по storage_path; если объекта нет — 409
// not_uploaded. Это исключает фантомные записи и битые карточки в галерее.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersFor, handlePreflight } from "../_shared/cors.ts";
import { jsonError, jsonOk } from "../_shared/errors.ts";

const BUCKET = "event-photos";

interface ConfirmBody {
  photo_id?: unknown;
}

Deno.serve(async (req: Request): Promise<Response> => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  // M5: origin-зависимые CORS-заголовки.
  const cors = corsHeadersFor(req);

  if (req.method !== "POST") {
    return jsonError("method_not_allowed", "Только POST.", 405, cors);
  }

  // 1. Авторизация: JWT гостя.
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
    return jsonError("unauthorized", "Невалидный токен гостя.", 401, cors);
  }
  const authUid = userData.user.id;

  // 2. Парсинг тела и поиск кадра.
  let body: ConfirmBody;
  try {
    body = await req.json() as ConfirmBody;
  } catch {
    return jsonError("not_found", "Кадр не найден.", 404, cors);
  }
  const photoId = typeof body.photo_id === "string" ? body.photo_id.trim() : "";
  if (!photoId) {
    return jsonError("not_found", "Кадр не найден.", 404, cors);
  }

  const { data: photo, error: photoErr } = await supabase
    .from("photos")
    .select("id, event_id, guest_id, storage_path")
    .eq("id", photoId)
    .maybeSingle();
  if (photoErr) {
    return jsonError("server_error", "Ошибка чтения кадра.", 500, cors);
  }
  if (!photo) {
    return jsonError("not_found", "Кадр не найден.", 404, cors);
  }

  // 3. Кадр должен принадлежать гостю текущей сессии в событии кадра.
  const { data: guest, error: guestErr } = await supabase
    .from("guests")
    .select("id")
    .eq("event_id", photo.event_id)
    .eq("auth_uid", authUid)
    .maybeSingle();
  if (guestErr) {
    return jsonError("server_error", "Ошибка проверки гостя.", 500, cors);
  }
  if (!guest || guest.id !== photo.guest_id) {
    return jsonError("forbidden", "Кадр принадлежит другому гостю.", 403, cors);
  }

  // 4. Объект ДОЛЖЕН реально присутствовать в Storage до подтверждения (§6.3).
  // storage_path = {event_id}/{guest_id}/{photo_id}.jpg — разбираем на каталог и
  // имя файла, ищем точное совпадение через list(search). Нет объекта → 409.
  const storagePath = (photo.storage_path as string | null) ?? "";
  const slash = storagePath.lastIndexOf("/");
  const folder = slash >= 0 ? storagePath.slice(0, slash) : "";
  const filename = slash >= 0 ? storagePath.slice(slash + 1) : storagePath;

  const { data: listed, error: listErr } = await supabase.storage
    .from(BUCKET)
    .list(folder, { search: filename });
  if (listErr) {
    return jsonError("server_error", "Ошибка проверки хранилища.", 500, cors);
  }
  const exists = (listed ?? []).some((o) => o.name === filename);
  if (!exists) {
    return jsonError("not_uploaded", "Файл ещё не загружен в хранилище.", 409, cors);
  }

  // 5. TODO: генерация превью (512 px, {photo_id}_thumb.jpg) — будущая версия /
  // Storage transform (SPECIFICATION §5). В этой фазе превью не создаём,
  // thumb_ready=false. Никакого распознавания лиц (инвариант проекта).

  // 6. Идемпотентно помечаем кадр загруженным (повтор уже загруженного — no-op:
  // объект на месте, uploaded уже true → снова 200).
  const { error: updErr } = await supabase
    .from("photos")
    .update({ uploaded: true })
    .eq("id", photoId);
  if (updErr) {
    return jsonError("server_error", "Не удалось подтвердить кадр.", 500, cors);
  }

  return jsonOk({ ok: true, thumb_ready: false }, 200, cors);
});
