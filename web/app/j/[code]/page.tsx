/**
 * Лендинг события — SPECIFICATION §8.2, §6.2, §9 п.3.
 *
 * Получает публичные данные события через Edge Function public-event
 * (GET /functions/v1/public-event?short_code=...).
 * Ошибки: 404 — не найдено, 410 — закрыто/архивировано.
 *
 * Серверный компонент (Next.js App Router).
 * Инварианты: нет зарубежних сервисов/CDN, только SUPABASE_URL из env.
 */

import type { Metadata } from 'next'
import Link from 'next/link'

interface Props {
  params: Promise<{ code: string }>
}

interface PublicEvent {
  title: string
  camera_style: string
  status: string
  reveal_at: string | null
  starts_at: string | null  // ISO timestamp или null — когда начинается съёмка (§9 п.3)
}

type EventResult =
  | { ok: true; event: PublicEvent }
  | { ok: false; code: 'not_found' | 'event_closed' | 'network_error' | string }

const STYLE_LABELS: Record<string, string> = {
  film35:  'Плёнка 35мм',
  vintage: 'Винтаж',
  bw:      'Ч/Б',
  summer:  'Лето',
}

/**
 * Форматирует ISO-дату в «HH:MM DD.MM» — единый формат для всего приложения.
 */
function formatStartsAt(iso: string): string {
  const d = new Date(iso)
  const hh = d.getHours().toString().padStart(2, '0')
  const mm = d.getMinutes().toString().padStart(2, '0')
  const dd = d.getDate().toString().padStart(2, '0')
  const mo = (d.getMonth() + 1).toString().padStart(2, '0')
  return `${hh}:${mm} ${dd}.${mo}`
}

async function fetchPublicEvent(shortCode: string): Promise<EventResult> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !anonKey) {
    // В build-time без env — возвращаем заглушку (страница все равно работает как лендинг)
    return { ok: false, code: 'network_error' }
  }

  try {
    const res = await fetch(
      `${supabaseUrl}/functions/v1/public-event?short_code=${encodeURIComponent(shortCode)}`,
      {
        headers: {
          'apikey': anonKey,
        },
        // Ревалидация через 60с (событие меняется редко)
        next: { revalidate: 60 },
      },
    )

    if (res.status === 404) return { ok: false, code: 'not_found' }
    if (res.status === 410) return { ok: false, code: 'event_closed' }
    if (!res.ok) return { ok: false, code: 'network_error' }

    const data = await res.json() as PublicEvent
    return { ok: true, event: data }
  } catch {
    return { ok: false, code: 'network_error' }
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { code } = await params
  const result = await fetchPublicEvent(code)

  if (result.ok) {
    return {
      title: `${result.event.title} — Кадр`,
      description: 'Присоединяйтесь к совместной фотосъёмке на плёночную камеру. Без установки приложения.',
    }
  }

  return {
    title: `Событие ${code.toUpperCase()} — Кадр`,
    description: 'Присоединяйтесь к совместной фотосъёмке на плёночную камеру.',
  }
}

export default async function EventLandingPage({ params }: Props) {
  const { code } = await params
  const result = await fetchPublicEvent(code)

  // ---- Событие не найдено -----------------------------------------------
  if (!result.ok && result.code === 'not_found') {
    return (
      <main className="page" style={{ justifyContent: 'center' }}>
        <div className="card">
          <div className="app-brand">Кадр</div>
          <div className="stack-lg">
            <div className="text-center">
              <h1 style={{ marginBottom: '12px' }}>Событие не найдено</h1>
              <p className="text-muted">
                Ссылка недействительна или событие было удалено. Проверьте QR-код.
              </p>
            </div>
            <Link href="/" className="btn-secondary">
              На главную
            </Link>
          </div>
        </div>
      </main>
    )
  }

  // ---- Событие закрыто (edge case §9) -------------------------------------
  if (!result.ok && result.code === 'event_closed') {
    return (
      <main className="page" style={{ justifyContent: 'center' }}>
        <div className="card">
          <div className="app-brand">Кадр</div>
          <div className="stack-lg">
            <div className="text-center">
              <h1 style={{ marginBottom: '12px' }}>Событие закрыто</h1>
              <p className="text-muted">
                Это событие завершено и больше не принимает участников.
                Если вы уже были участником — воспользуйтесь ссылкой из сохранённой вкладки.
              </p>
            </div>
            <Link href="/" className="btn-secondary">
              На главную
            </Link>
          </div>
        </div>
      </main>
    )
  }

  // ---- Ошибка сети (бэкенд недоступен) — показываем универсальный лендинг -
  if (!result.ok) {
    return <FallbackLanding code={code} />
  }

  const { event } = result
  const styleLabel = STYLE_LABELS[event.camera_style] ?? event.camera_style
  const isClosed = event.status === 'archived' || event.status === 'deleted'

  if (isClosed) {
    return (
      <main className="page" style={{ justifyContent: 'center' }}>
        <div className="card">
          <div className="app-brand">Кадр</div>
          <div className="stack-lg">
            <div className="text-center">
              <h1 style={{ marginBottom: '12px' }}>Событие закрыто</h1>
              <p className="text-muted">
                «{event.title}» завершено и больше не принимает участников.
              </p>
            </div>
            <Link href="/" className="btn-secondary">На главную</Link>
          </div>
        </div>
      </main>
    )
  }

  // Проверяем, не началось ли ещё событие (§9 п.3). Серверный рендер — Date.now() актуален.
  const notStartedYet =
    event.starts_at !== null && new Date(event.starts_at) > new Date()

  const startsAtFormatted = event.starts_at ? formatStartsAt(event.starts_at) : null

  return (
    <main className="page" style={{ justifyContent: 'center' }}>
      <div className="card">
        <div className="app-brand">Кадр</div>

        {/* Декоративная плёнка */}
        <div className="film-strip">
          <span /><span /><span /><span /><span />
        </div>

        <div className="stack-lg">
          {/* Название события */}
          <div className="text-center">
            <p
              style={{
                fontSize: '0.75rem',
                letterSpacing: '0.15em',
                textTransform: 'uppercase',
                color: 'var(--text-dim)',
                marginBottom: '10px',
              }}
            >
              Вы приглашены
            </p>
            <h1
              style={{
                fontSize: '1.75rem',
                lineHeight: '1.2',
                color: 'var(--text)',
                marginBottom: '10px',
              }}
            >
              {event.title}
            </h1>
            <p
              style={{
                fontSize: '0.8rem',
                color: 'var(--text-dim)',
                letterSpacing: '0.05em',
              }}
            >
              Стиль: {styleLabel}
            </p>
          </div>

          {/* Баннер «Событие ещё не началось» (§9 п.3) */}
          {notStartedYet && startsAtFormatted && (
            <div
              style={{
                background: 'rgba(212,168,83,0.12)',
                border: '1px solid rgba(212,168,83,0.4)',
                borderRadius: 'var(--radius)',
                padding: '14px 16px',
                textAlign: 'center',
              }}
            >
              <p
                style={{
                  fontSize: '0.9rem',
                  color: 'var(--accent)',
                  fontWeight: 600,
                  marginBottom: '4px',
                }}
              >
                Событие начнётся: {startsAtFormatted}
              </p>
              <p
                style={{
                  fontSize: '0.8rem',
                  color: 'var(--text-muted)',
                }}
              >
                Вы можете присоединиться сейчас — съёмка откроется в момент старта.
              </p>
            </div>
          )}

          {/* Объяснение сервиса */}
          <div
            style={{
              background: 'var(--bg-input)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              padding: '16px',
            }}
          >
            <p
              style={{
                fontSize: '0.9rem',
                color: 'var(--text-muted)',
                lineHeight: '1.6',
                textAlign: 'center',
              }}
            >
              Снимай на плёночную камеру вместе со всеми —
              кадры появятся в общей галерее{event.reveal_at ? ' после проявки' : ''}.
              Без установки приложения.
            </p>
          </div>

          {/* CTA — кнопка присоединиться всегда доступна (гость заходит и ждёт) */}
          <Link href={`/j/${code}/join`} className="btn-primary">
            Присоединиться
          </Link>

          <p className="text-muted text-center" style={{ fontSize: '0.8rem' }}>
            {notStartedYet
              ? 'Вы перейдёте к форме согласия; съёмка откроется в момент старта'
              : 'Нажимая «Присоединиться», вы перейдёте к форме согласия'}
          </p>
        </div>
      </div>
    </main>
  )
}

// Запасной лендинг когда бэкенд недоступен (build-time / сеть)
function FallbackLanding({ code }: { code: string }) {
  const displayCode = code.toUpperCase()
  return (
    <main className="page" style={{ justifyContent: 'center' }}>
      <div className="card">
        <div className="app-brand">Кадр</div>

        <div className="film-strip">
          <span /><span /><span /><span /><span />
        </div>

        <div className="stack-lg">
          <div className="text-center">
            <p
              style={{
                fontSize: '0.75rem',
                letterSpacing: '0.15em',
                textTransform: 'uppercase',
                color: 'var(--text-dim)',
                marginBottom: '10px',
              }}
            >
              Событие
            </p>
            <h1
              style={{
                fontFamily: 'monospace',
                fontSize: '2.5rem',
                letterSpacing: '0.12em',
                color: 'var(--accent)',
              }}
            >
              {displayCode}
            </h1>
          </div>

          <div
            style={{
              background: 'var(--bg-input)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              padding: '16px',
            }}
          >
            <p
              style={{
                fontSize: '0.9rem',
                color: 'var(--text-muted)',
                lineHeight: '1.6',
                textAlign: 'center',
              }}
            >
              Снимай на плёночную камеру вместе со всеми —
              кадры появятся в общей галерее после проявки.
              Без установки приложения.
            </p>
          </div>

          <Link href={`/j/${code}/join`} className="btn-primary">
            Присоединиться
          </Link>

          <p className="text-muted text-center" style={{ fontSize: '0.8rem' }}>
            Нажимая «Присоединиться», вы перейдёте к форме согласия
          </p>
        </div>
      </div>
    </main>
  )
}
