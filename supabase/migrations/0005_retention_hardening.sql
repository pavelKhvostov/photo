-- ============================================================================
-- 0005_retention_hardening.sql — «Кадр» — закрытие 152-ФЗ-находок security-agent
-- Источник: SPECIFICATION.md §4.4 (photos / «проявка»), §6.5 (приватность, отзыв
--           согласия), §7 (фоновые задачи), §10 (152-ФЗ: сроки хранения, ст. 5).
--           Опирается на: 0001_init.sql (RLS photos, bucket event-photos,
--           security-definer хелперы), 0003 (образец security-definer RPC
--           join_guest_atomic), 0004 (kadr-auto-reveal, kadr-retention-mark).
--
-- Закрываются находки:
--
--   M1. Фото события со status='deleted' остаётся читаемым через PostgREST.
--       Политики photos_host_select / photos_guest_select (0001) не смотрят на
--       статус события. После retention-метки (status='deleted', задача
--       kadr-retention-mark) и ДО физической чистки Storage (Edge Function
--       purge-expired) кадры всё ещё видны под RLS → нарушение сроков хранения
--       (152-ФЗ ст. 5). Фикс: пересоздаём обе SELECT-политические photos так, чтобы
--       событие в статусе 'deleted' было невидимо никому через PostgREST.
--       Прочие политики photos (insert/update/delete) — без изменений.
--
--   M2. Cron только метит status='deleted', но никто не вызывает purge-expired →
--       объекты Storage не удаляются никогда. Фикс: задача kadr-purge-expired,
--       которая через pg_net (net.http_post) дёргает Edge Function purge-expired.
--
--   H3. Атомарность отзыва согласия (Edge Function revoke-consent). БД-мутации
--       отзыва (delete guests субъекта + set consents.revoked_at + insert
--       deletion_requests) выполнялись разными запросами supabase-js — без
--       транзакции. Сбой между ними оставлял журнал согласия в неконсистентном
--       состоянии (фото снесены, но revoked_at/аудит не записаны — нарушение
--       доказательной базы 152-ФЗ). Фикс: RPC revoke_consent_atomic — одна
--       security-definer транзакция (по образцу join_guest_atomic, 0003).
--       Storage-удаление остаётся в Edge Function ДО вызова RPC (в SQL нельзя
--       удалять объекты Storage).
--
-- Стиль и инварианты — как в 0001-0004: квалифицируем колонки явно (помним баг 0002
-- с неквалифицированным id), security-definer хелперы с set search_path = public,
-- идемпотентная (пере)регистрация cron (unschedule перед schedule).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- M1 · Хелпер: событие помечено к удалению (retention-метка)
-- ---------------------------------------------------------------------------
-- security definer + search_path=public — единый стиль с is_event_host /
-- current_guest_id / is_event_revealed (0001). Используется в RLS-политиках photos,
-- чтобы держать подзапрос к events вне области видимости политики (исключаем повтор
-- бага 0002 с перекрытием имён колонок).
create or replace function public.is_event_deleted(p_event uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.events e
    where e.id = p_event and e.status = 'deleted'
  );
$$;

-- ---------------------------------------------------------------------------
-- M1 · Пересоздание SELECT-политик photos с проверкой «событие не deleted»
-- ---------------------------------------------------------------------------
-- Семантика по SPECIFICATION §4.4 сохранена ПОЛНОСТЬЮ, добавлено лишь жёсткое
-- условие: фото события со status='deleted' не видно никому через PostgREST.
-- event_id квалифицирован как photos.event_id явно (урок бага 0002).

drop policy if exists photos_host_select on public.photos;
create policy photos_host_select on public.photos
  for select using (
    public.is_event_host(photos.event_id)
    and not public.is_event_deleted(photos.event_id)
  );

drop policy if exists photos_guest_select on public.photos;
create policy photos_guest_select on public.photos
  for select using (
    not public.is_event_deleted(photos.event_id)
    and (
      photos.guest_id = public.current_guest_id(photos.event_id)
      or public.is_event_revealed(photos.event_id)
    )
  );

-- Прочие политики photos (photos_guest_insert / photos_host_update / photos_delete)
-- НЕ трогаем: чистка строк происходит каскадом FK при удалении event'а в purge-expired
-- под service role (RLS не применяется), а пользовательское удаление своих/чужих фото
-- остаётся доступным по прежним правилам.

-- ---------------------------------------------------------------------------
-- M2 · Конфиг вызова purge-expired (таблица + RLS + security-definer ридер)
-- ---------------------------------------------------------------------------
-- URL и секрет НЕ хардкодим в теле cron-задачи и не светим обычным ролям.
--
-- Почему таблица, а не GUC: в локальном/self-hosted Supabase роль миграций (`postgres`)
-- НЕ superuser, поэтому `alter database/role ... set app.*` падает с
-- "permission denied to set parameter" (префикс app.* зарезервирован за superuser).
-- Конфиг-таблица переносима между локалкой и продом и не требует superuser в миграции.
--
-- Инвариант проекта: КАЖДАЯ таблица — с RLS и политиками. Здесь RLS включён, а политик
-- НЕ создаём вовсе → обычные роли (authenticated/anon) не читают секрет совсем
-- (deny-by-default). Доступ к значениям — только через security-definer функцию,
-- вызываемую из cron-задачи (владелец БД обходит RLS) или из service role.
create table if not exists public.app_config (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);

alter table public.app_config enable row level security;
-- Политик нет намеренно: deny-by-default для anon/authenticated. Запись/чтение секрета —
-- только владелец БД (cron) и service role (обходят RLS).

-- Дефолты для локального стека (idempotent). Адрес purge-expired — внутренний адрес
-- Edge Functions в Docker-сети: pg_net стучится ИЗНУТРИ стека, поэтому kong:8000
-- (НЕ 127.0.0.1 и НЕ публичный домен).
-- НА ПРОДЕ переопределить (через service role / SQL под админом):
--   update public.app_config set value='https://api.kadr.ru/functions/v1/purge-expired'
--    where key='purge_url';
--   update public.app_config set value='<сильный-секрет>' where key='purge_secret';
-- Секрет на проде ОБЯЗАТЕЛЕН: purge-expired ТЕПЕРЬ ТРЕБУЕТ заданного PURGE_SECRET в env
-- функции (fail-closed) и заголовок x-purge-secret в каждом вызове.
insert into public.app_config (key, value) values
  ('purge_url',    'http://kong:8000/functions/v1/purge-expired'),
  ('purge_secret', '')
on conflict (key) do nothing;

-- Security-definer ридер: отдаёт значение по ключу в обход RLS. Вызывается из cron.
create or replace function public.app_config_get(p_key text)
returns text language sql stable security definer set search_path = public as $$
  select value from public.app_config where key = p_key;
$$;
-- Не раздаём execute обычным ролям — секрет не должен утекать через PostgREST RPC.
revoke all on function public.app_config_get(text) from public;
revoke all on function public.app_config_get(text) from anon, authenticated;

-- ---------------------------------------------------------------------------
-- M2 · pg_net + cron-задача kadr-purge-expired
-- ---------------------------------------------------------------------------
-- pg_net даёт асинхронный net.http_post. В локальном Supabase расширение присутствует.
create extension if not exists pg_net;

-- pg_cron уже включён в 0004; на всякий случай — идемпотентно.
create extension if not exists pg_cron;

do $cron$
begin
  -- Идемпотентность: снимаем прежнюю версию задачи, если есть.
  perform cron.unschedule(jobid)
  from cron.job
  where jobname = 'kadr-purge-expired';

  -- Запуск через 15 минут после retention-метки (0004: kadr-retention-mark в 03:00),
  -- чтобы пометка status='deleted' гарантированно успела примениться.
  perform cron.schedule(
    'kadr-purge-expired',
    '15 3 * * *',
    $job$
      select net.http_post(
        url     := public.app_config_get('purge_url'),
        headers := jsonb_build_object(
                     'Content-Type',   'application/json',
                     'x-purge-secret', coalesce(public.app_config_get('purge_secret'), '')
                   ),
        body    := '{}'::jsonb
      );
    $job$
  );
end
$cron$;

-- ---------------------------------------------------------------------------
-- H3 · RPC: атомарный отзыв согласия (по образцу join_guest_atomic, 0003)
-- ---------------------------------------------------------------------------
-- Контекст (Edge Function revoke-consent, §6.5):
--   1) субъект отзывает СВОЁ согласие (право проверяет Edge Function);
--   2) каскад строится по subject_uid (= auth_uid субъекта), НЕ по consent_id:
--      удаляются ВСЕ гости субъекта во ВСЕХ событиях, независимо от guests.consent_id
--      (он мог быть NULL). FK photos.guest_id on delete cascade сносит фото гостей.
--   3) проставляется consents.revoked_at;
--   4) пишется аудит в deletion_requests (scope='guest', target_id=NULL — удаляется
--      субъект целиком, не один конкретный гость; CHECK схемы scope не меняется).
--
-- Storage-удаление НЕ здесь: объекты бакета event-photos нельзя трогать из SQL.
-- Edge Function ОБЯЗАН удалить объекты Storage ДО вызова этой RPC (порядок 152-ФЗ:
-- сперва объекты, потом строки — иначе потеряем storage_path).
--
-- Идемпотентность: повторный вызов с уже отозванным согласием → already_revoked=true,
-- никаких мутаций. Защита от гонки — update ... where revoked_at is null под локом
-- по subject_uid.
--
-- Контракт возврата (ровно одна строка):
--   already_revoked — true, если согласие уже было отозвано (no-op);
--   guests_removed  — сколько строк guests субъекта удалено (= caller проверяет).
create or replace function public.revoke_consent_atomic(
  p_consent_id  uuid,
  p_subject_uid uuid
)
returns table (already_revoked boolean, guests_removed int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_revoked_at timestamptz;
  v_removed    int;
begin
  -- Сериализуем по субъекту: параллельные отзывы согласий одного субъекта не должны
  -- наперегонки удалять гостей и писать дублирующий аудит.
  perform pg_advisory_xact_lock(hashtext(p_subject_uid::text));

  -- Перечитываем согласие ПОД ЛОКОМ (caller уже проверил право, но revoked_at мог
  -- измениться между его select и нашим вызовом).
  select c.revoked_at into v_revoked_at
  from public.consents c
  where c.id = p_consent_id
  limit 1;

  -- Идемпотентность: уже отозвано → no-op (никаких удалений и аудита).
  if v_revoked_at is not null then
    already_revoked := true;
    guests_removed := 0;
    return next;
    return;
  end if;

  -- Каскад по СУБЪЕКТУ (а не по consent_id): сносим всех гостей субъекта во всех
  -- событиях. FK photos.guest_id on delete cascade удалит строки фото.
  with deleted as (
    delete from public.guests g
    where g.auth_uid = p_subject_uid
    returning g.id
  )
  select count(*) into v_removed from deleted;

  -- Помечаем согласие отозванным (where revoked_at is null — защита от гонки).
  update public.consents c
  set revoked_at = now()
  where c.id = p_consent_id and c.revoked_at is null;

  -- Аудит факта обработки (152-ФЗ). scope='guest' (CHECK схемы не меняем),
  -- target_id=NULL — удалён субъект целиком, не один гость; запись не врёт.
  insert into public.deletion_requests (subject_uid, scope, target_id, processed_at)
  values (p_subject_uid, 'guest', null, now());

  already_revoked := false;
  guests_removed := v_removed;
  return next;
  return;
end;
$$;

-- ============================================================================
-- ПРОВЕРКА:
--   1) supabase db reset — применяет 0001..0005 без ошибок.
--   2) select jobname, schedule from cron.job order by jobname;
--      → kadr-auto-reveal, kadr-purge-expired, kadr-retention-mark (3 задачи).
--   3) RLS M1: supabase/tests/rls_reveal_test.sql (CHECK 1-4 целы + CHECK 5:
--      фото deleted-события не видно ни хосту, ни гостю через PostgREST).
--   4) Реальный HTTP-вызов purge-expired требует запущенных Edge Functions
--      (supabase functions serve) — SQL валиден и задача зарегистрирована
--      независимо от этого. См. отчёт.
--   5) H3 revoke_consent_atomic: вызывается из Edge Function revoke-consent ПОСЛЕ
--      удаления объектов Storage; удаляет всех гостей субъекта, метит revoked_at,
--      пишет аудит — в одной транзакции.
-- ============================================================================
