-- ============================================================================
-- seed_rls_demo.sql — демонстрационные данные для проверки RLS-инварианта «проявки»
-- Источник: SPECIFICATION.md §4.4 (photos). Схема: migrations/0001_init.sql (УЖЕ применена).
-- ЭТО НЕ МИГРАЦИЯ. Запускать вручную против локальной БД:
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f supabase/seed_rls_demo.sql
--
-- Наполняет: 1 хост + 2 анонимных гостя (auth.users), профиль хоста, 1 событие
-- (reveal_at в БУДУЩЕМ — галерея НЕ проявлена), 2 гостей, по 1 uploaded-фото на гостя.
-- Идемпотентно: в начале удаляет прежние демо-данные по фиксированным UUID.
-- На локальном Supabase прямой insert в auth.users допустим для сидов.
-- ============================================================================

-- ---- Фиксированные детерминированные UUID --------------------------------
-- host_uid   : 11111111-1111-1111-1111-111111111111
-- guestA_uid : 22222222-2222-2222-2222-222222222222
-- guestB_uid : 33333333-3333-3333-3333-333333333333
-- event_id   : aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa
-- guestA_id  : a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1
-- guestB_id  : b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2
-- photoA_id  : c0c0c0c0-c0c0-c0c0-c0c0-c0c0c0c0c0c0
-- photoB_id  : d0d0d0d0-d0d0-d0d0-d0d0-d0d0d0d0d0d0

-- ---- Идемпотентная очистка (в порядке, обратном зависимостям FK) ----------
-- events каскадно унесёт guests/photos, но чистим явно — на случай ручной правки.
delete from public.photos where event_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
delete from public.guests where event_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
delete from public.events where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' or short_code = 'demo01';
delete from public.users  where id = '11111111-1111-1111-1111-111111111111';
delete from auth.users where id in (
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  '33333333-3333-3333-3333-333333333333'
);

-- ---- auth.users -----------------------------------------------------------
-- Хост — аутентифицирован по телефону (в демо задаём email-метку).
insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at, is_anonymous)
values (
  '00000000-0000-0000-0000-000000000000',
  '11111111-1111-1111-1111-111111111111',
  'authenticated', 'authenticated', 'host-demo@kadr.local',
  now(), now(), false
);

-- Гости — анонимные сессии Supabase (signInAnonymously → is_anonymous=true).
insert into auth.users (instance_id, id, aud, role, created_at, updated_at, is_anonymous)
values
  ('00000000-0000-0000-0000-000000000000','22222222-2222-2222-2222-222222222222',
   'authenticated','authenticated', now(), now(), true),
  ('00000000-0000-0000-0000-000000000000','33333333-3333-3333-3333-333333333333',
   'authenticated','authenticated', now(), now(), true);

-- ---- public.users (профиль хоста) ----------------------------------------
insert into public.users (id, phone, display_name)
values ('11111111-1111-1111-1111-111111111111', '+79990000001', 'Demo Host');

-- ---- public.events --------------------------------------------------------
-- reveal_at = now() + 1 час → галерея ещё НЕ проявлена. expires_at в будущем.
insert into public.events (
  id, host_id, title, camera_style, shots_per_guest, plan, status,
  reveal_at, short_code, starts_at, expires_at
) values (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '11111111-1111-1111-1111-111111111111',
  'Demo Event (RLS reveal)', 'film35', 50, 'free', 'live',
  now() + interval '1 hour', 'demo01', now() - interval '10 minutes',
  now() + interval '7 days'
);

-- ---- public.guests --------------------------------------------------------
insert into public.guests (id, event_id, auth_uid, display_name)
values
  ('a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '22222222-2222-2222-2222-222222222222', 'Guest A'),
  ('b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '33333333-3333-3333-3333-333333333333', 'Guest B');

-- ---- public.photos --------------------------------------------------------
-- По одному загруженному кадру у каждого гостя. Путь: {event_id}/{guest_id}/{photo_id}.jpg
insert into public.photos (id, event_id, guest_id, storage_path, filter, uploaded)
values
  ('c0c0c0c0-c0c0-c0c0-c0c0-c0c0c0c0c0c0',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1/c0c0c0c0-c0c0-c0c0-c0c0-c0c0c0c0c0c0.jpg',
   'film35', true),
  ('d0d0d0d0-d0d0-d0d0-d0d0-d0d0d0d0d0d0',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2/d0d0d0d0-d0d0-d0d0-d0d0-d0d0d0d0d0d0.jpg',
   'vintage', true);
