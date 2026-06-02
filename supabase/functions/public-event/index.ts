// Edge Function: public-event — публичное превью события по short_code (до вступления).
// Контракт: SPECIFICATION.md §6.2 («Превью события по коду»), без PII.
//
// GET ?short_code=...  Анонимно (без user-JWT). Под service-role читаем только
// безопасные поля — никаких host_id/телефонов/host PII.
// Успех 200: { title, camera_style, status, reveal_at, starts_at, cover_url }.
//
// cover_url: если events.cover_path задан — подписанный URL (600с, приватный
// бакет, 152-ФЗ), иначе null.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handlePreflight } from "../_shared/cors.ts";
import { jsonError, jsonOk } from "../_shared/errors.ts";

const BUCKET = "event-photos";
const TTL = 600;

Deno.serve(async (req: Request): Promise<Response> => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  if (req.method !== "GET") {
    return jsonError("method_not_allowed", "Только GET.", 405);
  }

  // 1. short_code из query.
  const shortCode = new URL(req.url).searchParams.get("short_code")?.trim() ??
    "";
  if (!shortCode) {
    return jsonError("validation", "Параметр short_code обязателен.", 422);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return jsonError("server_misconfigured", "Сервер не настроен.", 500);
  }

  // service-role: читаем без RLS, но отдаём строго безопасный набор полей.
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 2. Поиск события (выбираем cover_path только для генерации подписанного URL,
  // в ответ он не попадает).
  const { data: event, error: eventErr } = await supabase
    .from("events")
    .select("title, camera_style, status, reveal_at, starts_at, cover_path")
    .eq("short_code", shortCode)
    .maybeSingle();
  if (eventErr) {
    return jsonError("server_error", "Ошибка чтения события.", 500);
  }
  if (!event) {
    return jsonError("not_found", "Событие не найдено.", 404);
  }

  // 3. Архивные/удалённые события не показываем.
  if (event.status === "archived" || event.status === "deleted") {
    return jsonError("event_archived", "Событие закрыто.", 410);
  }

  // 4. cover_url — подписанный URL, если есть обложка.
  // Origin подменяем на публичный (на локалке storage подписывает внутренним
  // хостом kong:8000, не резолвится из браузера). На проде — no-op.
  let coverUrl: string | null = null;
  if (event.cover_path) {
    const { data: signed } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(event.cover_path, TTL);
    coverUrl = signed?.signedUrl ? toPublicUrl(signed.signedUrl) : null;
  }

  return jsonOk({
    title: event.title,
    camera_style: event.camera_style,
    status: event.status,
    reveal_at: event.reveal_at ?? null,
    starts_at: event.starts_at ?? null,
    cover_url: coverUrl,
  }, 200);
});

// Подмена внутреннего origin storage (kong:8000 на локалке) на публичный,
// доступный браузеру. На проде PUBLIC_STORAGE_URL = публичный домен → no-op.
function toPublicUrl(signedUrl: string): string {
  const publicBase = Deno.env.get("PUBLIC_STORAGE_URL") ??
    Deno.env.get("PUBLIC_SUPABASE_URL") ??
    "http://127.0.0.1:54321";
  try {
    const u = new URL(signedUrl);
    const pub = new URL(publicBase);
    u.protocol = pub.protocol;
    u.host = pub.host;
    return u.toString();
  } catch {
    return signedUrl;
  }
}
