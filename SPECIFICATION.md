---
project: Кадр — событийная камера
layer: 2 / SPECIFICATION
methodology: Spec-First + GSD
status: draft
depends_on: PROJECT_IDEA.md
updated: 2026-06-02
tags: [specification, spec-first, gsd, 152-fz, supabase, rls, ios, pwa]
---

# SPECIFICATION — «Кадр»

> Layer 2 методологии Spec-First. Детальный чертёж для автономной сборки Claude Code +
> GSD-субагентами. Формат таков, что реализация идёт **без уточняющих вопросов**.
> Источник контекста: `PROJECT_IDEA.md`.

> [!warning] Инварианты проекта (нарушать нельзя)
> 1. **Локализация (152-ФЗ ст. 18.5):** Postgres + Storage + деплой — только в РФ
>    (self-hosted Supabase в Yandex/VK Cloud). Запрещены: Supabase Cloud, Vercel, Firebase.
> 2. **Нет распознавания лиц** нигде в коде (вне биометрии, ст. 11).
> 3. **RLS включён на ВСЕХ таблицах.** Нет таблицы без политик.
> 4. Аналитика только российская (AppMetrica/Метрика). Никаких Google/Firebase SDK.
> 5. Каждое фото отдаётся только по **подписанному URL с TTL**, не публично.

---

## 1 · Глоссарий и константы

| Термин | Значение |
|---|---|
| **Хост (host)** | организатор события, аутентифицирован по телефону (OTP) |
| **Гость (guest)** | участник, входит по QR/ссылке, анонимная сессия Supabase |
| **Событие (event)** | «момент»: свадьба/вечеринка; контейнер фото |
| **Проявка (reveal)** | момент времени, до которого общая галерея скрыта |
| **Кадр (photo)** | загруженное фото с метаданными |

```ts
// Перечисления (хранятся как text + CHECK / Postgres enum)
type CameraStyle = 'film35' | 'vintage' | 'bw' | 'summer';
type EventStatus = 'draft' | 'live' | 'revealed' | 'archived' | 'deleted';
type PlanCode    = 'free' | 'party' | 'wedding' | 'unlimited';
type SubjectType = 'host' | 'guest';
type ConsentPurpose = 'service' | 'photo_upload';
type PaymentStatus  = 'pending' | 'succeeded' | 'canceled';
```

Лимиты по планам — в таблице `plans` (раздел 2.6), не хардкодить в коде.

---

## 2 · Модель данных (Postgres)

> Типы — как в SQL. Все `id` — `uuid default gen_random_uuid()`. Все временные метки —
> `timestamptz`. Схема — `public`. Миграция → `supabase/migrations/0001_init.sql`.

### 2.1 `users` — профили хостов

```sql
create table public.users (
  id          uuid primary key references auth.users(id) on delete cascade,
  phone       text unique not null,
  email       text,
  display_name text,
  created_at  timestamptz not null default now()
);
```

### 2.2 `events`

```sql
create table public.events (
  id              uuid primary key default gen_random_uuid(),
  host_id         uuid not null references public.users(id) on delete cascade,
  title           text not null check (char_length(title) between 1 and 120),
  cover_path      text,                          -- путь в Storage, не публичный URL
  camera_style    text not null default 'film35'
                    check (camera_style in ('film35','vintage','bw','summer')),
  shots_per_guest int  not null default 20 check (shots_per_guest between 1 and 1000),
  plan            text not null default 'free'
                    check (plan in ('free','party','wedding','unlimited')),
  status          text not null default 'draft'
                    check (status in ('draft','live','revealed','archived','deleted')),
  reveal_at       timestamptz,                   -- null = мгновенный показ
  short_code      text unique not null,          -- для короткой ссылки/QR, напр. 'k7p2qx'
  starts_at       timestamptz,
  expires_at      timestamptz not null,          -- retention: дата автоудаления
  created_at      timestamptz not null default now()
);

create index on public.events (host_id);
create index on public.events (short_code);
create index on public.events (expires_at);
```

### 2.3 `guests`

```sql
create table public.guests (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid not null references public.events(id) on delete cascade,
  auth_uid     uuid not null references auth.users(id) on delete cascade, -- анон-сессия
  display_name text not null check (char_length(display_name) between 1 and 60),
  consent_id   uuid references public.consents(id),
  joined_at    timestamptz not null default now(),
  unique (event_id, auth_uid)
);

create index on public.guests (event_id);
create index on public.guests (auth_uid);
```

### 2.4 `photos`

```sql
create table public.photos (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid not null references public.events(id) on delete cascade,
  guest_id     uuid not null references public.guests(id) on delete cascade,
  storage_path text not null,                    -- event_id/guest_id/photo_id.jpg
  filter       text not null default 'film35'
                  check (filter in ('film35','vintage','bw','summer')),
  width        int,
  height       int,
  is_favorite  boolean not null default false,   -- отметка хоста
  uploaded     boolean not null default false,   -- подтверждённая загрузка
  taken_at     timestamptz not null default now()
);

create index on public.photos (event_id);
create index on public.photos (guest_id);
create index on public.photos (event_id, guest_id);
```

### 2.5 `consents` — журнал согласий (152-ФЗ)

```sql
create table public.consents (
  id           uuid primary key default gen_random_uuid(),
  subject_uid  uuid not null,                    -- auth.users.id хоста или гостя
  subject_type text not null check (subject_type in ('host','guest')),
  purpose      text not null check (purpose in ('service','photo_upload')),
  policy_version text not null,                  -- версия текста политики/согласия
  granted_at   timestamptz not null default now(),
  revoked_at   timestamptz,
  ip           inet,
  user_agent   text
);

create index on public.consents (subject_uid);
```

### 2.6 `plans` — справочник тарифов (публичное чтение)

```sql
create table public.plans (
  code           text primary key check (code in ('free','party','wedding','unlimited')),
  title          text not null,
  max_guests     int  not null,
  shots_per_guest int not null,                  -- 0 = безлимит
  retention_days int  not null,
  price_kopecks  int  not null,                  -- цена в копейках
  watermark      boolean not null default true
);

insert into public.plans (code,title,max_guests,shots_per_guest,retention_days,price_kopecks,watermark) values
  ('free','Free',10,20,7,0,true),
  ('party','Вечеринка',50,50,90,99000,false),
  ('wedding','Свадьба',150,0,365,299000,false),
  ('unlimited','Безлимит',100000,0,365,599000,false);
```

### 2.7 `subscriptions` / `payments`

```sql
create table public.subscriptions (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.events(id) on delete cascade,
  plan       text not null references public.plans(code),
  active      boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.payments (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references public.events(id) on delete cascade,
  host_id       uuid not null references public.users(id) on delete cascade,
  plan          text not null references public.plans(code),
  amount_kopecks int not null,
  status        text not null default 'pending'
                  check (status in ('pending','succeeded','canceled')),
  provider      text not null default 'yookassa',
  provider_id   text,                            -- id платежа в ЮKassa (идемпотентность)
  created_at    timestamptz not null default now(),
  unique (provider, provider_id)
);
```

### 2.8 `deletion_requests` — права субъектов (152-ФЗ)

```sql
create table public.deletion_requests (
  id           uuid primary key default gen_random_uuid(),
  subject_uid  uuid not null,
  scope        text not null check (scope in ('photo','guest','account')),
  target_id    uuid,                             -- фото/гость, если точечно
  requested_at timestamptz not null default now(),
  processed_at timestamptz
);
```

---

## 3 · Вспомогательные функции (security definer)

> Нужны для RLS. Создаются с `security definer`, `search_path = public`.

```sql
-- Является ли текущий пользователь хостом события
create or replace function public.is_event_host(p_event uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.events e
    where e.id = p_event and e.host_id = auth.uid()
  );
$$;

-- guest_id текущей анон-сессии в рамках события
create or replace function public.current_guest_id(p_event uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select g.id from public.guests g
  where g.event_id = p_event and g.auth_uid = auth.uid()
  limit 1;
$$;

-- Раскрыта ли общая галерея (наступила проявка)
create or replace function public.is_event_revealed(p_event uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.events e
    where e.id = p_event
      and (e.reveal_at is null or e.reveal_at <= now() or e.status = 'revealed')
  );
$$;
```

---

## 4 · RLS-политики (на каждую таблицу)

> `alter table ... enable row level security;` для всех. Ниже — ключевые политики.
> Service-role (Edge Functions) обходит RLS — её используем для биллинга/вебхуков.

### 4.1 `users`

```sql
alter table public.users enable row level security;

create policy users_self_select on public.users
  for select using (id = auth.uid());
create policy users_self_update on public.users
  for update using (id = auth.uid());
-- insert делает триггер on auth.users или Edge Function (service role)
```

### 4.2 `events`

```sql
alter table public.events enable row level security;

-- Хост видит/правит только свои события
create policy events_host_all on public.events
  for all using (host_id = auth.uid()) with check (host_id = auth.uid());

-- Гость может прочитать событие, в которое вступил (для UI камеры/галереи).
-- ВАЖНО: внешнюю ссылку квалифицируем как events.id — иначе неквалифицированный id
-- связывается с guests.id (внутренняя область перекрывает внешнюю) и фильтр ломается.
create policy events_guest_select on public.events
  for select using (
    exists (select 1 from public.guests g
            where g.event_id = events.id and g.auth_uid = auth.uid())
  );
```

> Поиск события по `short_code` до вступления делает **Edge Function join-event**
> (service role), возвращая только публично-безопасные поля (title, cover, style).

### 4.3 `guests`

```sql
alter table public.guests enable row level security;

create policy guests_host_select on public.guests
  for select using (public.is_event_host(event_id));

create policy guests_self_select on public.guests
  for select using (auth_uid = auth.uid());

-- Вступление выполняется Edge Function (service role); прямой insert закрыт
```

### 4.4 `photos` — здесь живёт логика «проявки»

```sql
alter table public.photos enable row level security;

-- Хост видит все фото своего события
create policy photos_host_select on public.photos
  for select using (public.is_event_host(event_id));

-- Гость: всегда свои; чужие — только после проявки
create policy photos_guest_select on public.photos
  for select using (
    guest_id = public.current_guest_id(event_id)
    or public.is_event_revealed(event_id)
  );

-- Гость создаёт только свои кадры (страховка; основной путь — Edge Function)
create policy photos_guest_insert on public.photos
  for insert with check (guest_id = public.current_guest_id(event_id));

-- Избранное правит только хост
create policy photos_host_update on public.photos
  for update using (public.is_event_host(event_id));

-- Удаление: хост (любое) или гость (своё)
create policy photos_delete on public.photos
  for delete using (
    public.is_event_host(event_id)
    or guest_id = public.current_guest_id(event_id)
  );
```

### 4.5 `consents` / `deletion_requests`

```sql
alter table public.consents enable row level security;
create policy consents_self_select on public.consents
  for select using (subject_uid = auth.uid());
-- insert только service role (Edge Function фиксирует IP/UA)

alter table public.deletion_requests enable row level security;
create policy del_self_all on public.deletion_requests
  for all using (subject_uid = auth.uid()) with check (subject_uid = auth.uid());
```

### 4.6 `plans` / `subscriptions` / `payments`

```sql
alter table public.plans enable row level security;
create policy plans_public_read on public.plans for select using (true);

alter table public.subscriptions enable row level security;
create policy subs_host_read on public.subscriptions
  for select using (public.is_event_host(event_id));
-- запись — только service role (после вебхука оплаты)

alter table public.payments enable row level security;
create policy pay_host_read on public.payments
  for select using (host_id = auth.uid());
-- запись/обновление — только service role
```

### 4.7 Storage-политики (bucket `event-photos`, private)

```sql
-- Путь объекта: {event_id}/{guest_id}/{photo_id}.jpg
-- Загрузка: гость пишет только в свою папку; чтение — через подписанные URL,
-- которые выдаёт Edge Function после проверки RLS-видимости (раздел 6.3).
create policy storage_guest_upload on storage.objects
  for insert with check (
    bucket_id = 'event-photos'
    and (storage.foldername(name))[2] = public.current_guest_id(
          ((storage.foldername(name))[1])::uuid)::text
  );
```

---

## 5 · Хранилище и обработка фото

- **Bucket:** `event-photos` (private), российский S3 (Yandex Object Storage).
- **Путь:** `{event_id}/{guest_id}/{photo_id}.jpg`. Превью: `{...}/{photo_id}_thumb.jpg`.
- **Шифрование at-rest** на стороне Object Storage; TLS in-transit.
- **Отдача:** только подписанный URL c TTL (по умолчанию 600 c). Публичных URL нет.
- **Фильтры:** применяются на клиенте (iOS — Core Image; web — canvas/WebGL) **до** загрузки.
  Сервер хранит готовый кадр + значение `filter`. Оригинал без фильтра не хранится
  (минимизация данных).
- **Лимит размера:** ≤ 12 МБ на кадр; ресайз длинной стороны до 2048 px на клиенте.
- **Превью:** генерирует Edge Function `confirm-upload` (или Storage transform), 512 px.

---

## 6 · API (Edge Functions, Deno) + PostgREST

> База: `https://api.kadr.ru` (российский домен/облако). Аутентификация — `Authorization:
> Bearer <jwt>`. Тела — JSON. Ошибки — `{ "error": { "code": "...", "message": "..." } }`.

### 6.1 Auth (Supabase Auth + рос. SMS)

| Действие | Метод/путь | Тело | Ответ | Ошибки |
|---|---|---|---|---|
| Запрос OTP (хост) | `POST /auth/otp` | `{ phone }` | `{ sent: true }` | 400 `bad_phone`, 429 `rate_limited` |
| Подтверждение OTP | `POST /auth/verify` | `{ phone, code }` | `{ jwt, user }` | 401 `bad_code`, 410 `code_expired` |
| Анон-сессия гостя | Supabase `signInAnonymously()` | — | `{ jwt }` | — |

> OTP-провайдер — российский (SMS Aero/SMSC) через кастомный Auth hook.
> Anti-abuse: лимит 3 OTP / номер / 10 мин.

### 6.2 События

**Создание события** — `POST /events` (хост)
```jsonc
// body
{ "title": "Свадьба Ани и Пети", "camera_style": "film35",
  "shots_per_guest": 50, "reveal_at": "2026-07-12T20:00:00Z",
  "starts_at": "2026-07-12T14:00:00Z" }
// 201
{ "id": "...", "short_code": "k7p2qx",
  "join_url": "https://kadr.ru/j/k7p2qx",
  "qr_png_path": "qr/k7p2qx.png", "plan": "free", "expires_at": "2026-07-19T..." }
```
Логика: создаёт `events` (plan='free', `expires_at = now()+ plans.retention_days`),
генерирует `short_code` (6 символов base32, проверка уникальности), рендерит QR (PNG в
Storage). Ошибки: 401 `unauthorized`, 422 `validation`.

**Список своих событий** — `GET /events` → PostgREST, RLS отдаёт только свои.

**Превью события по коду (до вступления)** — `GET /public/events/:short_code`
(Edge Function, service role, без PII): `{ title, cover_url, camera_style, status }`.
Ошибки: 404 `not_found`, 410 `event_archived`.

**Ручная проявка** — `POST /events/:id/reveal` (хост):
ставит `status='revealed'`. Ошибки: 403 `not_host`, 409 `already_revealed`.

### 6.3 Гости и кадры

**Вступление гостя** — `POST /events/:short_code/join` (анон-jwt)
```jsonc
// body
{ "display_name": "Дима", "consent": { "policy_version": "2026-06-01", "purpose": "photo_upload" } }
// 201
{ "guest_id": "...", "event_id": "...",
  "shots_left": 50, "reveal_at": "...", "camera_style": "film35" }
```
Логика (service role): проверяет статус события (`live`/`draft`→`live`), проверяет
`max_guests` плана, создаёт `guests`, пишет `consents` (с IP/UA из заголовков),
связывает `guests.consent_id`. Идемпотентность по `(event_id, auth_uid)`.
Ошибки: 404 `not_found`, 409 `guests_limit_reached`, 410 `event_closed`,
422 `consent_required`.

**Запрос URL на загрузку** — `POST /events/:id/photos/upload-url` (гость)
```jsonc
// body
{ "filter": "vintage", "width": 1536, "height": 2048 }
// 200
{ "photo_id": "...", "upload_url": "https://...signed...", "expires_in": 600 }
```
Логика: считает `count(photos where guest_id=me and uploaded)` ; если
`>= shots_per_guest` (из `events`, с учётом плана) → 409 `shot_limit_reached`.
Создаёт строку `photos` (`uploaded=false`), выдаёт подписанный PUT-URL в Storage.
Ошибки: 403 `not_guest`, 409 `shot_limit_reached`, 410 `event_closed`.

**Подтверждение загрузки** — `POST /photos/:id/confirm` (гость)
`{ }` → `{ ok: true, thumb_ready: true }`. Ставит `uploaded=true`, генерирует превью.
Ошибки: 404 `not_found`, 409 `not_uploaded`.

**Галерея** — `GET /events/:id/photos?author=<guest_id>` → PostgREST.
RLS сам режет видимость по проявке. Параметр `author` — фильтр «POV гостя».
Сортировка `taken_at desc`, пагинация `range`.

**Отдача файла** — `GET /photos/:id/url` (Edge Function): проверяет RLS-видимость,
возвращает подписанный GET-URL с TTL. Ошибки: 403 `forbidden` (до проявки чужое).

**Избранное** — `PATCH /photos/:id` `{ is_favorite: true }` (хост, RLS).
**Удаление** — `DELETE /photos/:id` (хост любое / гость своё, RLS) + удаление объекта в Storage.

### 6.4 Биллинг (ЮKassa)

**Создание оплаты** — `POST /billing/checkout` (хост)
```jsonc
// body
{ "event_id": "...", "plan": "wedding" }
// 200
{ "payment_id": "...", "confirmation_url": "https://yoomoney..." }
```
Логика: берёт `price_kopecks` из `plans`, создаёт платёж в ЮKassa (idempotence key =
`payments.id`), пишет `payments(status='pending', provider_id)`.

**Вебхук ЮKassa** — `POST /billing/webhook` (service role, без auth, проверка подписи/IP)
На `payment.succeeded`: находит платёж по `provider_id`, ставит `status='succeeded'`,
апгрейдит `events.plan` + `shots_per_guest` + `expires_at` (по новому retention),
создаёт/активирует `subscriptions`. Идемпотентность по `provider_id`.
Ошибки: 400 `bad_signature` (лог + 200 для невалидных повторов по политике ЮKassa).

### 6.5 Приватность (152-ФЗ)

| Действие | Метод/путь | Тело | Ответ |
|---|---|---|---|
| Зафиксировать согласие | `POST /privacy/consent` | `{ purpose, policy_version }` | `{ consent_id }` |
| Отозвать согласие | `POST /privacy/consent/:id/revoke` | — | `{ ok }` → запускает удаление |
| Запрос удаления | `POST /privacy/deletion-request` | `{ scope, target_id? }` | `{ request_id }` |

Отзыв согласия гостя → каскад: удаление его `photos` (объекты в Storage), пометка
`guests` к удалению, `consents.revoked_at`.

---

## 7 · Фоновые задачи (pg_cron на self-hosted Supabase)

```sql
-- Авто-проявка: каждые 5 минут раскрываем события, у которых наступило reveal_at
select cron.schedule('auto-reveal','*/5 * * * *', $$
  update public.events set status='revealed'
  where status='live' and reveal_at is not null and reveal_at <= now();
$$);

-- Retention: ежедневно удаляем просроченные события (каскадом фото + объекты Storage
-- зачищает Edge Function purge-expired, вызываемая cron'ом — нельзя удалять из Storage в SQL)
select cron.schedule('retention-mark','0 3 * * *', $$
  update public.events set status='deleted' where expires_at <= now() and status <> 'deleted';
$$);
```

Edge Function `purge-expired` (по cron / HTTP) физически удаляет объекты Storage для
событий со `status='deleted'`, затем строки БД.

---

## 8 · UI-экраны

### 8.1 iOS (хост) — SwiftUI

| Экран | Элементы | Действия |
|---|---|---|
| **Онбординг/Логин** | поле телефона, OTP | `POST /auth/otp` → `/verify` |
| **Мои события** | список карточек (обложка, статус, счётчик фото) | открыть/создать |
| **Создание события** | title, дата, обложка, стиль камеры, лимит, время проявки, согласие | `POST /events` |
| **QR/Поделиться** | QR-код, короткая ссылка, кнопка «Поделиться», шаблон для печати | системный share |
| **Камера** | видоискатель, выбранный фильтр (превью в реальном времени), счётчик кадров | снять → upload-url → PUT → confirm |
| **Галерея** | сетка, таб «Все / По гостям», избранное, скачать, до проявки — плашка «Проявится в 20:00» | RLS-видимость |
| **Тариф** | планы, кнопка апгрейда | `POST /billing/checkout` → WebView ЮKassa |
| **Приватность** | политика, мои согласия, «удалить данные» | `/privacy/*` |

### 8.2 Web/PWA (гость) — Next.js

| Экран | Элементы | Действия |
|---|---|---|
| **Лендинг события** (`/j/:code`) | обложка, название, «Присоединиться» | `GET /public/events/:code` |
| **Имя + согласие** | поле имени, чекбокс согласия + ссылка на политику | `POST /join` (блок без чекбокса) |
| **Камера** | `getUserMedia`, фильтр, счётчик «осталось N» | upload-url → PUT → confirm |
| **Мои кадры / Галерея** | свои всегда; общая — после проявки | RLS |

UX-правила: вход гостя — **без установки** (PWA, кнопка «На экран «Домой»» опционально).
Чекбокс согласия не предзаполнен; кнопка съёмки заблокирована без согласия.

---

## 9 · Каталог edge cases

| # | Ситуация | Поведение |
|---|---|---|
| 1 | Гость снял лимит кадров | 409 `shot_limit_reached`, кнопка съёмки заблокирована, подсказка |
| 2 | Достигнут `max_guests` плана | новый гость → 409 `guests_limit_reached`, экран «Хост может расширить тариф» |
| 3 | Гость открыл ссылку до `starts_at` | показываем обложку + «Событие начнётся …», съёмка закрыта |
| 4 | Просмотр чужих фото до проявки | RLS не отдаёт; UI: «Фото проявятся в HH:MM» |
| 5 | Потеря сети при загрузке | клиент ставит кадр в очередь, ретрай с backoff; `confirm` идемпотентен |
| 6 | Дубликат вступления (тот же девайс) | идемпотентно по `(event_id, auth_uid)`, возвращаем существующего гостя |
| 7 | Повторный вебхук ЮKassa | идемпотентность по `provider_id`, второй раз — no-op |
| 8 | Отзыв согласия гостем | каскадное удаление его фото + объектов Storage, `consents.revoked_at` |
| 9 | Запрос «удалить фото со мной» от третьего лица | `deletion_requests(scope='photo')`, ручная/полуавтомат. модерация хостом |
| 10 | Истёк `expires_at` | `status='deleted'` → `purge-expired` удаляет объекты и строки |
| 11 | Загрузка >12 МБ или не-изображение | клиент ресайзит/режектит; сервер валидирует content-type/размер |
| 12 | Хост удалил событие | каскад FK + удаление объектов Storage через Edge Function |
| 13 | OTP-брутфорс | rate-limit 3/10мин на номер; экспоненциальная задержка |
| 14 | Несовершеннолетний на фото | по умолчанию приватная галерея; запрос на удаление приоритетный |

---

## 10 · Реализация требований 152-ФЗ (технически)

| Требование | Где в системе |
|---|---|
| Локализация (ст. 18.5) | весь стек в РФ; CI блокирует деплой в Vercel/Supabase Cloud |
| Журнал согласий | `consents` (IP, UA, версия, цель, время) — пишет Edge Function |
| Нет биометрии (ст. 11) | в коде нет face-detect/recognition; запрет в `.claude/rules/` |
| Минимизация данных | храним кадр с фильтром, без оригинала; превью по требованию |
| Подписанные URL | отдача фото только через `GET /photos/:id/url` с TTL |
| Шифрование | at-rest (Object Storage), in-transit (TLS) |
| Права субъектов | `deletion_requests`, отзыв согласия → каскадное удаление |
| Сроки хранения (ст. 5) | `events.expires_at` + cron `retention` + `purge-expired` |
| Трансграничка (ст. 12) | только APNs; отражено в уведомлении РКН; аналитика российская |
| Уровень защищённости | определить (вероятно УЗ-3/4), меры по Приказу ФСТЭК №21 |

---

## 11 · Структура репозитория (под GSD)

```
kadr/
├── CLAUDE.md                      # конфиг (≤120 строк)
├── PROJECT_IDEA.md                # Layer 1
├── SPECIFICATION.md               # этот файл
├── .claude/
│   ├── agents/                    # database-architect, backend-engineer,
│   │   │                          # frontend-developer, security-agent, qa-reviewer
│   ├── rules/                     # 152-fz.md (запрет зарубеж/биометрии), styling.md
│   └── skills/                    # supabase-migrations, deploy-ru-cloud
├── supabase/
│   ├── migrations/0001_init.sql   # таблицы + RLS + функции + cron
│   └── functions/                 # create-event, join-event, upload-url, confirm-upload,
│                                  # reveal, billing-checkout, billing-webhook,
│                                  # privacy-consent, deletion-request, purge-expired
├── web/                           # Next.js PWA (гость)
└── ios/                           # SwiftUI (хост)
```

---

## 12 · Чеклист готовности спецификации (Spec-First)

```
□ Каждый модуль: user stories, данные, API, UI, логика, edge cases   ✓
□ Типы полей как в SQL (uuid/text/jsonb/timestamptz)                  ✓
□ API: метод + путь + тело + ответ + коды ошибок                     ✓
□ RLS-политики для каждой таблицы                                     ✓
□ Нет TODO-заглушек                                                   ✓
□ 152-ФЗ закреплён в архитектуре (локализация, согласия, retention)   ✓
```

## Следующий шаг — Layer 3

`SETUP_GENERATOR`: системный промпт, который превращает эту спецификацию в `CLAUDE.md`
(≤120 строк), 5 субагентов с правильными моделями/tools, `rules/152-fz.md`,
skills и MCP (Context7 + Supabase). Скажи — соберу.
