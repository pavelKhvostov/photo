// Edge Function: reveal — ручная проявка события хостом.
// Контракт: SPECIFICATION.md §6.2 («Ручная проявка»), статусы — §1.
//
// POST (концептуально POST /events/:id/reveal), авторизация — JWT хоста.
// Тело: { "event_id": "..." }.
// Успех 200: { ok: true, status: "revealed" }.
//
// Функция работает под service-role (обходит RLS) и сама проверяет, что вызывающий —
// хост события, и корректность перехода статуса. Под RLS это можно было бы сделать
// через events_host_all, но семантику ошибок (not_host/already_revealed/event_closed)
// удобнее отдавать явными кодами, поэтому проверяем сами.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersFor, handlePreflight } from "../_shared/cors.ts";
import { jsonError, jsonOk } from "../_shared/errors.ts";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RevealBody {
  event_id?: unknown;
}

Deno.serve(async (req: Request): Promise<Response> => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  // M5: origin-зависимые CORS-заголовки.
  const cors = corsHeadersFor(req);

  if (req.method !== "POST") {
    return jsonError("method_not_allowed", "Только POST.", 405, cors);
  }

  // 1. Авторизация: JWT хоста.
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
    return jsonError("unauthorized", "Невалидный токен хоста.", 401, cors);
  }
  const authUid = userData.user.id;

  // 2. Валидация тела.
  let body: RevealBody;
  try {
    body = await req.json() as RevealBody;
  } catch {
    return jsonError("validation", "Тело запроса должно быть JSON.", 422, cors);
  }
  const eventId = typeof body.event_id === "string" ? body.event_id.trim() : "";
  if (!eventId || !UUID_RE.test(eventId)) {
    return jsonError("validation", "Поле event_id обязательно (uuid).", 422, cors);
  }

  // 2a. Поиск события.
  const { data: event, error: eventErr } = await supabase
    .from("events")
    .select("id, host_id, status")
    .eq("id", eventId)
    .maybeSingle();
  if (eventErr) {
    return jsonError("server_error", "Ошибка чтения события.", 500, cors);
  }
  if (!event) {
    return jsonError("not_found", "Событие не найдено.", 404, cors);
  }

  // 3. Только хост события.
  if (event.host_id !== authUid) {
    return jsonError("not_host", "Только хост может проявить событие.", 403, cors);
  }

  // 4. Уже проявлено.
  if (event.status === "revealed") {
    return jsonError("already_revealed", "Событие уже проявлено.", 409, cors);
  }

  // 5. Закрытое событие проявить нельзя.
  if (event.status === "archived" || event.status === "deleted") {
    return jsonError("event_closed", "Событие закрыто.", 410, cors);
  }

  // 6. Переход в revealed. Условие по статусу — страховка от гонки с авто-проявкой.
  const { error: updErr } = await supabase
    .from("events")
    .update({ status: "revealed" })
    .eq("id", eventId)
    .in("status", ["draft", "live"]);
  if (updErr) {
    return jsonError("server_error", "Не удалось проявить событие.", 500, cors);
  }

  return jsonOk({ ok: true, status: "revealed" }, 200, cors);
});
