// Edge Function: purge-expired — физическая чистка просроченных событий.
// Контракт: SPECIFICATION.md §7 (Фоновые задачи), §10/§4.7 (152-ФЗ: сроки хранения,
// приватный Storage). Сценарий §6.4-таблица п.10: истёк expires_at → cron метит
// status='deleted' (миграция 0004) → purge-expired удаляет объекты Storage и строки БД.
//
// POST. Служебная функция: вызывается pg_cron'ом (HTTP) или вручную админом, НЕ
// гостевым/хостовым JWT. Защита простым секретом: заголовок x-purge-secret должен
// совпадать с Deno.env PURGE_SECRET.
//  - PURGE_SECRET НЕ задан в env → 500 server_misconfigured (fail-closed, M3).
//    Деструктивная функция не должна работать без авторизации — ни на проде, ни
//    локально. PURGE_SECRET ОБЯЗАТЕЛЕН всегда; для локального serve задавайте его
//    через supabase/functions/.env.local (PURGE_SECRET=...).
//  - PURGE_SECRET задан и не совпал/отсутствует в заголовке → 401 unauthorized.
//
// Логика (service-role, обходит RLS — корректно для системной чистки):
//  1. Выбрать события status='deleted' (батч ≤50 за вызов, чтобы не словить таймаут).
//  2. Для каждого:
//     а) собрать пути объектов под {event_id}/{guest_id}/... + QR qr/{short_code}.png
//        + обложку events.cover_path (M4: она может лежать вне дерева {event_id}/);
//     б) удалить объекты из приватного бакета event-photos (батчами ≤1000);
//     в) delete from events where id = ... — FK on delete cascade удалит guests,
//        photos, subscriptions, payments этого события. consents НЕ привязаны FK к
//        событию (по subject_uid) — здесь не трогаем (отзыв согласия — отдельный сценарий).
//  3. Вернуть 200 { ok, events_purged, objects_removed, errors }.
//
// Идемпотентность: повторный вызов на уже очищенных событиях — no-op (их уже нет).
// Устойчивость: обработка каждого события в try/catch; ошибка по одному не валит весь
// прогон — копим в errors[] и продолжаем.

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handlePreflight } from "../_shared/cors.ts";
import { jsonError, jsonOk } from "../_shared/errors.ts";

const BUCKET = "event-photos";
const EVENT_BATCH = 50; // событий за один вызов
const REMOVE_BATCH = 1000; // объектов за один storage.remove
const LIST_LIMIT = 1000; // элементов за один storage.list

interface PurgeError {
  event_id: string;
  code: string;
  message: string;
}

Deno.serve(async (req: Request): Promise<Response> => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return jsonError("method_not_allowed", "Только POST.", 405);
  }

  // 1. Авторизация по служебному секрету (fail-closed, M3).
  // Деструктивная функция БЕЗ заданного секрета работать не должна — это дыра.
  const expectedSecret = Deno.env.get("PURGE_SECRET");
  if (!expectedSecret) {
    console.error(
      "[purge-expired] PURGE_SECRET не задан — отказ (fail-closed). " +
        "Задайте PURGE_SECRET в окружении функции.",
    );
    return jsonError("server_misconfigured", "Сервер не настроен.", 500);
  }
  const provided = req.headers.get("x-purge-secret") ?? "";
  if (provided !== expectedSecret) {
    return jsonError("unauthorized", "Неверный или отсутствующий секрет.", 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return jsonError("server_misconfigured", "Сервер не настроен.", 500);
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 2. Просроченные события, помеченные cron'ом как 'deleted'.
  const { data: events, error: eventsErr } = await supabase
    .from("events")
    .select("id, short_code, cover_path")
    .eq("status", "deleted")
    .limit(EVENT_BATCH);
  if (eventsErr) {
    return jsonError("server_error", "Ошибка выборки событий.", 500);
  }

  let eventsPurged = 0;
  let objectsRemoved = 0;
  const errors: PurgeError[] = [];

  for (const event of events ?? []) {
    const eventId = event.id as string;
    const shortCode = (event.short_code as string | null) ?? null;
    const coverPath = (event.cover_path as string | null) ?? null;
    try {
      // 2а. Пути всех объектов события + QR + обложка.
      const paths = await collectEventPaths(supabase, eventId, shortCode, coverPath);

      // 2б. Удаление объектов Storage батчами.
      const removed = await removeObjects(supabase, paths);
      objectsRemoved += removed;

      // 2в. Удаление строки события — каскад FK по guests/photos/subscriptions/payments.
      const { error: delErr } = await supabase
        .from("events")
        .delete()
        .eq("id", eventId);
      if (delErr) {
        throw new Error(`delete events: ${delErr.message}`);
      }

      eventsPurged += 1;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error(`[purge-expired] event ${eventId} failed: ${message}`);
      errors.push({ event_id: eventId, code: "purge_failed", message });
      // Продолжаем с остальными событиями — не валим весь прогон.
    }
  }

  return jsonOk({
    ok: true,
    events_purged: eventsPurged,
    objects_removed: objectsRemoved,
    errors,
  }, 200);
});

// Собирает полные пути всех объектов события в бакете event-photos.
// supabase-js list возвращает один уровень: проходим {event_id} → папки гостей →
// файлы внутри. Папка определяется как запись с id === null (у файлов id != null).
// Дополнительно добавляем QR qr/{short_code}.png (если есть short_code) и обложку
// events.cover_path (M4) — она может лежать вне дерева {event_id}/ и иначе осиротеет.
async function collectEventPaths(
  supabase: SupabaseClient,
  eventId: string,
  shortCode: string | null,
  coverPath: string | null,
): Promise<string[]> {
  const paths: string[] = [];

  const { data: topLevel, error: topErr } = await supabase.storage
    .from(BUCKET)
    .list(eventId, { limit: LIST_LIMIT });
  if (topErr) {
    throw new Error(`list ${eventId}: ${topErr.message}`);
  }

  for (const entry of topLevel ?? []) {
    if (entry.id === null) {
      // Папка гостя — спускаемся на уровень файлов.
      const guestPrefix = `${eventId}/${entry.name}`;
      const { data: files, error: filesErr } = await supabase.storage
        .from(BUCKET)
        .list(guestPrefix, { limit: LIST_LIMIT });
      if (filesErr) {
        throw new Error(`list ${guestPrefix}: ${filesErr.message}`);
      }
      for (const file of files ?? []) {
        if (file.id !== null) {
          paths.push(`${guestPrefix}/${file.name}`);
        }
      }
    } else {
      // Файл прямо под {event_id}/ (на случай нестандартной раскладки).
      paths.push(`${eventId}/${entry.name}`);
    }
  }

  // QR-объект события (см. §6.1: qr_png_path = "qr/{short_code}.png").
  if (shortCode) {
    paths.push(`qr/${shortCode}.png`);
  }

  // Обложка события (M4): cover_path может указывать на объект вне {event_id}/
  // (например cover/{event_id}.jpg). Обложка — потенциальные ПДн, её тоже чистим.
  // Дедуп на случай, если cover_path уже попал через list под {event_id}/.
  if (coverPath && coverPath.length > 0 && !paths.includes(coverPath)) {
    paths.push(coverPath);
  }

  return paths;
}

// Удаляет объекты батчами ≤1000. Возвращает количество фактически удалённых.
// remove на несуществующий путь — no-op (идемпотентность); QR/обложка могут отсутствовать.
async function removeObjects(
  supabase: SupabaseClient,
  paths: string[],
): Promise<number> {
  let removed = 0;
  for (let i = 0; i < paths.length; i += REMOVE_BATCH) {
    const batch = paths.slice(i, i + REMOVE_BATCH);
    if (batch.length === 0) continue;
    const { data, error } = await supabase.storage.from(BUCKET).remove(batch);
    if (error) {
      throw new Error(`remove objects: ${error.message}`);
    }
    removed += data?.length ?? 0;
  }
  return removed;
}
