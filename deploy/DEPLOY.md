# DEPLOY — «Кадр» в РФ-облако (self-hosted Supabase)

Пошаговая инструкция развёртывания. Выполняет **владелец** (нужны доступы к РФ-облаку,
домену, S3). Соответствует инвариантам 152-ФЗ: вся ПДн-инфраструктура — в РФ.

> [!warning] Перед стартом обработки ПДн (организационное, вне кода)
> Уведомление РКН подано · политика обработки ПДн опубликована · формы согласий внедрены ·
> уровень защищённости (УЗ) определён · меры Приказа ФСТЭК №21. Это подтверждает специалист
> по ПДн — без этого продакшн с реальными пользователями запускать нельзя.

---

## 0. Что разворачиваем

| Компонент | Где | Чем |
|---|---|---|
| Postgres + Auth + Storage + Edge Functions | VM в РФ-облаке (Yandex/VK Cloud/Selectel) | self-hosted Supabase (Docker) |
| Object Storage (фото) | Yandex Object Storage / VK Cloud S3 (РФ) | S3-бэкенд Supabase Storage |
| Гостевой web (PWA) | VM/контейнер в РФ ИЛИ статика + Node | Next.js (`web/`) |
| Reverse-proxy + TLS | та же VM | Caddy/Nginx (домены kadr.ru, api.kadr.ru) |
| iOS-хост | App Store | `ios/` (SwiftUI) — сборка/подпись в Xcode |

ЗАПРЕЩЕНО (152-ФЗ): Supabase Cloud, Vercel, Firebase, зарубежный S3/CDN/аналитика.

---

## 1. Инфраструктура (РФ-облако)

1. Создай **VM** в Yandex Cloud / VK Cloud / Selectel (РФ-регион). Рекомендуется:
   Ubuntu 22.04 LTS, 4 vCPU / 8 ГБ RAM / 40+ ГБ SSD (для старта).
2. Создай **Object Storage bucket** в том же РФ-регионе (`kadr-event-photos`), включи
   шифрование at-rest. Получи S3 access/secret key. Бакет — **приватный**.
3. Привяжи **домены** к IP VM: `kadr.ru` (PWA), `api.kadr.ru` (Supabase API).
4. Открой порты: 80/443 (proxy). Postgres/внутренние — НЕ наружу.
5. Установи на VM: Docker + Docker Compose, git.

---

## 2. Self-hosted Supabase на VM

```bash
# на VM
git clone --depth 1 https://github.com/supabase/supabase
cd supabase/docker
cp .env.example .env
```

Заполни `supabase/docker/.env` значениями из нашего `deploy/.env.production`
(POSTGRES_PASSWORD, JWT_SECRET, ANON_KEY, SERVICE_ROLE_KEY, SITE_URL, API_EXTERNAL_URL,
SMTP_*). Для Storage переключи на S3-бэкенд (см. шаг 4).

```bash
docker compose pull
docker compose up -d
docker compose ps   # все healthy
```

---

## 3. Ключи (JWT_SECRET → ANON_KEY / SERVICE_ROLE_KEY)

```bash
# JWT_SECRET — сильный, ≥32 символа:
openssl rand -hex 32
```
ANON_KEY и SERVICE_ROLE_KEY — это JWT, подписанные JWT_SECRET, с ролями `anon` и
`service_role`. Сгенерируй их генератором Supabase
(https://supabase.com/docs/guides/self-hosting — раздел API keys) ИЛИ скриптом
`deploy/gen-keys.mjs` (см. файл). Впиши в `.env.production` и в `supabase/docker/.env`.

---

## 4. Storage → S3 (РФ Object Storage)

В `supabase/docker/.env` (или volumes-конфиге Storage) задай:
```
STORAGE_BACKEND=s3
GLOBAL_S3_BUCKET=kadr-event-photos
AWS_ACCESS_KEY_ID=<S3_ACCESS_KEY>
AWS_SECRET_ACCESS_KEY=<S3_SECRET_KEY>
AWS_DEFAULT_REGION=ru-central1
STORAGE_S3_ENDPOINT=https://storage.yandexcloud.net
```
Перезапусти storage-сервис. Бакет `event-photos` создаётся миграцией 0001 (приватный);
лимиты (12МБ, image/jpeg) — миграцией 0006.

---

## 5. Применение миграций и Edge Functions

С локальной машины (где установлен `supabase` CLI) ИЛИ с VM. Привяжи проект к
self-hosted инстансу:

```bash
# линк к своему инстансу (db url прода)
export SUPABASE_DB_URL="postgresql://postgres:<POSTGRES_PASSWORD>@<VM_IP>:5432/postgres"

# применить все миграции 0001-0007
supabase db push --db-url "$SUPABASE_DB_URL"

# проверить, что применились (7 миграций, RLS, cron, bucket-лимиты)
psql "$SUPABASE_DB_URL" -c "select count(*) from supabase_migrations.schema_migrations;"
psql "$SUPABASE_DB_URL" -c "select jobname from cron.job order by jobname;"   # 4 задачи
```

Edge Functions (11 штук):
```bash
supabase functions deploy --project-ref <ref>   # или по одной: supabase functions deploy join-event ...
# секреты функций:
supabase secrets set KADR_ENV=production PUBLIC_STORAGE_URL=https://api.kadr.ru \
  JOIN_BASE_URL=https://kadr.ru ALLOWED_ORIGINS=https://kadr.ru,https://www.kadr.ru \
  PURGE_SECRET=<сильный_секрет> --project-ref <ref>
```

Конфиг app_config для cron-чистки Storage (через pg_net):
```bash
psql "$SUPABASE_DB_URL" <<SQL
update app_config set value='https://api.kadr.ru/functions/v1/purge-expired' where key='purge_url';
update app_config set value='<тот_же_PURGE_SECRET>' where key='purge_secret';
SQL
```

---

## 6. Auth: российский SMS-OTP

Локально хост входит по email-OTP. На проде — телефон + **российский SMS**
(SMS Aero / SMSC) через кастомный Auth hook. Настрой hook в Supabase Auth
(`GOTRUE_HOOK_SEND_SMS_*` → твоя функция-прокси к SMS-провайдеру). Зарубежный SMS
(Twilio) — запрещён (152-ФЗ). Анонимные сессии гостей оставь включёнными.

---

## 7. Гостевой web (Next.js)

```bash
cd web
# .env.local прода:
#   NEXT_PUBLIC_SUPABASE_URL=https://api.kadr.ru
#   NEXT_PUBLIC_SUPABASE_ANON_KEY=<ANON_KEY>
#   NEXT_PUBLIC_POLICY_VERSION=2026-06-01
npm ci
npm run build      # turbopack (см. session-vault/06 — webpack виснет)
npm run start      # или раздать .next через контейнер за proxy
```
Камера (`getUserMedia`) работает только по HTTPS — отсюда важен TLS-домен (шаг 8).

---

## 8. Reverse-proxy + TLS (Caddy)

См. `deploy/Caddyfile.production`. Caddy сам получит Let's Encrypt-сертификаты для
`kadr.ru` и `api.kadr.ru` (домены должны указывать на VM). Запуск:
```bash
caddy run --config deploy/Caddyfile.production
# или как systemd-сервис
```
`kadr.ru` → Next.js (web, порт 3000); `api.kadr.ru` → Supabase Kong (порт 8000).

---

## 9. iOS-приложение хоста

- В `ios/Kadr/AppConfig.swift`: `baseURL = "https://api.kadr.ru"`, `anonKey = <ANON_KEY>`,
  `useAnonymousHostLogin = false` (на проде — телефон+OTP).
- Собрать и подписать в Xcode своим Apple Developer аккаунтом, выложить в App Store.
- Mobile (Expo) — альтернатива; для App Store нужен EAS Build / нативная сборка.

---

## 10. Финальный чеклист 152-ФЗ (перед запуском)

```
□ VM, Postgres, Storage — физически в РФ (Yandex/VK/Selectel)
□ Object Storage приватный, шифрование at-rest включено
□ TLS на всех доменах (Caddy/Let's Encrypt), HTTP→HTTPS редирект
□ Миграции 0001-0007 применены; RLS на всех таблицах; 4 cron-задачи активны
□ Edge Functions задеплоены; секреты заданы (см. deploy/.env.production.example)
□ app_config.purge_url / purge_secret заданы; purge-expired реально чистит Storage
□ ALLOWED_ORIGINS = только домены kadr.ru (CORS не '*')
□ KADR_ENV=production (toPublicUrl не уходит в localhost)
□ SMS-OTP — российский провайдер; Twilio выключен
□ Аналитика — AppMetrica/Метрика; нет Google/Firebase
□ Уведомление РКН подано; политика ПДн опубликована; согласия внедрены
□ Бэкапы Postgres в РФ; уровень защищённости (УЗ) определён, меры ФСТЭК №21
□ Smoke-тест на проде: создание события (хост) → QR → вступление гостя → съёмка →
  галерея → проявка → отзыв согласия (каскадное удаление)
```

---

## 11. Откат / обслуживание

- Бэкап перед миграциями: `pg_dump` в РФ-хранилище.
- Откат миграции: применить компенсирующую (down-миграции в проекте не пишем — только
  forward; для отката готовь снапшот БД).
- Логи функций: `supabase functions logs <name>`.
- Мониторинг cron: `select * from cron.job_run_details order by start_time desc limit 20;`

> Биллинг ЮKassa в этой версии НЕ развёрнут (всё бесплатно, план free). При добавлении —
> отдельный шаг: webhook-функция + проверка подписи + идемпотентность по provider_id.
