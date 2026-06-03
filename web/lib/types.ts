// Типы, соответствующие SPECIFICATION.md §1 и §6.3

export type CameraStyle = 'film35' | 'vintage' | 'bw' | 'summer'
export type EventStatus = 'draft' | 'live' | 'revealed' | 'archived' | 'deleted'
export type ConsentPurpose = 'service' | 'photo_upload'

// Тело запроса POST join-event
export interface JoinEventRequest {
  short_code: string
  display_name: string
  consent: {
    policy_version: string
    purpose: ConsentPurpose
  }
}

// Успешный ответ POST join-event (201/200)
export interface JoinEventResponse {
  guest_id: string
  event_id: string
  shots_left: number        // 1_000_000 = безлимит (из плана 'wedding'/'unlimited' с shots_per_guest=0)
  reveal_at: string | null  // ISO timestamp или null = мгновенный показ
  camera_style: CameraStyle
  starts_at: string | null  // ISO timestamp или null — когда начинается съёмка
}

// Формат ошибки API (SPECIFICATION §6 конвенции)
export interface ApiError {
  error: {
    code: string
    message: string
  }
}

// Данные гостя после вступления — сохраняются в sessionStorage
export interface GuestSession {
  guest_id: string
  event_id: string
  shots_left: number
  reveal_at: string | null
  camera_style: CameraStyle
  short_code: string
  starts_at: string | null  // ISO timestamp или null — когда начинается съёмка
}

// Ключ для sessionStorage
export const GUEST_SESSION_KEY = 'kadr_guest_session'
