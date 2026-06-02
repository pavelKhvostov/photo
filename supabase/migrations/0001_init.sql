-- ============================================================================
-- 0001_init.sql — «Кадр» — первая миграция
-- Источник: SPECIFICATION.md §2 (таблицы), §3 (функции), §4 (RLS), §5 (Storage)
-- Порядок: расширения → таблицы → seed → функции → RLS → политики → storage
-- pg_cron и автоматизация (проявка/retention) — отдельной миграцией 0002.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- ТАБЛИЦЫ (в порядке зависимостей по внешним ключам)
-- ---------------------------------------------------------------------------

-- Профили хостов (привязка к auth.users)
create table public.users (
  id           uuid primary key references auth.users(id) on delete cascade,
  phone        text unique not null,
  email        text,
  display_name text,
  created_at   timestamptz not null default now()
);

-- Справочник тарифов
create table public.plans (
  code            text primary key check (code in ('free','party','wedding','unlimited')),
  title           text not null,
  max_guests      int  not null,
  shots_per_guest int  not null,           -- 0 = безлимит
  retention_days  int  not null,
  price_kopecks   int  not null,           -- цена в копейках
  watermark       boolean not null default true
);

-- События («моменты»)
create table public.events (
  id              uuid primary key default gen_random_uuid(),
  host_id         uuid not null references public.users(id) on delete cascade,
  title           text not null check (char_length(title) between 1 and 120),
  cover_path      text,
  camera_style    text not null default 'film35'
                    check (camera_style in ('film35','vintage','bw','summer')),
  shots_per_guest int  not null default 20 check (shots_per_guest between 1 and 1000),
  plan            text not null default 'free'
                    check (plan in ('free','party','wedding','unlimited')),
  status          text not null default 'draft'
                    check (status in ('draft','live','revealed','archived','deleted')),
  reveal_at       timestamptz,             -- null = мгновенный показ
  short_code      text unique not null
                    default substr(replace(gen_random_uuid()::text,'-',''),1,6),
  starts_at       timestamptz,
  expires_at      timestamptz not null default (now() + interval '7 days'),
  created_at      timestamptz not null default now()
);
create index on public.events (host_id);
create index on public.events (short_code);
create index on public.events (expires_at);

-- Журнал согласий (152-ФЗ)
create table public.consents (
  id             uuid primary key default gen_random_uuid(),
  subject_uid    uuid not null,            -- auth.users.id хоста или гостя
  subject_type   text not null check (subject_type in ('host','guest')),
  purpose        text not null check (purpose in ('service','photo_upload')),
  policy_version text not null,
  granted_at     timestamptz not null default now(),
  revoked_at     timestamptz,
  ip             inet,
  user_agent     text
);
create index on public.consents (subject_uid);

-- Гости (анонимная сессия)
create table public.guests (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid not null references public.events(id) on delete cascade,
  auth_uid     uuid not null references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 60),
  consent_id   uuid references public.consents(id),
  joined_at    timestamptz not null default now(),
  unique (event_id, auth_uid)
);
create index on public.guests (event_id);
create index on public.guests (auth_uid);

-- Кадры
create table public.photos (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid not null references public.events(id) on delete cascade,
  guest_id     uuid not null references public.guests(id) on delete cascade,
  storage_path text not null,              -- event_id/guest_id/photo_id.jpg
  filter       text not null default 'film35'
                  check (filter in ('film35','vintage','bw','summer')),
  width        int,
  height       int,
  is_favorite  boolean not null default false,
  uploaded     boolean not null default false,
  taken_at     timestamptz not null default now()
);
create index on public.photos (event_id);
create index on public.photos (guest_id);
create index on public.photos (event_id, guest_id);

-- Подписки
create table public.subscriptions (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.events(id) on delete cascade,
  plan       text not null references public.plans(code),
  active     boolean not null default false,
  created_at timestamptz not null default now()
);

-- Платежи (ЮKassa)
create table public.payments (
  id             uuid primary key default gen_random_uuid(),
  event_id       uuid not null references public.events(id) on delete cascade,
  host_id        uuid not null references public.users(id) on delete cascade,
  plan           text not null references public.plans(code),
  amount_kopecks int  not null,
  status         text not null default 'pending'
                   check (status in ('pending','succeeded','canceled')),
  provider       text not null default 'yookassa',
  provider_id    text,
  created_at     timestamptz not null default now(),
  unique (provider, provider_id)
);

-- Запросы субъектов на удаление (152-ФЗ)
create table public.deletion_requests (
  id           uuid primary key default gen_random_uuid(),
  subject_uid  uuid not null,
  scope        text not null check (scope in ('photo','guest','account')),
  target_id    uuid,
  requested_at timestamptz not null default now(),
  processed_at timestamptz
);

-- ---------------------------------------------------------------------------
-- SEED: тарифы (цены — гипотезы, уточняются после юнит-экономики)
-- ---------------------------------------------------------------------------
insert into public.plans (code,title,max_guests,shots_per_guest,retention_days,price_kopecks,watermark) values
  ('free',     'Free',      10,     20, 7,     0,      true),
  ('party',    'Вечеринка', 50,     50, 90,    99000,  false),
  ('wedding',  'Свадьба',   150,    0,  365,   299000, false),
  ('unlimited','Безлимит',  100000, 0,  365,   599000, false);

-- ---------------------------------------------------------------------------
-- ФУНКЦИИ (security definer) — нужны для RLS
-- ---------------------------------------------------------------------------

create or replace function public.is_event_host(p_event uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.events e
    where e.id = p_event and e.host_id = auth.uid()
  );
$$;

create or replace function public.current_guest_id(p_event uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select g.id from public.guests g
  where g.event_id = p_event and g.auth_uid = auth.uid()
  limit 1;
$$;

create or replace function public.is_event_revealed(p_event uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.events e
    where e.id = p_event
      and (e.reveal_at is null or e.reveal_at <= now() or e.status = 'revealed')
  );
$$;

-- ---------------------------------------------------------------------------
-- ВКЛЮЧЕНИЕ RLS НА ВСЕХ ТАБЛИЦАХ (инвариант проекта)
-- ---------------------------------------------------------------------------
alter table public.users             enable row level security;
alter table public.plans             enable row level security;
alter table public.events            enable row level security;
alter table public.consents          enable row level security;
alter table public.guests            enable row level security;
alter table public.photos            enable row level security;
alter table public.subscriptions     enable row level security;
alter table public.payments          enable row level security;
alter table public.deletion_requests enable row level security;

-- ---------------------------------------------------------------------------
-- ПОЛИТИКИ RLS
-- ---------------------------------------------------------------------------

-- users: только свой профиль
create policy users_self_select on public.users
  for select using (id = auth.uid());
create policy users_self_update on public.users
  for update using (id = auth.uid());

-- plans: публичное чтение справочника
create policy plans_public_read on public.plans
  for select using (true);

-- events: хост — всё своё; гость — читает событие, в которое вступил
create policy events_host_all on public.events
  for all using (host_id = auth.uid()) with check (host_id = auth.uid());
create policy events_guest_select on public.events
  for select using (
    exists (select 1 from public.guests g
            where g.event_id = id and g.auth_uid = auth.uid())
  );

-- consents: субъект видит свои
create policy consents_self_select on public.consents
  for select using (subject_uid = auth.uid());

-- guests: хост видит гостей события; гость видит себя
create policy guests_host_select on public.guests
  for select using (public.is_event_host(event_id));
create policy guests_self_select on public.guests
  for select using (auth_uid = auth.uid());

-- photos: тут живёт логика «проявки»
create policy photos_host_select on public.photos
  for select using (public.is_event_host(event_id));
create policy photos_guest_select on public.photos
  for select using (
    guest_id = public.current_guest_id(event_id)
    or public.is_event_revealed(event_id)
  );
create policy photos_guest_insert on public.photos
  for insert with check (guest_id = public.current_guest_id(event_id));
create policy photos_host_update on public.photos
  for update using (public.is_event_host(event_id));
create policy photos_delete on public.photos
  for delete using (
    public.is_event_host(event_id)
    or guest_id = public.current_guest_id(event_id)
  );

-- subscriptions: хост читает подписки своих событий (запись — service role)
create policy subs_host_read on public.subscriptions
  for select using (public.is_event_host(event_id));

-- payments: хост читает свои платежи (запись/обновление — service role)
create policy pay_host_read on public.payments
  for select using (host_id = auth.uid());

-- deletion_requests: субъект управляет своими запросами
create policy del_self_all on public.deletion_requests
  for all using (subject_uid = auth.uid()) with check (subject_uid = auth.uid());

-- ---------------------------------------------------------------------------
-- STORAGE: приватный бакет для фото + политика загрузки гостя в свою папку
-- Путь объекта: {event_id}/{guest_id}/{photo_id}.jpg
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('event-photos', 'event-photos', false)
on conflict (id) do nothing;

create policy storage_guest_upload on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'event-photos'
    and (storage.foldername(name))[2] =
        public.current_guest_id(((storage.foldername(name))[1])::uuid)::text
  );
