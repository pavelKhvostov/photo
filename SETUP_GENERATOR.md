---
project: Кадр — событийная камера
layer: 3 / SETUP_GENERATOR
methodology: Spec-First + GSD
depends_on: [PROJECT_IDEA.md, SPECIFICATION.md]
updated: 2026-06-02
tags: [setup-generator, spec-first, gsd, claude-code]
---

# SETUP_GENERATOR — «Кадр»

> Layer 3. Это **промпт-инструкция**, превращающая спецификацию в конфигурацию Claude Code.
> Результат уже сгенерирован в `kadr-config/` (CLAUDE.md, 5 субагентов, rules). Этот файл
> нужен, чтобы пересобрать/обновить пакет, когда спека меняется.

## Как использовать
1. Открой проект в Claude Code (CLI или VS Code).
2. Вставь блок «Промпт генератора» ниже одним сообщением.
3. Claude Code создаст/обновит файлы конфигурации в `.claude/` и `CLAUDE.md`.
4. Проверь чеклист в конце.

---

## Промпт генератора (копировать целиком)

```
Ты — setup-generator. На входе у тебя PROJECT_IDEA.md и SPECIFICATION.md проекта «Кадр»
(событийная камера, аналог pov.camera для РФ, 152-ФЗ). Сгенерируй конфигурацию Claude Code.

ЖЁСТКИЕ ИНВАРИАНТЫ (должны попасть в CLAUDE.md и rules/152-fz.md):
1. Локализация: Postgres+Storage+деплой только в РФ (self-hosted Supabase, Yandex/VK Cloud).
   Запрет: Supabase Cloud, Vercel, Firebase, Stripe, Google Analytics.
2. Нет распознавания/детекции лиц нигде (вне биометрии, ст. 11).
3. RLS включён на каждой таблице.
4. Аналитика только российская (AppMetrica/Метрика).
5. Фото — только подписанные URL с TTL, приватный бакет.
6. Согласие пишется в consents (IP/UA/версия) до первого кадра.

Создай файлы:

A. CLAUDE.md — ≤120 строк. Разделы: краткое описание продукта; инварианты 152-ФЗ; стек
   (iOS SwiftUI / Next.js PWA / self-hosted Supabase / Yandex|VK Cloud / ЮKassa / APNs);
   структура репозитория; архитектура коротко (хост=OTP, гость=анон-сессия, проявка в RLS,
   retention через cron); конвенции (uuid, timestamptz, деньги в копейках, text+CHECK,
   лимиты из plans, формат ошибок, идемпотентность); команды; процесс GSD; MCP.
   Детали НЕ дублировать — отсылать к SPECIFICATION.md.

B. .claude/agents/ — 5 субагентов с frontmatter (name, description, model, tools):
   - database-architect — opus — Read, Write, Bash — схема, миграции, RLS, функции, cron.
   - backend-engineer  — opus — Read, Write, Bash — Edge Functions, API §6, ЮKassa, SMS, APNs.
   - frontend-developer — sonnet — Read, Write — iOS SwiftUI + web/PWA, камера, фильтры, §8.
   - security-agent    — opus — Read, Bash — аудит RLS + 152-ФЗ чеклист, БЕЗ правки кода.
   - qa-reviewer       — sonnet — Read, Bash — сверка со спекой, edge cases §9, БЕЗ правки кода.
   У security-agent и qa-reviewer НЕ должно быть Write/Edit.

C. .claude/rules/152-fz.md — globs на supabase/**, web/**, ios/**, *.sql, deploy*, *.env*;
   alwaysApply: true; перечислить все 6 инвариантов + организационные пункты (РКН, политика, УЗ).

D. .claude/rules/conventions.md — globs на код; типы, формат ошибок, идемпотентность,
   копейки, лимиты из plans, русский UI.

E. .claude/skills/ — заглушки навыков: supabase-migrations (как писать миграцию+RLS),
   deploy-ru-cloud (деплой self-hosted Supabase в Yandex/VK Cloud).

F. feature-spec-template.md — шаблон мини-спеки фичи (user stories, данные, API, UI, edge cases).

MCP: указать Context7 (доки Next.js/Supabase/ЮKassa) и Supabase MCP в CLAUDE.md.

Не выдумывай зарубежные сервисы. Не добавляй биометрию. Выведи список созданных файлов.
```

---

## Целевой состав пакета

```
kadr/
├── CLAUDE.md                         ✅ сгенерирован
├── .claude/
│   ├── agents/
│   │   ├── database-architect.md     ✅
│   │   ├── backend-engineer.md       ✅
│   │   ├── frontend-developer.md     ✅
│   │   ├── security-agent.md         ✅ (без Write)
│   │   └── qa-reviewer.md            ✅ (без Write)
│   ├── rules/
│   │   ├── 152-fz.md                 ✅
│   │   └── conventions.md            ⬜ добавить при сборке
│   └── skills/
│       ├── supabase-migrations/      ⬜
│       └── deploy-ru-cloud/          ⬜
└── feature-spec-template.md          ⬜ (см. отдельный файл)
```

## MCP-серверы (подключить в Claude Code)
- **Context7** — актуальная документация Next.js / Supabase / ЮKassa SDK во время сборки.
- **Supabase MCP** — применять миграции и запросы к локальному и российскому инстансу.

## Чеклист готовности Setup Generator (Spec-First)
```
□ CLAUDE.md ≤ 120 строк                                   ✓
□ Субагенты: правильные модели (opus/sonnet) и tools      ✓
□ qa-reviewer и security-agent без Write/Edit             ✓
□ Rules привязаны к glob-паттернам                        ✓
□ Инварианты 152-ФЗ зашиты в CLAUDE.md и rules            ✓
□ MCP: Context7 + Supabase указаны                        ✓
```

## Следующий шаг — Layer 5 (автономная сборка)
- `git init`, инициализировать `web/` (Next.js) и `ios/` (SwiftUI), поднять локальный
  `supabase start`, настроить `.env.local` (ключи ЮKassa/SMS — позже).
- `/gsd:new-project` уже не нужен (спека готова) → начать с
  `/gsd:plan-phase 1` (Backend в РФ: миграции + RLS из SPECIFICATION §2–4) →
  `/gsd:execute-plan`. Затем фазы 2–5 из PROJECT_IDEA §08.
