-- ============================================================================
-- 0003_join_guest_rpc.sql — «Кадр» — атомарное вступление гостя (анти-гонка)
-- Источник: SPECIFICATION.md §6.3 (вступление гостя), §6.5 (приватность).
--
-- БАГ (QA HIGH): в Edge Function join-event подсчёт гостей (count) и последующий
-- insert нового гостя выполнялись разными запросами supabase-js — без транзакции.
-- Два параллельных join с РАЗНЫМИ auth_uid могли оба пройти проверку
-- count < max_guests и вставить гостей, превысив лимит тарифа на 1+.
--
-- ФИКС: критическая секция (проверка лимита + insert) сериализуется по event_id
-- через транзакционный advisory-lock внутри одной security-definer функции.
-- pg_advisory_xact_lock держится до конца транзакции функции — этого достаточно,
-- чтобы count и insert были атомарны относительно других вызовов того же события.
--
-- Функция вызывается ТОЛЬКО service-role из Edge Function (RLS она обходит как
-- security definer). RLS таблицы guests из 0001 НЕ меняется — все остальные пути
-- (PostgREST под RLS) работают как прежде. Никаких новых политик не вводим.
--
-- Контракт возврата (ровно одна строка):
--   guest_id      — id гостя (существующего или нового); null при limit_reached
--   raced         — true, если гость уже существовал (идемпотентный повтор под локом)
--   limit_reached — true, если достигнут лимит max_guests (insert НЕ выполнен)
-- Идемпотентная ветка (raced) лимит ИГНОРИРУЕТ — гость уже учтён.
-- ============================================================================

create or replace function public.join_guest_atomic(
  p_event_id     uuid,
  p_auth_uid     uuid,
  p_display_name text,
  p_consent_id   uuid,
  p_max_guests   int
)
returns table (guest_id uuid, raced boolean, limit_reached boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing uuid;
  v_count    int;
  v_new      uuid;
begin
  -- Сериализуем критическую секцию по событию. Лок транзакционный:
  -- удерживается до COMMIT/ROLLBACK транзакции этой функции.
  perform pg_advisory_xact_lock(hashtext(p_event_id::text));

  -- Идемпотентность под локом: гость уже вступал → возвращаем его, лимит игнорируем.
  select g.id into v_existing
  from public.guests g
  where g.event_id = p_event_id and g.auth_uid = p_auth_uid
  limit 1;

  if v_existing is not null then
    guest_id := v_existing;
    raced := true;
    limit_reached := false;
    return next;
    return;
  end if;

  -- Проверка лимита тарифа (атомарна с insert ниже благодаря локу).
  select count(*) into v_count
  from public.guests g
  where g.event_id = p_event_id;

  if v_count >= p_max_guests then
    guest_id := null;
    raced := false;
    limit_reached := true;
    return next;
    return;
  end if;

  -- Лимит не достигнут → вставляем нового гостя со ссылкой на consent.
  insert into public.guests (event_id, auth_uid, display_name, consent_id)
  values (p_event_id, p_auth_uid, p_display_name, p_consent_id)
  returning id into v_new;

  guest_id := v_new;
  raced := false;
  limit_reached := false;
  return next;
  return;
end;
$$;
