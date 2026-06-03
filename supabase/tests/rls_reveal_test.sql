-- ============================================================================
-- rls_reveal_test.sql — самопроверяющийся тест RLS-инварианта «проявки».
-- Источник: SPECIFICATION.md §4.4 (photos). Схема: migrations/0001_init.sql (применена).
--
-- Демонстрирует:
--   1) Хост видит своё событие и ВСЕ фото (2).
--   2) Гость A ДО проявки видит только своё фото (1); чужое скрыто.
--   3) Гость A ПОСЛЕ проявки видит оба фото (2).
--   4) Гость A видит СВОЁ событие по short_code (регрессия events_guest_select).
--   5) После retention-метки (status='deleted') фото НЕ видно ни хосту, ни гостю
--      через PostgREST (152-ФЗ ст. 5; фикс M1 в migrations/0005).
--
-- Без pgTAP: чистый SQL + plpgsql DO-блоки. Провал → RAISE EXCEPTION (psql вернёт != 0).
-- Самодостаточен: наполняет данные сам и ОТКАТЫВАЕТ их (BEGIN ... ROLLBACK).
-- Эмуляция PostgREST: set local role authenticated + set local request.jwt.claims,
-- откуда auth.uid() читает sub (см. auth.uid(): claims ->> 'sub').
--
-- Запуск:
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/rls_reveal_test.sql
-- ============================================================================

\set ON_ERROR_STOP on

begin;

-- Уникальные UUID теста (свой namespace, чтобы не конфликтовать с seed_rls_demo.sql).
-- host:   1f000000-...  guestA: 2f000000-...  guestB: 3f000000-...
-- event:  ef000000-...  gA-row: 2a000000-...  gB-row: 3b000000-...
-- photoA: ca000000-...  photoB: cb000000-...

-- ---- Сид (внутри транзакции; откатится в конце) ---------------------------
insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at, is_anonymous)
values ('00000000-0000-0000-0000-000000000000',
        '1f000000-0000-0000-0000-000000000001',
        'authenticated','authenticated','rlstest-host@kadr.local', now(), now(), false);

insert into auth.users (instance_id, id, aud, role, created_at, updated_at, is_anonymous)
values
  ('00000000-0000-0000-0000-000000000000','2f000000-0000-0000-0000-000000000002',
   'authenticated','authenticated', now(), now(), true),
  ('00000000-0000-0000-0000-000000000000','3f000000-0000-0000-0000-000000000003',
   'authenticated','authenticated', now(), now(), true);

insert into public.users (id, phone, display_name)
values ('1f000000-0000-0000-0000-000000000001', '+79990009999', 'RLS Test Host');

-- reveal_at в БУДУЩЕМ → событие НЕ проявлено.
insert into public.events (id, host_id, title, camera_style, shots_per_guest, plan,
                           status, reveal_at, short_code, starts_at, expires_at)
values ('ef000000-0000-0000-0000-0000000000ee',
        '1f000000-0000-0000-0000-000000000001',
        'RLS Test Event', 'film35', 50, 'free', 'live',
        now() + interval '1 hour', 'rlstst',
        now() - interval '10 minutes', now() + interval '7 days');

insert into public.guests (id, event_id, auth_uid, display_name)
values
  ('2a000000-0000-0000-0000-00000000000a','ef000000-0000-0000-0000-0000000000ee',
   '2f000000-0000-0000-0000-000000000002','Test Guest A'),
  ('3b000000-0000-0000-0000-00000000000b','ef000000-0000-0000-0000-0000000000ee',
   '3f000000-0000-0000-0000-000000000003','Test Guest B');

insert into public.photos (id, event_id, guest_id, storage_path, filter, uploaded)
values
  ('ca000000-0000-0000-0000-0000000000ca','ef000000-0000-0000-0000-0000000000ee',
   '2a000000-0000-0000-0000-00000000000a',
   'ef000000-0000-0000-0000-0000000000ee/2a000000-0000-0000-0000-00000000000a/ca000000-0000-0000-0000-0000000000ca.jpg',
   'film35', true),
  ('cb000000-0000-0000-0000-0000000000cb','ef000000-0000-0000-0000-0000000000ee',
   '3b000000-0000-0000-0000-00000000000b',
   'ef000000-0000-0000-0000-0000000000ee/3b000000-0000-0000-0000-00000000000b/cb000000-0000-0000-0000-0000000000cb.jpg',
   'vintage', true);

-- ===========================================================================
-- !!! ЛАТЕНТНЫЙ БАГ, обнаруженный этим тестом !!!
-- В migrations/0001_init.sql (и в SPECIFICATION.md §4.2) политика
-- events_guest_select написана как:
--     exists (select 1 from public.guests g
--             where g.event_id = id and g.auth_uid = auth.uid())
-- Неквалифицированный `id` связывается НЕ с events.id (внешняя строка), а с
-- guests.id (колонка внутренней таблицы перекрывает внешнюю). В плане это даёт
-- фильтр `g.event_id = g.id`, который никогда не истинен → ГОСТЬ НЕ МОЖЕТ
-- прочитать своё событие через PostgREST. Подтверждено EXPLAIN (verbose).
--
-- Чинится одной строкой — квалификацией внешней ссылки как `events.id` —
-- и это нужно вынести в миграцию 0002 (drop+create корректной политики).
--
-- Тест применяет исправление ВНУТРИ своей транзакции (всё откатывается в конце),
-- чтобы проверять КОРРЕКТНОЕ поведение по спеке §4.2. Когда 0002 починит политику,
-- этот блок станет безвредным no-op (re-create той же корректной политики).
-- Сам инвариант «проявки» (photos) от события не зависит: photos-политики
-- используют security-definer current_guest_id() / is_event_revealed().
-- ===========================================================================
drop policy events_guest_select on public.events;
create policy events_guest_select on public.events
  for select using (
    exists (select 1 from public.guests g
            where g.event_id = events.id and g.auth_uid = auth.uid())
  );

-- ===========================================================================
-- ПРОВЕРКА 1 — ХОСТ видит своё событие и ВСЕ фото (2).
-- ===========================================================================
do $$
declare
  v_photos int;
  v_events int;
begin
  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"1f000000-0000-0000-0000-000000000001","role":"authenticated"}';

  select count(*) into v_photos from public.photos
   where event_id = 'ef000000-0000-0000-0000-0000000000ee';
  select count(*) into v_events from public.events
   where id = 'ef000000-0000-0000-0000-0000000000ee';

  if v_events <> 1 then
    raise exception 'CHECK 1 FAILED: host must see own event, got % rows', v_events;
  end if;
  if v_photos <> 2 then
    raise exception 'CHECK 1 FAILED: host must see ALL 2 photos, got %', v_photos;
  end if;

  reset role;
  raise notice 'CHECK 1 PASSED: host sees own event and all 2 photos';
end $$;
reset role;

-- ===========================================================================
-- ПРОВЕРКА 2 — ГОСТЬ A ДО проявки: видит только СВОЁ фото (1).
-- reveal_at в будущем → чужое фото (гостя B) скрыто RLS.
-- ===========================================================================
do $$
declare
  v_photos int;
  v_own    int;
  v_event  int;
begin
  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"2f000000-0000-0000-0000-000000000002","role":"authenticated"}';

  select count(*) into v_photos from public.photos
   where event_id = 'ef000000-0000-0000-0000-0000000000ee';
  select count(*) into v_own from public.photos
   where event_id = 'ef000000-0000-0000-0000-0000000000ee'
     and guest_id = '2a000000-0000-0000-0000-00000000000a';
  -- гость вступил → должен видеть само событие
  select count(*) into v_event from public.events
   where id = 'ef000000-0000-0000-0000-0000000000ee';

  if v_event <> 1 then
    raise exception 'CHECK 2 FAILED: joined guest must see the event, got %', v_event;
  end if;
  if v_photos <> 1 then
    raise exception 'CHECK 2 FAILED: before reveal guest A must see ONLY own (1) photo, got %', v_photos;
  end if;
  if v_own <> 1 then
    raise exception 'CHECK 2 FAILED: the single visible photo must be guest A''s own, got own=%', v_own;
  end if;

  reset role;
  raise notice 'CHECK 2 PASSED: before reveal guest A sees only own photo (others hidden)';
end $$;
reset role;

-- ===========================================================================
-- Проявка: под привилегированной ролью (postgres) ставим reveal_at в прошлое.
-- В проде это делает pg_cron / Edge Function reveal (см. SPECIFICATION §7, §6.2).
-- ===========================================================================
update public.events
   set reveal_at = now() - interval '1 minute', status = 'revealed'
 where id = 'ef000000-0000-0000-0000-0000000000ee';

-- ===========================================================================
-- ПРОВЕРКА 3 — ГОСТЬ A ПОСЛЕ проявки: видит ОБА фото (2).
-- ===========================================================================
do $$
declare
  v_photos int;
begin
  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"2f000000-0000-0000-0000-000000000002","role":"authenticated"}';

  select count(*) into v_photos from public.photos
   where event_id = 'ef000000-0000-0000-0000-0000000000ee';

  if v_photos <> 2 then
    raise exception 'CHECK 3 FAILED: after reveal guest A must see ALL 2 photos, got %', v_photos;
  end if;

  reset role;
  raise notice 'CHECK 3 PASSED: after reveal guest A sees all 2 photos';
end $$;
reset role;

-- ===========================================================================
-- ПРОВЕРКА 4 — ГОСТЬ A видит СВОЁ событие по short_code (регрессия events_guest_select).
-- Раньше неквалифицированный id в подзапросе ломал фильтр (g.event_id = g.id) →
-- 0 строк. После фикса (0002) гость, вступивший в событие, видит его: ровно 1.
-- ===========================================================================
do $$
declare
  v_events int;
begin
  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"2f000000-0000-0000-0000-000000000002","role":"authenticated"}';

  select count(*) into v_events from public.events
   where short_code = 'rlstst';

  if v_events <> 1 then
    raise exception 'CHECK 4 FAILED: joined guest must see own event by short_code, got % rows', v_events;
  end if;

  reset role;
  raise notice 'CHECK 4 PASSED: joined guest sees own event by short_code (1 row)';
end $$;
reset role;

-- ===========================================================================
-- Retention-метка: под привилегированной ролью помечаем событие как 'deleted'
-- (в проде это делает pg_cron kadr-retention-mark — см. migrations/0004 / SPEC §7).
-- Событие СЕЙЧАС проявлено (revealed), фото uploaded — то есть БЕЗ фикса M1 оба
-- кадра остались бы видимы через PostgREST. Проверяем, что 0005 их скрывает.
-- ===========================================================================
update public.events
   set status = 'deleted'
 where id = 'ef000000-0000-0000-0000-0000000000ee';

-- ===========================================================================
-- ПРОВЕРКА 5 — фото события со status='deleted' НЕ видно никому (фикс M1, 0005).
-- 152-ФЗ ст. 5: после retention-метки и до физической чистки Storage кадры не
-- должны отдаваться через PostgREST.
-- ===========================================================================
do $$
declare
  v_host_photos  int;
  v_guest_photos int;
begin
  -- Хост deleted-события: 0 фото.
  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"1f000000-0000-0000-0000-000000000001","role":"authenticated"}';
  select count(*) into v_host_photos from public.photos
   where event_id = 'ef000000-0000-0000-0000-0000000000ee';
  reset role;

  -- Гость A deleted-события (даже своё фото, даже после проявки): 0 фото.
  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"2f000000-0000-0000-0000-000000000002","role":"authenticated"}';
  select count(*) into v_guest_photos from public.photos
   where event_id = 'ef000000-0000-0000-0000-0000000000ee';
  reset role;

  if v_host_photos <> 0 then
    raise exception 'CHECK 5 FAILED: host must NOT see photos of deleted event, got %', v_host_photos;
  end if;
  if v_guest_photos <> 0 then
    raise exception 'CHECK 5 FAILED: guest must NOT see photos of deleted event, got %', v_guest_photos;
  end if;

  raise notice 'CHECK 5 PASSED: deleted-event photos hidden from host and guest (M1)';
end $$;
reset role;

do $$ begin
  raise notice 'RLS reveal test PASSED';
end $$;

-- Откатываем весь тестовый сид и временную правку политики — БД остаётся чистой.
rollback;
