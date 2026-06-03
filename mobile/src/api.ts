// API-слой: все запросы к Supabase (Edge Functions + PostgREST)
// Фото отдаются только через подписанный URL (инвариант 152-ФЗ)

import { BASE_URL, ANON_KEY } from './config';
import type {
  Event,
  Photo,
  CameraStyle,
  CreateEventResponse,
  PhotoUrlResponse,
} from './types';

// --------------------------------------------------------------------------
// Хранение токена (модульная переменная, без внешних зависимостей)
// --------------------------------------------------------------------------

let _authToken: string | null = null;

export function setAuthToken(token: string): void {
  _authToken = token;
}

export function getAuthToken(): string | null {
  return _authToken;
}

export function clearAuthToken(): void {
  _authToken = null;
}

// --------------------------------------------------------------------------
// Базовые хелперы
// --------------------------------------------------------------------------

function buildHeaders(withAuth = true): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    apikey: ANON_KEY,
  };
  if (withAuth && _authToken) {
    headers['Authorization'] = `Bearer ${_authToken}`;
  }
  return headers;
}

interface ApiErrorBody {
  error?: { code?: string; message?: string };
  message?: string;
  msg?: string;
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (res.ok) {
    const text = await res.text();
    if (!text) return {} as T;
    return JSON.parse(text) as T;
  }

  let body: ApiErrorBody = {};
  try {
    body = (await res.json()) as ApiErrorBody;
  } catch {
    // пустое тело или не JSON
  }

  const code =
    body?.error?.code ?? String(res.status);
  const message =
    body?.error?.message ??
    body?.message ??
    body?.msg ??
    `HTTP ${res.status}`;

  throw new Error(`[${code}] ${message}`);
}

// --------------------------------------------------------------------------
// Auth
// --------------------------------------------------------------------------

/** Демо-вход: анонимная сессия Supabase. На проде заменяется телефон+OTP. */
export async function signInAnonymously(): Promise<string> {
  const res = await fetch(`${BASE_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: buildHeaders(false),
    body: JSON.stringify({}),
  });

  interface SignupResponse {
    access_token?: string;
    session?: { access_token?: string };
  }

  const data = await handleResponse<SignupResponse>(res);
  const token = data.access_token ?? data.session?.access_token;
  if (!token) throw new Error('[no_token] Сервер не вернул токен');
  return token;
}

// --------------------------------------------------------------------------
// События
// --------------------------------------------------------------------------

export interface CreateEventPayload {
  title: string;
  camera_style: CameraStyle;
  shots_per_guest: number;
  reveal_at: string | null;
  starts_at: string | null;
}

export async function createEvent(
  payload: CreateEventPayload,
): Promise<CreateEventResponse> {
  const res = await fetch(`${BASE_URL}/functions/v1/create-event`, {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify(payload),
  });
  return handleResponse<CreateEventResponse>(res);
}

export async function listEvents(): Promise<Event[]> {
  const res = await fetch(
    `${BASE_URL}/rest/v1/events?select=*&order=created_at.desc`,
    {
      method: 'GET',
      headers: buildHeaders(),
    },
  );
  return handleResponse<Event[]>(res);
}

export async function revealEvent(
  eventId: string,
): Promise<{ ok: boolean; status: string }> {
  const res = await fetch(`${BASE_URL}/functions/v1/reveal`, {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify({ event_id: eventId }),
  });
  return handleResponse<{ ok: boolean; status: string }>(res);
}

// --------------------------------------------------------------------------
// Фото
// --------------------------------------------------------------------------

export async function listPhotos(eventId: string): Promise<Photo[]> {
  const url =
    `${BASE_URL}/rest/v1/photos` +
    `?event_id=eq.${eventId}` +
    `&uploaded=eq.true` +
    `&select=id,guest_id,filter,taken_at,is_favorite` +
    `&order=taken_at.desc`;

  const res = await fetch(url, {
    method: 'GET',
    headers: buildHeaders(),
  });
  return handleResponse<Photo[]>(res);
}

/**
 * Получить подписанный URL для отображения фото.
 * Инвариант 152-ФЗ: фото только через /photo-url, бакет приватный.
 */
export async function photoURL(photoId: string): Promise<PhotoUrlResponse> {
  const res = await fetch(
    `${BASE_URL}/functions/v1/photo-url?photo_id=${photoId}`,
    {
      method: 'GET',
      headers: buildHeaders(),
    },
  );
  return handleResponse<PhotoUrlResponse>(res);
}

export async function setFavorite(photoId: string, value: boolean): Promise<void> {
  const res = await fetch(
    `${BASE_URL}/rest/v1/photos?id=eq.${photoId}`,
    {
      method: 'PATCH',
      headers: {
        ...buildHeaders(),
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ is_favorite: value }),
    },
  );
  await handleResponse<unknown>(res);
}
