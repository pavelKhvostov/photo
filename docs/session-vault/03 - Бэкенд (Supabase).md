---
type: note
tags: [кадр, backend, rls, supabase]
---

# 03 — Бэкенд (Supabase)

[[00 - Карта проекта|← к карте]]

## Таблицы (миграция 0001)

`users`, `events`, `guests`, `photos`, `consents`, `plans`, `subscriptions`, `payments`, `deletion_requests` — все с **RLS** (инвариант, [[05 - Инварианты 152-ФЗ]]).

- `id` — `uuid default gen_random_uuid()`; время — `timestamptz`.
- Перечисления — `text` + `CHECK` (не enum-типы Postgres).
- Деньги — в копейках (`int`). Лимиты/цены — из таблицы `plans`.
- Storage-путь: `{event_id}/{guest_id}/{photo_id}.jpg`, бакет `event-photos` приватный.

## Security-definer функции (для RLS)

- `is_event_host(event)` — текущий пользователь хост события.
- `current_guest_id(event)` — guest_id анон-сессии в событии.
- `is_event_revealed(event)` — наступила ли «проявка» (`reveal_at <= now()` или `status='revealed'` или `reveal_at is null`).

## Миграции

| Файл | Что |
|---|---|
| `0001_init.sql` | таблицы + RLS + функции + бакет |
| `0002_fix_events_guest_select.sql` | фикс RLS: `g.event_id = events.id` (был неквалифицированный `id`, ловил `guests.id`) — см. [[06 - Грабли и решения]] |
| `0003_join_guest_rpc.sql` | `join_guest_atomic()` — атомарное вступление под `pg_advisory_xact_lock` (защита от гонки на лимите гостей) |

## Edge Functions (Deno, service role)

| Функция | Метод | Назначение | Коды ошибок |
|---|---|---|---|
| `join-event` | POST | вступление гостя, запись consent (IP/UA), идемпотентность | 401, 404, 409 `guests_limit_reached`, 410, 422 `consent_required` |
| `upload-url` | POST | подписанный PUT-URL, лимит кадров | 401, 403 `not_guest`, 409 `shot_limit_reached`, 410, 422 |
| `confirm-upload` | POST | `uploaded=true` | 401, 403, 404 |
| `photo-url` | GET | подписанный GET-URL + проверка «проявки» | 401, 403 `forbidden`, 404 |
| `public-event` | GET | превью события без PII | 404, 410, 422 |

Общие хелперы: `_shared/cors.ts` (GET/POST/OPTIONS), `_shared/errors.ts` (формат `{ error: { code, message } }`).

> [!note] Подмена хоста подписанных URL
> На локалке storage подписывает URL внутренним `http://kong:8000` (не резолвится из браузера). `photo-url` и `public-event` имеют `toPublicUrl()` — подменяют origin на `PUBLIC_STORAGE_URL`/`PUBLIC_SUPABASE_URL`. На проде = no-op. Это и решило показ фото с телефона.

## Тест RLS

`supabase/tests/rls_reveal_test.sql` — самопроверяющийся (plpgsql, без pgTAP). 4 CHECK:
1. хост видит все фото; 2. гость до проявки — только своё; 3. после проявки — все; 4. гость видит своё событие по short_code.
