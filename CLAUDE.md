# CLAUDE.md — «Кадр» (событийная камера)

Аналог pov.camera для РФ: гость заходит по QR/ссылке без установки, снимает на
«плёночную» камеру, кадры летят в общую галерею события. Хост — на iOS.
Полная спецификация: `SPECIFICATION.md`. Идея: `PROJECT_IDEA.md`.

## ⛔ Инварианты (нарушать НЕЛЬЗЯ — проверяет security-agent)
1. **Локализация 152-ФЗ:** Postgres + Storage + деплой — ТОЛЬКО в РФ (self-hosted
   Supabase в Yandex/VK Cloud). Запрещены: Supabase Cloud, Vercel, Firebase, Stripe.
2. **Никакого распознавания/детекции лиц** — нигде. Это вывело бы нас в биометрию (ст. 11).
3. **RLS включён на КАЖДОЙ таблице.** Нет таблицы без политик.
4. **Аналитика только российская** (AppMetrica/Метрика). Нет Google/Firebase SDK.
5. Фото отдаются ТОЛЬКО подписанным URL с TTL. Публичных бакетов нет.
6. Согласие пишется в `consents` (IP/UA/версия) ДО первого кадра гостя.

## Стек
- iOS (хост): Swift / SwiftUI, камера + фильтры (Core Image).
- Web/PWA (гость): Next.js (App Router), камера через `getUserMedia`.
- Backend: self-hosted Supabase (Postgres, Auth, Storage, Realtime, Edge Functions/Deno).
- Хостинг/БД/S3: Yandex Cloud или VK Cloud (РФ).
- Оплата: ЮKassa + СБП. SMS-OTP: SMS Aero/SMSC. Пуши: APNs (только iOS).

## Структура
```
supabase/migrations/   — SQL (таблицы, RLS, функции, pg_cron)
supabase/functions/    — Edge Functions (Deno)
web/                   — Next.js PWA (гость)
ios/                   — SwiftUI (хост)
.claude/agents|rules|skills
```

## Архитектура (коротко)
- Хост: телефон+OTP. Гость: анонимная сессия Supabase (`signInAnonymously`).
- Вступление, выдача upload-URL, биллинг, согласия — через Edge Functions (service role),
  чтобы безопасно проверять лимиты/писать журнал. CRUD-чтение — PostgREST под RLS.
- «Проявка»: чужие фото видны только после `events.reveal_at` (логика в RLS-политике
  `photos` + функции `is_event_revealed`). Авто-проявка — pg_cron.
- Retention: `events.expires_at` → cron помечает `deleted` → `purge-expired` чистит Storage.

## Конвенции
- Все `id` — `uuid default gen_random_uuid()`; время — `timestamptz`.
- Перечисления — `text` + `CHECK` (см. SPECIFICATION §1). Не `enum`-типы Postgres.
- Лимиты/цены — из таблицы `plans`, НЕ хардкодить.
- Деньги — в копейках (`int`).
- Ошибки API: `{ "error": { "code": "...", "message": "..." } }` + корректный HTTP-код.
- Идемпотентность: join по `(event_id, auth_uid)`, платежи по `provider_id`.
- Storage-путь: `event-photos/{event_id}/{guest_id}/{photo_id}.jpg`.

## Команды
```bash
supabase start                     # локальный стек
supabase db reset                  # применить миграции
supabase functions serve           # Edge Functions локально
cd web && npm run dev              # гостевой PWA
```

## Рабочий процесс (GSD)
- Новая фича: `/gsd:plan-phase N` → `/gsd:execute-plan`. Мелочь: `/gsd:quick`.
- БД: сначала миграция в `supabase/migrations/XXXX_*.sql`, RLS — в той же миграции.
- Перед мержем: security-agent (RLS + 152-ФЗ чеклист) и qa-reviewer.
- CLAUDE.md держать ≤120 строк. Детали — в SPECIFICATION.md, не сюда.

## MCP
- Context7 — актуальная документация (Next.js, Supabase, ЮKassa SDK).
- Supabase MCP — миграции/запросы к локальному/российскому инстансу.
