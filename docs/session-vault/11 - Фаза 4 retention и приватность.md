---
type: note
tags: [кадр, 152-фз, retention, приватность, cron, фаза4]
---

# 11 — Фаза 4: retention и приватность

[[00 - Карта проекта|← к карте]]

Закрывает 152-ФЗ-требования по срокам хранения (ст. 5) и правам субъектов (§6.5). Биллинг ЮKassa — отдельно, не сделан.

## Фоновые задачи (pg_cron) — миграции 0004 + 0005

3 cron-задачи (проверено: `select jobname from cron.job`):

| Задача | Расписание | Что |
|---|---|---|
| `kadr-auto-reveal` | `*/5 * * * *` | `status: live→revealed` когда `reveal_at <= now()` |
| `kadr-retention-mark` | `0 3 * * *` | `status → deleted` когда `expires_at <= now()` |
| `kadr-purge-expired` | `15 3 * * *` | HTTP-вызов purge-expired через `pg_net` |

Конфиг URL/секрета purge — в таблице `app_config` (RLS deny-by-default, хелпер `app_config_get`). На локалке URL = `http://kong:8000/...` (внутренний Docker), секрет пуст; на проде переопределяется. Почему не `ALTER DATABASE ... SET app.*` — не работает без superuser в self-hosted.

## Edge Functions

- **purge-expired** — физическое удаление: Storage-объекты (фото + `cover_path` + QR) → каскад БД (`delete events` сносит guests/photos/...). Fail-closed по `PURGE_SECRET` (обязателен!). Идемпотентно, батчи ≤50.
- **revoke-consent** (§6.5, §9 п.8) — отзыв согласия → каскадное удаление **всех** фото субъекта (по `auth_uid`, не только `consent_id`) + объекты Storage (ДО строк БД) + `consents.revoked_at` + аудит. Атомарно через RPC `revoke_consent_atomic`. Идемпотентно (`already_revoked`).
- **deletion-request** (§6.5) — запрос удаления: `photo` (своё) сразу, `guest`/`account` на модерацию (`processed_at=null`).

## Закалка по аудиту security-agent

Аудит дал PASS, но нашёл пробелы — все закрыты:
- **H2**: каскад отзыва по `subject_uid` (раньше по `consent_id` → фото с NULL-consent оставались). Проверено: photos_removed=3 для гостя в 2 событиях, не 0.
- **H1**: аудит-запись `scope='guest', target_id=null` (раньше клали consent_id в target_id — врал).
- **H3**: атомарность отзыва (RPC), аудит гарантирован (500 при сбое).
- **M1**: RLS `photos` скрывает фото `deleted`-событий (хелпер `is_event_deleted`). RLS-тест CHECK 5.
- **M2**: автозапуск purge через cron+pg_net (раньше никто не вызывал → данные не удалялись никогда).
- **M3**: purge fail-closed без секрета. **M4**: чистка `cover_path`.

## Инварианты 152-ФЗ

Журнал согласий **сохраняется** (ставится `revoked_at`, строка не удаляется — доказательство). Storage удаляется ДО строк. Аудит прав субъектов в `deletion_requests` (`processed_at`). Только Supabase/РФ, бакет приватный.

## env (важно для прода)

- `PURGE_SECRET` — **обязателен** (fail-closed). Cron передаёт в `x-purge-secret`; дублируется в `app_config.purge_secret`.
- На проде: задать `app_config.purge_url` = публичный РФ-домен функции.

## Осталось (бэклог фазы 4)

- Биллинг ЮKassa: `billing/checkout` + вебхук (идемпотентность по `provider_id`), апгрейд плана.
- M5: сузить CORS до домена PWA на проде. См. [[07 - Найденные баги (бэклог)]].
