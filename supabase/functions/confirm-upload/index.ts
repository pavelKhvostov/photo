// Edge Function: confirm-upload — подтверждение фактической загрузки кадра.
// Контракт: SPECIFICATION.md §6.3 («Подтверждение загрузки»).
//
// POST (концептуально POST /photos/:id/confirm), авторизация — JWT гостя.
// Тело: { "photo_id": "..." }.
// Успех 200: { ok: true, thumb_ready: false }.
//
// Функция работает под service-role (обходит RLS) и сама проверяет, что кадр
// принадлежит гостю текущей сессии. Идемпотентно ставит uploaded=true.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handlePreflight } from "../_shared/cors.ts";
import { jsonError, jsonOk } from "../_shared/errors.ts";

interface ConfirmBody {
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

  // 2. Парсинг тела и поиск кадра.
  let body: ConfirmBody;
  try {
    body = await req.json() as ConfirmBody;
  } catch {
    return jsonError("not_found", "Кадр не найден.", 404);
  }
  const photoId = typeof body.photo_id === "string" ? body.photo_id.trim() : "";
  if (!photoId) {
    return jsonError("not_found", "Кадр не найден.", 404);
  }

  const { data: photo, error: photoErr } = await supabase
    .from("photos")
    .select("id, event_id, guest_id")
    .eq("id", photoId)
    .maybeSingle();
  if (photoErr) {
    return jsonError("server_error", "Ошибка чтения кадра.", 500);
  }
  if (!photo) {
    return jsonError("not_found", "Кадр не найден.", 404);
  }

  // 3. Кадр должен принадлежать гостю текущей сессии в событии кадра.
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

  // 4. TODO: генерация превью (512 px, {photo_id}_thumb.jpg) — будущая версия /
  // Storage transform (SPECIFICATION §5). В этой фазе превью не создаём,
  // thumb_ready=false. Никакого распознавания лиц (инвариант проекта).

  // 5. Идемпотентно помечаем кадр загруженным (повтор — no-op).
  const { error: updErr } = await supabase
    .from("photos")
    .update({ uploaded: true })
    .eq("id", photoId);
  if (updErr) {
    return jsonError("server_error", "Не удалось подтвердить кадр.", 500);
  }

  return jsonOk({ ok: true, thumb_ready: false }, 200);
});
