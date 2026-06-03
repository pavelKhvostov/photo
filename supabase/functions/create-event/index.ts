// Edge Function: create-event — создание события хостом.
// Контракт: SPECIFICATION.md §6.2 («Создание события»), §1 (перечисления), §5 (Storage).
//
// POST (концептуально POST /events), авторизация — JWT хоста (на проде телефон+SMS,
// на локалке email-OTP). Тело:
//   { "title": "Свадьба Ани и Пети", "camera_style": "film35",
//     "shots_per_guest": 50, "reveal_at": "2026-07-12T20:00:00Z"|null,
//     "starts_at": "2026-07-12T14:00:00Z"|null }
// Успех 201:
//   { id, short_code, join_url, qr_path, qr_url, plan: "free", expires_at }
//
// Функция работает под service-role (обходит RLS) и сама делает всё, что нельзя под RLS:
//  - убеждается, что в public.users есть профиль хоста (insert делает не RLS, а мы);
//  - берёт retention из таблицы plans (НЕ хардкод) для expires_at;
//  - генерирует уникальный short_code и проверяет коллизии;
//  - рендерит QR в приватный бакет event-photos и отдаёт его подписанным URL с TTL
//    (152-ФЗ инвариант: публичных бакетов нет).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersFor, handlePreflight } from "../_shared/cors.ts";
import { jsonError, jsonOk } from "../_shared/errors.ts";
import { toPublicUrl } from "../_shared/storage.ts";

const BUCKET = "event-photos";
const TTL = 600;
const ALLOWED_STYLES = ["film35", "vintage", "bw", "summer"];
const DEFAULT_SHOTS = 20;
// Алфавит base32 без визуально похожих символов (нет o/0, l/1/i).
const SHORT_CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const SHORT_CODE_LEN = 6;
const SHORT_CODE_ATTEMPTS = 5;

interface CreateBody {
  title?: unknown;
  camera_style?: unknown;
  shots_per_guest?: unknown;
  reveal_at?: unknown;
  starts_at?: unknown;
}

// Валидация опционального ISO-таймстампа: null/undefined → null; строка → проверяем.
function parseIso(v: unknown): { ok: boolean; value: string | null } {
  if (v === undefined || v === null) return { ok: true, value: null };
  if (typeof v !== "string") return { ok: false, value: null };
  const t = Date.parse(v);
  if (Number.isNaN(t)) return { ok: false, value: null };
  return { ok: true, value: new Date(t).toISOString() };
}

// Криптослучайный short_code из безопасного алфавита.
function genShortCode(): string {
  const bytes = new Uint8Array(SHORT_CODE_LEN);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < SHORT_CODE_LEN; i++) {
    out += SHORT_CODE_ALPHABET[bytes[i] % SHORT_CODE_ALPHABET.length];
  }
  return out;
}

// Генерация QR PNG. Изолируем сбой рендера: при любой ошибке возвращаем null, чтобы
// не сорвать создание события (join_url отдаём всегда).
async function renderQrPng(text: string): Promise<Uint8Array | null> {
  try {
    const qrcode = (await import("https://esm.sh/qrcode@1.5.3")).default as {
      toBuffer: (
        t: string,
        o: Record<string, unknown>,
      ) => Promise<Uint8Array>;
    };
    const buf = await qrcode.toBuffer(text, {
      type: "png",
      errorCorrectionLevel: "M",
      margin: 2,
      width: 512,
    });
    return new Uint8Array(buf);
  } catch (_e) {
    return null;
  }
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

  // 2. Парсинг и валидация тела.
  let body: CreateBody;
  try {
    body = await req.json() as CreateBody;
  } catch {
    return jsonError("validation", "Тело запроса должно быть JSON.", 422, cors);
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (title.length < 1 || title.length > 120) {
    return jsonError("validation", "title должен быть от 1 до 120 символов.", 422, cors);
  }

  const cameraStyle = typeof body.camera_style === "string"
    ? body.camera_style
    : "film35";
  if (!ALLOWED_STYLES.includes(cameraStyle)) {
    return jsonError(
      "validation",
      `camera_style должен быть одним из: ${ALLOWED_STYLES.join(", ")}.`,
      422,
      cors,
    );
  }

  let shotsPerGuest = DEFAULT_SHOTS;
  if (body.shots_per_guest !== undefined && body.shots_per_guest !== null) {
    if (
      typeof body.shots_per_guest !== "number" ||
      !Number.isInteger(body.shots_per_guest) ||
      body.shots_per_guest < 1 ||
      body.shots_per_guest > 1000
    ) {
      return jsonError(
        "validation",
        "shots_per_guest должен быть int от 1 до 1000.",
        422,
        cors,
      );
    }
    shotsPerGuest = body.shots_per_guest;
  }

  const revealAt = parseIso(body.reveal_at);
  if (!revealAt.ok) {
    return jsonError("validation", "reveal_at должен быть ISO-датой или null.", 422, cors);
  }
  const startsAt = parseIso(body.starts_at);
  if (!startsAt.ok) {
    return jsonError("validation", "starts_at должен быть ISO-датой или null.", 422, cors);
  }

  // 3. Профиль хоста в public.users. Триггера on auth.users тут нет, поэтому строку
  // создаёт эта функция (service-role, минуя RLS). users.phone — NOT NULL UNIQUE.
  // На проде phone приходит из SMS-входа (userData.user.phone). На локалке вход по
  // email-OTP не даёт phone → используем детерминированную заглушку 'pending-<uid>',
  // которая уникальна на пользователя и не конфликтует с реальными номерами.
  // TODO(prod): после перехода на телефон+SMS заглушка не понадобится.
  const u = userData.user as {
    phone?: string | null;
    email?: string | null;
    user_metadata?: Record<string, unknown> | null;
  };
  const metaPhone = typeof u.user_metadata?.phone === "string"
    ? (u.user_metadata.phone as string)
    : null;
  const phone = (u.phone && u.phone.length > 0 ? u.phone : null) ??
    metaPhone ??
    `pending-${authUid}`;

  const { error: profileErr } = await supabase
    .from("users")
    .upsert(
      { id: authUid, phone, email: u.email ?? null, display_name: null },
      { onConflict: "id", ignoreDuplicates: true },
    );
  if (profileErr) {
    return jsonError("server_error", "Не удалось создать профиль хоста.", 500, cors);
  }

  // 4. План free: retention из таблицы plans (НЕ хардкод) → expires_at.
  const { data: plan, error: planErr } = await supabase
    .from("plans")
    .select("retention_days")
    .eq("code", "free")
    .maybeSingle();
  if (planErr || !plan) {
    return jsonError("server_error", "Тариф free не найден.", 500, cors);
  }
  const expiresAt = new Date(
    Date.now() + plan.retention_days * 24 * 60 * 60 * 1000,
  ).toISOString();

  // 5+6. Генерируем уникальный short_code и вставляем событие. Уникальность гарантирует
  // UNIQUE-индекс events.short_code: при коллизии insert падает (code 23505) — повторяем.
  let created:
    | { id: string; short_code: string; expires_at: string }
    | null = null;
  for (let attempt = 0; attempt < SHORT_CODE_ATTEMPTS; attempt++) {
    const shortCode = genShortCode();
    const { data: row, error: insErr } = await supabase
      .from("events")
      .insert({
        host_id: authUid,
        title,
        camera_style: cameraStyle,
        shots_per_guest: shotsPerGuest,
        plan: "free",
        status: "draft",
        reveal_at: revealAt.value,
        starts_at: startsAt.value,
        short_code: shortCode,
        expires_at: expiresAt,
      })
      .select("id, short_code, expires_at")
      .single();

    if (!insErr && row) {
      created = row as { id: string; short_code: string; expires_at: string };
      break;
    }
    // 23505 = unique_violation: коллизия short_code → пробуем снова.
    const code = (insErr as { code?: string } | null)?.code;
    if (code !== "23505") {
      return jsonError("server_error", "Не удалось создать событие.", 500, cors);
    }
  }
  if (!created) {
    return jsonError("server_error", "Не удалось подобрать short_code.", 500, cors);
  }

  // 7. QR: join_url + рендер PNG в приватный бакет. Домен из env (на проде kadr.ru).
  const joinBase = Deno.env.get("JOIN_BASE_URL") ?? "https://kadr.ru";
  const joinUrl = `${joinBase.replace(/\/+$/, "")}/j/${created.short_code}`;

  let qrPath: string | null = null;
  let qrUrl: string | null = null;

  const png = await renderQrPng(joinUrl);
  if (png) {
    const path = `qr/${created.short_code}.png`;
    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(path, png, { contentType: "image/png", upsert: true });
    if (!upErr) {
      qrPath = path;
      const { data: signed } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(path, TTL);
      if (signed?.signedUrl) qrUrl = toPublicUrl(signed.signedUrl);
    }
    // Сбой загрузки/подписи QR не критичен: join_url отдаём всегда.
  }

  return jsonOk({
    id: created.id,
    short_code: created.short_code,
    join_url: joinUrl,
    qr_path: qrPath,
    qr_url: qrUrl,
    plan: "free",
    expires_at: created.expires_at,
  }, 201, cors);
});
