-- ============================================================================
-- 0007_storage_policies.sql — «Кадр» — DELETE-политика гостя на storage.objects
-- Источник: SPECIFICATION.md §4.7 (Storage-политики, bucket event-photos private),
--           §5 (отдача ТОЛЬКО подписанным URL, публичных URL нет), §6.5 (отзыв
--           согласия → каскадное удаление фото + объектов Storage).
--           Опирается на: 0001_init.sql (bucket event-photos, функция
--           public.current_guest_id, политика storage_guest_upload — единственная
--           storage-политика до этой миграции).
--
-- Закрываются замечания security-агента (152-ФЗ, Storage):
--
--   1. Нет ЯВНОЙ DELETE-политики на storage.objects. Сегодня все удаления идут
--      через service-role (revoke-consent §6.5, purge-expired §7, discard-photo
--      §6.3), а service-role ОБХОДИТ RLS — поэтому функционально всё работает и
--      без политики. Но deny-by-default означает, что обычный гость не может
--      удалить даже СВОЙ объект напрямую. Для прозрачности и на случай, если
--      какая-то клиентская операция удаления пойдёт НЕ через service-role
--      (гость удаляет своё фото напрямую через storage-api), добавляем явную
--      DELETE-политику, строго ограниченную папкой гостя {event_id}/{guest_id}/.
--      Предикат идентичен storage_guest_upload (тот же скоуп «своя папка»).
--
--   2. Анонимные гости и `to authenticated`. signInAnonymously() создаёт
--      пользователя с is_anonymous=true, но его JWT несёт role='authenticated'
--      (см. supabase/seed_rls_demo.sql: анон-гости вставлены с role/aud=
--      'authenticated'). Значит политики `to authenticated` РАСПРОСТРАНЯЮТСЯ на
--      анонимных гостей. Это уже подтверждено практикой: гости реально грузят
--      фото через storage_guest_upload (`to authenticated`) — политика срабатывает.
--      Поэтому НЕ усиливаем до `to authenticated, anon`: текущего `authenticated`
--      достаточно, лишний grant роли `anon` (которая = неаутентифицированный
--      посетитель) только расширил бы поверхность. Оставляем `to authenticated`.
--
-- РЕШЕНИЕ по SELECT-политике (минимализм, инвариант 152-ФЗ):
--   SELECT-политику НЕ добавляем — ни для гостя, ни для хоста. Отдача фото идёт
--   ИСКЛЮЧИТЕЛЬНО через Edge Function photo-url (service-role → подписанный URL с
--   TTL, §5). Прямой клиентский SELECT объектов не нужен и должен оставаться
--   закрытым: отсутствие SELECT-политики = deny-by-default = доступа нет (для
--   ролей authenticated/anon). Хост видит свои фото через тот же photo-url, ему
--   прямой storage-SELECT тоже не требуется. Так бакет остаётся приватным, а
--   единственный путь к байтам — подписанный URL. service-role (фоновые задачи,
--   Edge Functions) обходит RLS и работает независимо от этих политик.
--
-- Бакет НЕ трогаем: он остаётся private (public=false из 0001, лимиты из 0006).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- DELETE: гость может удалить объект ТОЛЬКО в своей папке {event_id}/{guest_id}/
-- Предикат — копия скоупа storage_guest_upload (0001): первый сегмент пути =
-- event_id, второй = guest_id, и второй должен совпасть с current_guest_id() для
-- этого события у текущего auth.uid(). current_guest_id (security definer,
-- search_path=public) резолвит гостя по (event_id, auth_uid) — для анонимного
-- гостя auth.uid() = его анон-uid, запись guests существует → функция вернёт id.
-- ---------------------------------------------------------------------------
create policy storage_guest_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'event-photos'
    and (storage.foldername(name))[2] =
        public.current_guest_id(((storage.foldername(name))[1])::uuid)::text
  );

-- ---------------------------------------------------------------------------
-- ПРОВЕРКА (см. отчёт):
--   1) supabase db reset — миграции 0001..0007 без ошибок.
--   2) select policyname, cmd from pg_policies
--        where schemaname='storage' and tablename='objects' order by policyname;
--      Ожидаем РОВНО две: storage_guest_delete (DELETE), storage_guest_upload (INSERT).
--   3) SELECT-политики нет → прямой анонимный/клиентский SELECT объектов закрыт
--      (deny-by-default). Фото — только через Edge Function photo-url (подписанный URL).
--   4) storage_guest_upload не тронут → загрузка гостя в свою папку работает как прежде.
-- ---------------------------------------------------------------------------
