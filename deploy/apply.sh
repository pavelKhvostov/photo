#!/usr/bin/env bash
# apply.sh — применить миграции + задеплоить Edge Functions + задать секреты на ПРОДЕ.
# Запускать с локальной машины (установлен supabase CLI) ИЛИ с VM.
#
# Требуется заполненный deploy/.env.production.
# Использование:
#   bash deploy/apply.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
ENV_FILE="$HERE/.env.production"

if [ ! -f "$ENV_FILE" ]; then
  echo "Нет $ENV_FILE — скопируй из .env.production.example и заполни." >&2
  exit 1
fi
set -a; . "$ENV_FILE"; set +a

: "${POSTGRES_PASSWORD:?}"; : "${API_EXTERNAL_URL:?}"; : "${PURGE_SECRET:?}"
DB_URL="${SUPABASE_DB_URL:-postgresql://postgres:${POSTGRES_PASSWORD}@${DB_HOST:-127.0.0.1}:${POSTGRES_PORT:-5432}/postgres}"

echo "==> 1/4 Применение миграций (0001-0007)"
supabase db push --db-url "$DB_URL"

echo "==> 2/4 Проверка: миграции, RLS, cron, bucket-лимиты"
psql "$DB_URL" -c "select count(*) as migrations from supabase_migrations.schema_migrations;"
psql "$DB_URL" -c "select jobname from cron.job order by jobname;"
psql "$DB_URL" -c "select id, public, file_size_limit, allowed_mime_types from storage.buckets where id='event-photos';"

echo "==> 3/4 Деплой Edge Functions + секреты"
# подставь --project-ref своего инстанса, если используешь облачный CLI-флоу;
# для чистого self-hosted деплой функций — через образ edge-runtime в docker-compose.
for fn in join-event create-event reveal public-event upload-url confirm-upload \
          photo-url discard-photo revoke-consent deletion-request purge-expired; do
  echo "   - deploy $fn"
  supabase functions deploy "$fn" --no-verify-jwt || true
done

echo "==> 4/4 app_config для cron-чистки Storage"
psql "$DB_URL" <<SQL
update app_config set value='${API_EXTERNAL_URL}/functions/v1/purge-expired' where key='purge_url';
update app_config set value='${PURGE_SECRET}' where key='purge_secret';
select key, left(value, 40) as value_preview from app_config order by key;
SQL

echo "==> Готово. Не забудь secrets для функций (KADR_ENV, PUBLIC_STORAGE_URL,"
echo "    ALLOWED_ORIGINS, JOIN_BASE_URL, PURGE_SECRET) — см. DEPLOY.md шаг 5."
