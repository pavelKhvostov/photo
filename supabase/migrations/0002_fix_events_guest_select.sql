-- ============================================================================
-- 0002_fix_events_guest_select.sql — «Кадр» — фикс RLS-политики events_guest_select
-- Источник: SPECIFICATION.md §4.2 (events).
--
-- БАГ (был в 0001_init.sql): в подзапросе политики events_guest_select
-- неквалифицированный `id` связывался НЕ с внешней events.id, а с колонкой
-- внутренней таблицы guests.id (внутренняя область видимости перекрывает внешнюю).
-- Фактически фильтр становился `g.event_id = g.id`, который никогда не истинен →
-- гость НЕ МОГ прочитать своё событие через PostgREST (для UI камеры/галереи).
--
-- ФИКС: квалифицируем внешнюю ссылку как `g.event_id = events.id`. Семантика
-- прежняя по спеке §4.2 — гость видит событие, в которое вступил.
-- ============================================================================

drop policy if exists events_guest_select on public.events;

create policy events_guest_select on public.events
  for select using (
    exists (select 1 from public.guests g
            where g.event_id = events.id and g.auth_uid = auth.uid())
  );
