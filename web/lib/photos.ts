/**
 * lib/photos.ts — клиентский модуль работы с фото.
 * SPECIFICATION §6.3, §5.
 *
 * Инварианты:
 * - Фото отдаются только по подписанному URL с TTL (photo-url Edge Function).
 * - Фильтр применяется на клиенте ДО загрузки, оригинал не хранится.
 * - Нет зарубежних сервисов/CDN/библиотек.
 */

import { supabase } from './supabase'
import type { CameraStyle } from './types'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// TTL подписанного URL от бэкенда — 600 секунд. Обновляем за 60с до истечения.
const URL_TTL_MS = 600_000
const URL_REFRESH_BEFORE_MS = 60_000

// ---- Типы ---------------------------------------------------------------

export interface PhotoRow {
  id: string
  guest_id: string
  filter: CameraStyle
  taken_at: string
  uploaded: boolean
}

export type UploadUrlResult =
  | { ok: true; photo_id: string; storage_path: string; token: string; upload_url: string; expires_in: number }
  | { ok: false; code: string; message: string }

export type ConfirmResult =
  | { ok: true; thumb_ready: boolean }
  | { ok: false; code: string; message: string }

export type ListPhotosResult =
  | { ok: true; photos: PhotoRow[] }
  | { ok: false; code: string; message: string }

export type PhotoUrlResult =
  | { ok: true; url: string }
  | { ok: false; code: string; message: string }

export type DiscardResult =
  | { ok: true }
  | { ok: false; code: string; message: string }

// ---- Кэш подписанных URL ------------------------------------------------

interface CachedUrl {
  url: string
  fetchedAt: number // Date.now()
}

const urlCache = new Map<string, CachedUrl>()

// ---- Вспомогательное: получить токен доступа ----------------------------

export async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? null
}

// ---- requestUploadUrl ---------------------------------------------------

/**
 * Запрашивает подписанный URL на загрузку кадра.
 * POST /functions/v1/upload-url
 * Ошибки: 401 unauthorized, 403 not_guest, 409 shot_limit_reached,
 *         410 event_closed, 422 validation.
 */
export async function requestUploadUrl(
  eventId: string,
  filter: CameraStyle,
  width: number,
  height: number,
): Promise<UploadUrlResult> {
  const token = await getAccessToken()
  if (!token) {
    return { ok: false, code: 'auth_error', message: 'Нет активной сессии. Войдите заново.' }
  }

  let response: Response
  try {
    response = await fetch(`${SUPABASE_URL}/functions/v1/upload-url`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'apikey': SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ event_id: eventId, filter, width, height }),
    })
  } catch {
    return { ok: false, code: 'network_error', message: 'Нет соединения с сервером.' }
  }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    return { ok: false, code: 'parse_error', message: 'Неожиданный ответ от сервера.' }
  }

  if (!response.ok) {
    const err = body as { error?: { code?: string; message?: string } }
    return {
      ok: false,
      code: err?.error?.code ?? 'unknown_error',
      message: err?.error?.message ?? 'Ошибка при запросе URL загрузки.',
    }
  }

  const data = body as {
    photo_id: string
    upload_url: string
    token: string
    storage_path: string
    expires_in: number
  }
  return {
    ok: true,
    photo_id: data.photo_id,
    upload_url: data.upload_url,
    token: data.token,
    storage_path: data.storage_path,
    expires_in: data.expires_in,
  }
}

// ---- uploadBlob ---------------------------------------------------------

/**
 * Загружает Blob в Storage через supabase-js uploadToSignedUrl.
 * ВАЖНО: НЕ используем прямой fetch(upload_url) — на локалке Kong даёт внутренний хост.
 * supabase-js сам строит URL через NEXT_PUBLIC_SUPABASE_URL + path + token.
 */
export async function uploadBlob(
  storagePath: string,
  token: string,
  blob: Blob,
): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  const { error } = await supabase.storage
    .from('event-photos')
    .uploadToSignedUrl(storagePath, token, blob, { contentType: 'image/jpeg' })

  if (error) {
    return {
      ok: false,
      code: 'upload_error',
      message: error.message ?? 'Ошибка загрузки фото в хранилище.',
    }
  }
  return { ok: true }
}

// ---- confirmUpload ------------------------------------------------------

/**
 * Подтверждает загрузку кадра.
 * POST /functions/v1/confirm-upload
 */
export async function confirmUpload(photoId: string): Promise<ConfirmResult> {
  const token = await getAccessToken()
  if (!token) {
    return { ok: false, code: 'auth_error', message: 'Нет активной сессии.' }
  }

  let response: Response
  try {
    response = await fetch(`${SUPABASE_URL}/functions/v1/confirm-upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'apikey': SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ photo_id: photoId }),
    })
  } catch {
    return { ok: false, code: 'network_error', message: 'Нет соединения с сервером.' }
  }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    return { ok: false, code: 'parse_error', message: 'Неожиданный ответ от сервера.' }
  }

  if (!response.ok) {
    const err = body as { error?: { code?: string; message?: string } }
    return {
      ok: false,
      code: err?.error?.code ?? 'unknown_error',
      message: err?.error?.message ?? 'Ошибка подтверждения загрузки.',
    }
  }

  const data = body as { ok: boolean; thumb_ready: boolean }
  return { ok: true, thumb_ready: data.thumb_ready ?? false }
}

// ---- discardPhoto -------------------------------------------------------

/**
 * Отменяет зарезервированный кадр (uploaded=false) — best-effort, не бросает.
 * POST /functions/v1/discard-photo
 * Вызывается при «Переснять», чтобы не оставлять мусор в БД.
 */
export async function discardPhoto(photoId: string): Promise<DiscardResult> {
  try {
    const token = await getAccessToken()
    if (!token) {
      return { ok: false, code: 'auth_error', message: 'Нет активной сессии.' }
    }

    const response = await fetch(`${SUPABASE_URL}/functions/v1/discard-photo`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'apikey': SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ photo_id: photoId }),
    })

    if (!response.ok) {
      let code = 'unknown_error'
      try {
        const err = await response.json() as { error?: { code?: string } }
        code = err?.error?.code ?? code
      } catch { /* ignore */ }
      return { ok: false, code, message: 'Не удалось отменить резерв кадра.' }
    }

    return { ok: true }
  } catch {
    // best-effort: сеть недоступна или иная ошибка — не блокируем UI
    return { ok: false, code: 'network_error', message: 'Нет соединения с сервером.' }
  }
}

// ---- listPhotos ---------------------------------------------------------

/**
 * Читает список кадров через PostgREST под RLS.
 * RLS сам режет видимость: гость видит свои всегда, чужие — после проявки.
 * authorGuestId — фильтр «по гостям» (таб «Мои кадры»).
 */
export async function listPhotos(
  eventId: string,
  authorGuestId?: string,
): Promise<ListPhotosResult> {
  let query = supabase
    .from('photos')
    .select('id, guest_id, filter, taken_at, uploaded')
    .eq('event_id', eventId)
    .eq('uploaded', true)
    .order('taken_at', { ascending: false })

  if (authorGuestId) {
    query = query.eq('guest_id', authorGuestId)
  }

  const { data, error } = await query

  if (error) {
    return {
      ok: false,
      code: 'fetch_error',
      message: error.message ?? 'Ошибка загрузки списка фото.',
    }
  }

  return { ok: true, photos: (data ?? []) as PhotoRow[] }
}

// ---- getPhotoUrl --------------------------------------------------------

/**
 * Получает подписанный URL для отдачи фото.
 * GET /functions/v1/photo-url?photo_id=...
 * Кэширует результат на ~9 минут (TTL 600с, обновляем за 60с до истечения).
 *
 * ИНВАРИАНТ: никаких публичных URL, только подписанные с TTL.
 */
export async function getPhotoUrl(photoId: string): Promise<PhotoUrlResult> {
  // Проверяем кэш
  const cached = urlCache.get(photoId)
  if (cached) {
    const age = Date.now() - cached.fetchedAt
    if (age < URL_TTL_MS - URL_REFRESH_BEFORE_MS) {
      return { ok: true, url: cached.url }
    }
  }

  const token = await getAccessToken()
  if (!token) {
    return { ok: false, code: 'auth_error', message: 'Нет активной сессии.' }
  }

  let response: Response
  try {
    response = await fetch(
      `${SUPABASE_URL}/functions/v1/photo-url?photo_id=${encodeURIComponent(photoId)}`,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'apikey': SUPABASE_ANON_KEY,
        },
      },
    )
  } catch {
    return { ok: false, code: 'network_error', message: 'Нет соединения с сервером.' }
  }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    return { ok: false, code: 'parse_error', message: 'Неожиданный ответ.' }
  }

  if (!response.ok) {
    const err = body as { error?: { code?: string; message?: string } }
    return {
      ok: false,
      code: err?.error?.code ?? 'unknown_error',
      message: err?.error?.message ?? 'Ошибка получения ссылки на фото.',
    }
  }

  const data = body as { url: string; expires_in: number }
  urlCache.set(photoId, { url: data.url, fetchedAt: Date.now() })
  return { ok: true, url: data.url }
}
