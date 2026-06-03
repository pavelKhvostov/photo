# deploy/ — развёртывание «Кадр» в РФ-облако

Инфраструктура для self-hosted Supabase (152-ФЗ: всё в РФ). Реальный деплой
выполняет владелец со своими доступами.

## Файлы

| Файл | Назначение |
|---|---|
| **DEPLOY.md** | главная пошаговая инструкция (11 шагов + чеклист 152-ФЗ) |
| `.env.production.example` | шаблон всех секретов прода → скопировать в `.env.production` |
| `gen-keys.mjs` | генератор ANON_KEY / SERVICE_ROLE_KEY из JWT_SECRET |
| `Caddyfile.production` | reverse-proxy + авто-TLS (kadr.ru, api.kadr.ru) + CSP |
| `apply.sh` | применить миграции + задеплоить функции + app_config |
| `.gitignore` | защита: заполненный `.env.production` и ключи не коммитятся |

## Быстрый старт

1. Прочитай **DEPLOY.md** целиком.
2. `cp .env.production.example .env.production` → заполни.
3. Сгенерируй ключи: `JWT_SECRET="$(openssl rand -hex 32)" node gen-keys.mjs`.
4. Разверни self-hosted Supabase на VM (DEPLOY.md шаг 2), подключи S3 РФ (шаг 4).
5. `bash apply.sh` — миграции + функции + app_config.
6. Подними web (`web/`) и Caddy (Caddyfile.production).
7. Пройди финальный чеклист 152-ФЗ (DEPLOY.md шаг 10).

> Биллинг ЮKassa не входит (всё бесплатно, план free).
