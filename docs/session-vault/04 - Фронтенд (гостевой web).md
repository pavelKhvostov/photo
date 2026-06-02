---
type: note
tags: [кадр, frontend, nextjs]
---

# 04 — Фронтенд (гостевой web)

[[00 - Карта проекта|← к карте]]

Папка `web/` — Next.js 15.5 App Router, TypeScript, `@supabase/supabase-js`. Тёмная «плёночная» тема, русский UI, mobile-first.

> [!warning] Сборка только через Turbopack
> `next build` (webpack) виснет в этом окружении. В `package.json` стоит `next build --turbopack` и `next dev --turbopack`. Подробности — [[06 - Грабли и решения]].

## Экраны (`web/app/`)

| Маршрут | Что |
|---|---|
| `/` | корень, ввод кода события |
| `/j/[code]` | лендинг события (через `public-event`), название + стиль + кнопка |
| `/j/[code]/join` | имя + чекбокс согласия (**не предзаполнен**, блокирует кнопку) |
| `/j/[code]/camera` | `getUserMedia` → съёмка → фильтр → загрузка |
| `/j/[code]/gallery` | табы «Мои/Общая», плашка проявки, лайтбокс |
| `/privacy` | заглушка политики ПДн |

## Библиотеки (`web/lib/`)

- `supabase.ts` — браузерный клиент. `createClient<any,any,any>` — обрезает тяжёлый вывод типов PostgREST (страховка от зависания tsc).
- `types.ts` — `CameraStyle`, `GuestSession`, контракты join/photos.
- `joinEvent.ts` — вступление: `signInAnonymously` → `join-event` (с таймаутом 12с + 1 ретрай против холодного старта).
- `photos.ts` — `requestUploadUrl` / `uploadBlob` (через `uploadToSignedUrl`, обходит kong-хост) / `confirmUpload` / `listPhotos` (PostgREST под RLS) / `getPhotoUrl` (кэш ~9 мин).
- `filters.ts` — плёночные фильтры на canvas: **только пиксельная арифметика** (нет распознавания лиц!). film35/vintage/bw/summer + зерно + виньетка. Ресайз ≤2048px до обработки, лимит 12МБ (понижение качества).

## Сессия гостя

После `join-event` данные (guest_id, event_id, shots_left, reveal_at, camera_style) кладутся в `sessionStorage` под `GUEST_SESSION_KEY`. Камера/галерея читают оттуда; нет сессии → редирект на `/join`.

Связано: [[03 - Бэкенд (Supabase)]], баги UI — [[07 - Найденные баги (бэклог)]]
