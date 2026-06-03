// Перечисления согласно SPECIFICATION §1

export type CameraStyle = 'film35' | 'vintage' | 'bw' | 'summer';
export type EventStatus = 'draft' | 'live' | 'revealed' | 'archived' | 'deleted';
export type PlanCode = 'free' | 'party' | 'wedding' | 'unlimited';

export interface Event {
  id: string;
  title: string;
  camera_style: CameraStyle;
  shots_per_guest: number;
  plan: PlanCode;
  status: EventStatus;
  reveal_at: string | null;
  short_code: string;
  starts_at: string | null;
  expires_at: string;
  created_at: string;
  // Опциональные поля из ответа create-event
  join_url?: string;
  qr_url?: string;
}

export interface Photo {
  id: string;
  event_id: string;
  guest_id: string;
  filter: CameraStyle;
  taken_at: string;
  is_favorite: boolean;
  uploaded: boolean;
  // URL получается отдельно через /photo-url
  signedUrl?: string;
}

export interface CreateEventResponse {
  id: string;
  short_code: string;
  join_url: string;
  qr_url: string;
  plan: PlanCode;
  expires_at: string;
}

export interface PhotoUrlResponse {
  url: string;
  expires_in: number;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
  };
}

// Русские названия стилей камеры
export const CAMERA_STYLE_LABELS: Record<CameraStyle, string> = {
  film35: 'Плёнка 35мм',
  vintage: 'Винтаж',
  bw: 'Ч-Б',
  summer: 'Лето',
};

// Русские названия статусов
export const EVENT_STATUS_LABELS: Record<EventStatus, string> = {
  draft: 'Черновик',
  live: 'Активно',
  revealed: 'Проявлено',
  archived: 'Архив',
  deleted: 'Удалено',
};
