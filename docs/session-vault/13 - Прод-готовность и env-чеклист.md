---
type: note
tags: [кадр, 152-фз, прод, деплой, env, security]
---

# 13 — Прод-готовность и env-чеклист

[[00 - Карта проекта|← к карте]]

Закрыты все прод-замечания security-агента. **Повторный аудит: PASS** — критичных/high находок нет, регрессий от массовых CORS-правок (11 функций) нет.

## Что закрыто (vs прошлый аудит)

| Замечание | Решение |
|---|---|
| DELETE storage-политика гостя | 0007: `storage_guest_delete` (своя папка) |
| Серверные лимиты файла | 0006: bucket 12МБ + только image/jpeg |
| CORS не wildcard на проде | `cors.ts` corsHeadersFor: echo-back из ALLOWED_ORIGINS |
| toPublicUrl localhost на проде | `_shared/storage.ts`: KADR_ENV=production → не localhost |
| Мусорные резервы photos | cron kadr-purge-stale-reservations + discard-photo |
| Атомарность отзыва согласия | RPC revoke_consent_atomic (0005) |
| Видимость фото deleted-события | is_event_deleted в RLS photos (0005) |
| fail-closed PURGE_SECRET | purge-expired 500 без секрета |

## ⚠️ ОБЯЗАТЕЛЬНЫЙ env-чеклист для прода

> [!danger] Без этих переменных прод сломается или потеряет защиту
> Edge Functions (Supabase secrets):

1. `KADR_ENV=production` — иначе toPublicUrl уйдёт в localhost-fallback.
2. `PUBLIC_STORAGE_URL` (публичный РФ-домен Storage) — иначе ссылки на фото битые (внутренний kong-хост).
3. `ALLOWED_ORIGINS` (домены гостевого PWA/хоста через запятую) — иначе CORS падает на `'*'`, приватные функции теряют CORS-рубеж.
4. `PURGE_SECRET` (сильный секрет) — иначе purge-expired = 500, retention не чистит Storage.
5. `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — стандартные.
6. `JOIN_BASE_URL` (продовый домен; дефолт https://kadr.ru).

В БД (admin-SQL на проде):
7. `update app_config set value='https://api.<домен>/functions/v1/purge-expired' where key='purge_url';`
8. `update app_config set value='<тот же PURGE_SECRET>' where key='purge_secret';`

Web (build-time):
9. `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_POLICY_VERSION` — продовые РФ-значения.

## Незакрытое (Low / на будущее)

- Биллинг ЮKassa не реализован (отложен). При появлении: проверка подписи вебхука + идемпотентность по `provider_id` (схема `unique(provider,provider_id)` готова) — отдельный аудит.
- CSP в next.config (запрет зарубежных доменов на уровне браузера) — «при деплое».
- `consents` не чистятся при purge события — намеренно (доказательная база 152-ФЗ), отразить в политике сроков.

## Инварианты — все PASS

RLS на всех таблицах; фото только подписанными URL (бакет приватный, нет SELECT-политики); нет биометрии; только РФ/self-hosted; журнал согласий сохраняется (revoked_at); retention (cron+purge); согласие до первого кадра; минимизация (только jpeg с фильтром, без оригинала).
