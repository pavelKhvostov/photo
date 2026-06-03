-- ============================================================================
-- 0004_cron_reveal_retention.sql — «Кадр» — фоновые задачи pg_cron
-- Источник: SPECIFICATION.md §7 (Фоновые задачи), §10 (152-ФЗ: сроки хранения).
--
-- Две задачи планировщика:
--   1) kadr-auto-reveal   — каждые 5 минут раскрывает события, у которых наступил
--                           reveal_at (status 'live' → 'revealed'). После этого
--                           is_event_revealed() отдаёт чужие фото в общей галерее.
--   2) kadr-retention-mark — ежедневно в 03:00 помечает просроченные события
--                           (expires_at <= now()) как 'deleted'.
--
-- ВАЖНО (152-ФЗ ст. 5 + инвариант проекта): cron ТОЛЬКО МЕТИТ status='deleted'.
-- Физическое удаление объектов Storage делает Edge Function `purge-expired`
-- (нельзя удалять из S3 в SQL). Каскад FK по строкам БД отрабатывает там же.
--
-- Новых таблиц нет → RLS-политики не требуются. Задачи cron выполняются под
-- владельцем БД (обходят RLS), что корректно для системной автоматизации.
--
-- Идемпотентность: cron.schedule с тем же jobname обновляет существующую задачу.
-- Перед планированием снимаем задачу по имени (unschedule в безопасном блоке),
-- чтобы `supabase db reset` и повторное применение проходили без ошибок.
-- ============================================================================

-- Расширение планировщика. На проде self-hosted Supabase pg_cron включён
-- (в shared_preload_libraries); локально (supabase 1.6.4) `create extension`
-- проходит штатно.
create extension if not exists pg_cron;

-- ---------------------------------------------------------------------------
-- Идемпотентная (пере)регистрация задач
-- ---------------------------------------------------------------------------
do $cron$
begin
  -- Снимаем прежние версии задач, если они уже есть (без падения при отсутствии).
  perform cron.unschedule(jobid)
  from cron.job
  where jobname in ('kadr-auto-reveal', 'kadr-retention-mark');

  -- 1) Авто-проявка: каждые 5 минут.
  perform cron.schedule(
    'kadr-auto-reveal',
    '*/5 * * * *',
    $job$
      update public.events set status = 'revealed'
      where status = 'live'
        and reveal_at is not null
        and reveal_at <= now();
    $job$
  );

  -- 2) Retention-метка: ежедневно в 03:00.
  perform cron.schedule(
    'kadr-retention-mark',
    '0 3 * * *',
    $job$
      update public.events set status = 'deleted'
      where expires_at <= now()
        and status <> 'deleted';
    $job$
  );
end
$cron$;
