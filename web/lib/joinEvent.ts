import { supabase } from './supabase'
import type { JoinEventRequest, JoinEventResponse, ApiError } from './types'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export type JoinResult =
  | { ok: true; data: JoinEventResponse }
  | { ok: false; code: string; message: string }

/**
 * Вступление гостя в событие.
 * 1. signInAnonymously() — получаем анон-JWT
 * 2. POST /functions/v1/join-event — Edge Function (service role), проверяет лимиты,
 *    создаёт guests + пишет consents (IP/UA) — всё за один вызов.
 *
 * SPECIFICATION §6.3: идемпотентно по (event_id, auth_uid).
 */
export async function joinEvent(req: JoinEventRequest): Promise<JoinResult> {
  // Шаг 1: получаем анонимную сессию (или используем существующую)
  let accessToken: string

  const { data: sessionData } = await supabase.auth.getSession()
  if (sessionData.session?.access_token) {
    accessToken = sessionData.session.access_token
  } else {
    const { data: anonData, error: anonError } = await supabase.auth.signInAnonymously()
    if (anonError || !anonData.session) {
      return {
        ok: false,
        code: 'auth_error',
        message: 'Не удалось создать анонимную сессию. Попробуйте ещё раз.',
      }
    }
    accessToken = anonData.session.access_token
  }

  // Шаг 2: вызываем Edge Function join-event.
  // На холодном старте Edge Runtime первый запрос к функции может зависнуть
  // (прогрев изолята). Защищаемся таймаутом + одним ретраем, чтобы первый гость
  // события не залип на «Подключение…». join-event идемпотентен по
  // (event_id, auth_uid), поэтому повтор безопасен (вернёт того же гостя).
  const REQUEST_TIMEOUT_MS = 12_000
  const callJoin = async (): Promise<Response> => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      return await fetch(`${SUPABASE_URL}/functions/v1/join-event`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
          'apikey': SUPABASE_ANON_KEY,
        },
        body: JSON.stringify(req),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timer)
    }
  }

  let response: Response
  try {
    response = await callJoin()
  } catch {
    // Первая попытка не дошла (таймаут/обрыв) — пробуем ещё раз (изолят уже прогрет).
    try {
      response = await callJoin()
    } catch {
      return {
        ok: false,
        code: 'network_error',
        message: 'Сервер не отвечает. Проверьте соединение и попробуйте снова.',
      }
    }
  }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    return {
      ok: false,
      code: 'parse_error',
      message: 'Неожиданный ответ от сервера.',
    }
  }

  if (!response.ok) {
    const errBody = body as ApiError
    const code = errBody?.error?.code ?? 'unknown_error'
    const message = errBody?.error?.message ?? 'Произошла ошибка. Попробуйте снова.'
    return { ok: false, code, message }
  }

  return { ok: true, data: body as JoinEventResponse }
}
