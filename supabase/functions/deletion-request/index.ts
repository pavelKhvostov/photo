// Edge Function: deletion-request — регистрация запроса субъекта на удаление (152-ФЗ).
// Контракт: SPECIFICATION.md §6.5 («Запрос удаления»), edge case §9 п.9.
//
// POST { "scope": "photo"|"guest"|"account", "target_id": "uuid"|null }, JWT субъекта.
// Успех 201: { request_id, processed }.
//
// Функция под service-role (обходит RLS) и сама пишет запись в deletion_requests.
//
// scope='photo' (субъект — автор фото): обрабатываем СРАЗУ — проверяем, что фото
// принадлежит гостю этого auth_uid, физически удаляем объект Storage + строку photos,
// processed_at=now(). Чужое фото → 403 (для «удалить фото со мной» от третьего лица
// — см. §9 п.9, отдельный полуавтоматический сценарий, здесь не покрывается).
//
// scope='guest'|'account': регистрируем запрос (processed_at=null) на ручную/
// полуавтоматическую модерацию (§9 п.9). Немедленно не удаляем.
//
// ПОРЯДОК (инвариант 152-ФЗ): объект Storage удаляется ДО строки БД — иначе теряем
// storage_path.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handlePreflight } from "../_shared/cors.ts";
import { jsonError, jsonOk } from "../_shared/errors.ts";

const BUCKET = "event-photos";
const VALID_SCOPES = ["photo", "guest", "account"] as const;
type Scope = (typeof VALID_SCOPES)[number];

interface DeletionBody {
  scope?: unknown;
  target_id?: unknown;
}

Deno.serve(async (req: Request): Promise<Response> => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return jsonError("method_not_allowed", "Только POST.", 405);
  }

  // 1. Авторизация: JWT субъекта.
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

  // 2. Валидация тела.
  let body: DeletionBody;
  try {
    body = await req.json() as DeletionBody;
  } catch {
    return jsonError("validation", "Тело запроса должно быть JSON.", 422);
  }

  const scope = typeof body.scope === "string" ? body.scope.trim() : "";
  if (!VALID_SCOPES.includes(scope as Scope)) {
    return jsonError(
      "validation",
      "scope должен быть одним из: photo, guest, account.",
      422,
    );
  }

  const targetId = typeof body.target_id === "string"
    ? body.target_id.trim()
    : "";

  if (scope === "photo" && !targetId) {
    return jsonError(
      "validation",
      "Для scope=photo поле target_id (id фото) обязательно.",
      422,
    );
  }

  // 3. scope='photo' — обрабатываем сразу, если фото принадлежит этому субъекту.
  let processed = false;
  if (scope === "photo") {
    const { data: photo, error: photoErr } = await supabase
      .from("photos")
      .select("id, guest_id, storage_path")
      .eq("id", targetId)
      .maybeSingle();
    if (photoErr) {
      return jsonError("server_error", "Ошибка чтения кадра.", 500);
    }
    if (!photo) {
      return jsonError("not_found", "Кадр не найден.", 404);
    }

    // Проверка авторства: гость фото должен принадлежать этому auth_uid.
    const { data: guest, error: guestErr } = await supabase
      .from("guests")
      .select("id")
      .eq("id", photo.guest_id)
      .eq("auth_uid", authUid)
      .maybeSingle();
    if (guestErr) {
      return jsonError("server_error", "Ошибка проверки гостя.", 500);
    }
    if (!guest) {
      // Фото не принадлежит субъекту — это не сценарий самоудаления.
      return jsonError("forbidden", "Кадр принадлежит другому субъекту.", 403);
    }

    // 3а. Storage ДО строки БД (инвариант 152-ФЗ).
    const storagePath = (photo.storage_path as string | null) ?? "";
    if (storagePath) {
      const { error: rmErr } = await supabase.storage
        .from(BUCKET)
        .remove([storagePath]);
      if (rmErr) {
        return jsonError("server_error", "Не удалось удалить объект Storage.", 500);
      }
    }

    // 3б. Удаление строки photos.
    const { error: delErr } = await supabase
      .from("photos")
      .delete()
      .eq("id", targetId);
    if (delErr) {
      return jsonError("server_error", "Не удалось удалить кадр.", 500);
    }

    processed = true;
  }

  // 4. Регистрация записи deletion_requests.
  const { data: reqRow, error: insErr } = await supabase
    .from("deletion_requests")
    .insert({
      subject_uid: authUid,
      scope,
      target_id: targetId || null,
      processed_at: processed ? new Date().toISOString() : null,
    })
    .select("id")
    .single();
  if (insErr || !reqRow) {
    return jsonError("server_error", "Не удалось зарегистрировать запрос.", 500);
  }

  return jsonOk({ request_id: reqRow.id, processed }, 201);
});
