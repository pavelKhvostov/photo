#!/usr/bin/env node
// gen-keys.mjs — генерация ANON_KEY и SERVICE_ROLE_KEY для self-hosted Supabase.
// Это JWT (HS256), подписанные JWT_SECRET, с ролями anon / service_role.
//
// Использование:
//   JWT_SECRET="<твой_секрет_min_32>" node deploy/gen-keys.mjs
//
// Срок действия — 10 лет (как у дефолтных ключей Supabase). Впиши вывод в
// .env.production и в supabase/docker/.env (ANON_KEY, SERVICE_ROLE_KEY).

import crypto from 'node:crypto'

const secret = process.env.JWT_SECRET
if (!secret || secret.length < 32) {
  console.error('Задай JWT_SECRET (≥32 символа). Пример: openssl rand -hex 32')
  process.exit(1)
}

const b64url = (obj) =>
  Buffer.from(JSON.stringify(obj)).toString('base64url')

function sign(role) {
  const now = Math.floor(Date.now() / 1000)
  const header = b64url({ alg: 'HS256', typ: 'JWT' })
  const payload = b64url({
    role,
    iss: 'supabase',
    iat: now,
    exp: now + 60 * 60 * 24 * 365 * 10, // 10 лет
  })
  const sig = crypto
    .createHmac('sha256', secret)
    .update(`${header}.${payload}`)
    .digest('base64url')
  return `${header}.${payload}.${sig}`
}

console.log('ANON_KEY=' + sign('anon'))
console.log('SERVICE_ROLE_KEY=' + sign('service_role'))
