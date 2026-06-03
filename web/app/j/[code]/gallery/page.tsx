'use client'

/**
 * Галерея — SPECIFICATION §8.2, §9 edge case 4.
 *
 * Табы: «Мои кадры» / «Общая галерея».
 * - «Мои» — всегда видны свои uploaded кадры.
 * - «Общая» — RLS отдаёт чужие только после проявки. До проявки показываем плашку.
 *
 * reveal_at/status берём с сервера (GET public-event) при монтировании, чтобы
 * отражать актуальное состояние даже если хост сдвинул время или нажал «Проявить».
 * При ошибке запроса — fallback на значение из sessionStorage (не падать).
 *
 * Фото получаем по подписанным URL через getPhotoUrl (ИНВАРИАНТ: бакет приватный).
 * Нет зарубежних сервисов, аналитики, CDN.
 * Все вызовы к API — только в useEffect/обработчиках (не SSR).
 */

import type { CSSProperties } from 'react'
import { useState, useEffect, useCallback, use } from 'react'
import Link from 'next/link'
import type { GuestSession } from '@/lib/types'
import { GUEST_SESSION_KEY } from '@/lib/types'
import { listPhotos, getPhotoUrl } from '@/lib/photos'
import type { PhotoRow } from '@/lib/photos'

interface Props {
  params: Promise<{ code: string }>
}

type GalleryTab = 'mine' | 'all'

// ---- Форматирование даты проявки ----------------------------------------

function formatRevealTime(revealAt: string): string {
  const d = new Date(revealAt)
  const hh = d.getHours().toString().padStart(2, '0')
  const mm = d.getMinutes().toString().padStart(2, '0')
  const dd = d.getDate().toString().padStart(2, '0')
  const mo = (d.getMonth() + 1).toString().padStart(2, '0')
  return `${hh}:${mm} ${dd}.${mo}`
}

function checkIsRevealed(revealAt: string | null, status?: string | null): boolean {
  if (status === 'revealed') return true
  if (!revealAt) return true
  return new Date(revealAt) <= new Date()
}

// ---- Стили карточки фото ------------------------------------------------

const cardS: Record<string, CSSProperties> = {
  wrap: {
    aspectRatio: '3/4',
    background: '#1c1b1b',
    borderRadius: 8,
    overflow: 'hidden',
    cursor: 'pointer',
    position: 'relative',
    border: '1px solid #333232',
    transition: 'transform 0.15s',
  },
  wrapMine: {
    border: '2px solid rgba(212,168,83,0.5)',
  },
  skeleton: {
    width: '100%',
    height: '100%',
    background: '#242323',
    position: 'absolute',
    inset: 0,
    overflow: 'hidden',
  },
  skeletonShimmer: {
    width: '60%',
    height: '100%',
    background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.05), transparent)',
    animation: 'shimmer 1.4s infinite',
  },
  errorPlaceholder: {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#5a5755',
    background: '#1c1b1b',
  },
  img: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    display: 'block',
  },
  mineBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: '#d4a853',
  },
}

// ---- Карточка фото -------------------------------------------------------

interface PhotoCardProps {
  photo: PhotoRow
  myGuestId: string
  onClick: () => void
}

function PhotoCard({ photo, myGuestId, onClick }: PhotoCardProps) {
  const [src, setSrc] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [imgError, setImgError] = useState(false)
  const isMine = photo.guest_id === myGuestId

  useEffect(() => {
    let cancelled = false
    getPhotoUrl(photo.id).then(result => {
      if (cancelled) return
      if (result.ok) {
        setSrc(result.url)
      } else {
        setImgError(true)
      }
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [photo.id])

  return (
    <div
      style={{ ...cardS.wrap, ...(isMine ? cardS.wrapMine : {}) }}
      onClick={onClick}
      role="button"
      tabIndex={0}
      aria-label="Увеличить фото"
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') onClick() }}
    >
      {loading && (
        <div style={cardS.skeleton} aria-hidden="true">
          <div style={cardS.skeletonShimmer} />
        </div>
      )}
      {!loading && imgError && (
        <div style={cardS.errorPlaceholder}>
          <span style={{ fontSize: '1.2rem' }}>!</span>
        </div>
      )}
      {!loading && !imgError && src && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={isMine ? 'Мой кадр' : 'Кадр участника'}
          style={cardS.img}
          loading="lazy"
        />
      )}
      {isMine && <div style={cardS.mineBadge} aria-label="Мой кадр" />}
    </div>
  )
}

// ---- Лайтбокс -----------------------------------------------------------

const lbS: Record<string, CSSProperties> = {
  backdrop: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.92)',
    zIndex: 1000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  closeBtn: {
    position: 'absolute',
    top: 16,
    right: 20,
    background: 'none',
    border: 'none',
    color: '#f0ede8',
    fontSize: '2rem',
    lineHeight: 1,
    cursor: 'pointer',
    padding: '8px 12px',
    zIndex: 10,
  },
  img: {
    maxWidth: '100%',
    maxHeight: '90dvh',
    borderRadius: 8,
    boxShadow: '0 8px 40px rgba(0,0,0,0.6)',
    objectFit: 'contain',
  },
  spinner: {
    width: 36,
    height: 36,
    border: '3px solid rgba(212,168,83,0.3)',
    borderTopColor: '#d4a853',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },
}

interface LightboxProps {
  photoId: string
  onClose: () => void
}

function Lightbox({ photoId, onClose }: LightboxProps) {
  const [src, setSrc] = useState<string | null>(null)

  useEffect(() => {
    getPhotoUrl(photoId).then(result => {
      if (result.ok) setSrc(result.url)
    })
  }, [photoId])

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  return (
    <div
      style={lbS.backdrop}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Просмотр фото"
    >
      <button style={lbS.closeBtn} onClick={onClose} aria-label="Закрыть">×</button>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt="Просмотр кадра"
          style={lbS.img}
          onClick={e => e.stopPropagation()}
        />
      ) : (
        <div style={lbS.spinner} />
      )}
    </div>
  )
}

// ---- Стили страницы -----------------------------------------------------

const PS: Record<string, CSSProperties> = {
  page: {
    minHeight: '100dvh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    background: '#111010',
    color: '#f0ede8',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, Arial, sans-serif',
    paddingBottom: 40,
  },
  header: {
    width: '100%',
    maxWidth: 480,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px 16px 8px',
  },
  inner: {
    width: '100%',
    maxWidth: 480,
    padding: '0 16px',
    flex: 1,
  },
  brand: {
    fontSize: 13,
    letterSpacing: '0.18em',
    textTransform: 'uppercase',
    color: '#d4a853',
    fontWeight: 600,
  },
  title: {
    fontSize: '1.5rem',
    fontWeight: 700,
    marginBottom: 20,
    marginTop: 8,
    color: '#f0ede8',
  },
  card: {
    width: '100%',
    maxWidth: 480,
    background: '#1c1b1b',
    border: '1px solid #333232',
    borderRadius: 16,
    padding: '32px 24px',
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
    margin: '40px 16px',
  },
  tabs: {
    display: 'flex',
    gap: 8,
    marginBottom: 20,
  },
  tab: {
    flex: 1,
    padding: '10px 16px',
    background: 'transparent',
    border: '1px solid #333232',
    borderRadius: 8,
    color: '#8a8580',
    fontSize: '0.875rem',
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.15s',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    fontFamily: 'inherit',
  },
  tabActive: {
    background: 'rgba(212,168,83,0.12)',
    borderColor: 'rgba(212,168,83,0.4)',
    color: '#d4a853',
    fontWeight: 600,
    border: '1px solid rgba(212,168,83,0.4)',
  },
  tabBadge: {
    background: 'rgba(212,168,83,0.2)',
    color: '#d4a853',
    borderRadius: 999,
    padding: '1px 7px',
    fontSize: '0.75rem',
    fontWeight: 600,
  },
  revealBanner: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 14,
    background: 'rgba(212,168,83,0.08)',
    border: '1px solid rgba(212,168,83,0.25)',
    borderRadius: 10,
    padding: '14px 16px',
    color: '#d4a853',
    fontSize: '0.9rem',
    marginBottom: 20,
    lineHeight: '1.4',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 4,
  },
  centered: {
    display: 'flex',
    justifyContent: 'center',
    padding: '40px 0',
  },
  spinnerDiv: {
    width: 32,
    height: 32,
    border: '3px solid rgba(212,168,83,0.3)',
    borderTopColor: '#d4a853',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },
  errorMsg: {
    background: 'rgba(192,57,43,0.12)',
    border: '1px solid rgba(192,57,43,0.3)',
    borderRadius: 10,
    padding: '14px 16px',
    color: '#e57373',
    fontSize: '0.875rem',
    marginBottom: 16,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  retryBtn: {
    background: 'transparent',
    border: '1px solid rgba(192,57,43,0.4)',
    color: '#e57373',
    borderRadius: 6,
    padding: '6px 12px',
    fontSize: '0.8rem',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    fontFamily: 'inherit',
  },
  emptyState: {
    textAlign: 'center',
    color: '#5a5755',
    fontSize: '0.9rem',
    padding: '40px 16px',
    lineHeight: '1.6',
  },
  nav: {
    display: 'flex',
    gap: 24,
    padding: '16px',
    justifyContent: 'center',
  },
  navLink: {
    color: '#8a8580',
    fontSize: '0.85rem',
    textDecoration: 'none',
  },
  btnPrimary: {
    display: 'block',
    padding: '14px 20px',
    background: '#d4a853',
    color: '#111010',
    borderRadius: 10,
    fontSize: '0.95rem',
    fontWeight: 700,
    textAlign: 'center',
    textDecoration: 'none',
    marginTop: 8,
  },
  btnPrimarySmall: {
    padding: '8px 16px',
    background: '#d4a853',
    color: '#111010',
    borderRadius: 8,
    fontSize: '0.85rem',
    fontWeight: 700,
    textDecoration: 'none',
  },
  mutedText: {
    color: '#8a8580',
    fontSize: '0.875rem',
    lineHeight: '1.5',
  },
}

// ---- Запрос актуальных данных события -----------------------------------

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

interface PublicEventData {
  title: string
  camera_style: string
  status: string
  reveal_at: string | null
  starts_at: string | null
  cover_url: string | null
}

async function fetchPublicEvent(shortCode: string): Promise<PublicEventData | null> {
  try {
    const response = await fetch(
      `${SUPABASE_URL}/functions/v1/public-event?short_code=${encodeURIComponent(shortCode)}`,
      {
        headers: {
          'apikey': SUPABASE_ANON_KEY,
        },
      },
    )
    if (!response.ok) return null
    const data = await response.json() as PublicEventData
    return data
  } catch {
    return null
  }
}

// ---- Главный компонент ---------------------------------------------------

export default function GalleryPage({ params }: Props) {
  const { code } = use(params)

  const [session, setSession] = useState<GuestSession | null>(null)
  const [sessionLoaded, setSessionLoaded] = useState(false)

  // reveal_at/status — приоритет серверного значения, fallback на сессию
  const [liveRevealAt, setLiveRevealAt] = useState<string | null | undefined>(undefined)
  const [liveStatus, setLiveStatus] = useState<string | null | undefined>(undefined)

  const [activeTab, setActiveTab] = useState<GalleryTab>('mine')
  const [myPhotos, setMyPhotos] = useState<PhotoRow[]>([])
  const [allPhotos, setAllPhotos] = useState<PhotoRow[]>([])
  const [loadingMine, setLoadingMine] = useState(false)
  const [loadingAll, setLoadingAll] = useState(false)
  const [errorMine, setErrorMine] = useState<string | null>(null)
  const [errorAll, setErrorAll] = useState<string | null>(null)
  const [lightboxId, setLightboxId] = useState<string | null>(null)

  // ---- Сессия -----------------------------------------------------------

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(GUEST_SESSION_KEY)
      if (raw) setSession(JSON.parse(raw) as GuestSession)
    } catch {}
    setSessionLoaded(true)
  }, [])

  // ---- Получаем актуальный reveal_at/status с сервера при монтировании --

  useEffect(() => {
    if (!session?.short_code) return
    fetchPublicEvent(session.short_code).then(data => {
      if (data) {
        setLiveRevealAt(data.reveal_at)
        setLiveStatus(data.status)
      } else {
        // Fallback: используем значение из сессии
        setLiveRevealAt(session.reveal_at)
        setLiveStatus(null)
      }
    })
  }, [session])

  // ---- Загрузка кадров --------------------------------------------------

  const loadMine = useCallback(async (sess: GuestSession) => {
    setLoadingMine(true)
    setErrorMine(null)
    const result = await listPhotos(sess.event_id, sess.guest_id)
    setLoadingMine(false)
    if (result.ok) {
      setMyPhotos(result.photos)
    } else {
      setErrorMine(result.message)
    }
  }, [])

  const loadAll = useCallback(async (sess: GuestSession) => {
    setLoadingAll(true)
    setErrorAll(null)
    const result = await listPhotos(sess.event_id)
    setLoadingAll(false)
    if (result.ok) {
      setAllPhotos(result.photos)
    } else {
      setErrorAll(result.message)
    }
  }, [])

  useEffect(() => {
    if (!session) return
    loadMine(session)
    loadAll(session)
  }, [session, loadMine, loadAll])

  // ---- Рендер -----------------------------------------------------------

  if (!sessionLoaded) {
    return (
      <main style={PS.page}>
        <p style={{ color: '#5a5755', marginTop: 40 }}>Загрузка...</p>
      </main>
    )
  }

  if (!session) {
    return (
      <main style={PS.page}>
        <div style={PS.card}>
          <div style={PS.brand}>Кадр</div>
          <h2 style={{ color: '#f0ede8', marginBottom: 12 }}>Сессия не найдена</h2>
          <p style={PS.mutedText}>Войдите через ссылку события.</p>
          <Link href={`/j/${code}/join`} style={PS.btnPrimary}>
            Войти
          </Link>
        </div>
      </main>
    )
  }

  // Константа с уже проверенной сессией — для безопасного использования в замыканиях
  const activeSession: GuestSession = session

  // Берём reveal_at из серверного ответа; если ещё не загрузился — из сессии (undefined → null)
  const effectiveRevealAt = liveRevealAt !== undefined ? liveRevealAt : activeSession.reveal_at
  const effectiveStatus = liveStatus !== undefined ? liveStatus : null

  const revealed = checkIsRevealed(effectiveRevealAt, effectiveStatus)
  const revealLabel = effectiveRevealAt && !revealed
    ? formatRevealTime(effectiveRevealAt)
    : null

  const currentPhotos = activeTab === 'mine' ? myPhotos : allPhotos
  const currentLoading = activeTab === 'mine' ? loadingMine : loadingAll
  const currentError = activeTab === 'mine' ? errorMine : errorAll

  // При обновлении также обновляем данные события с сервера
  function handleRefresh() {
    if (activeSession.short_code) {
      fetchPublicEvent(activeSession.short_code).then(data => {
        if (data) {
          setLiveRevealAt(data.reveal_at)
          setLiveStatus(data.status)
        }
      })
    }
    if (activeTab === 'mine') loadMine(activeSession)
    else loadAll(activeSession)
  }

  return (
    <main style={PS.page}>
      {lightboxId && (
        <Lightbox photoId={lightboxId} onClose={() => setLightboxId(null)} />
      )}

      {/* Анимации для skeleton shimmer — spin уже в globals.css */}
      <style>{`
        @keyframes shimmer {
          0%,100% { transform: translateX(-150%); }
          50% { transform: translateX(150%); }
        }
      `}</style>

      {/* Шапка */}
      <div style={PS.header}>
        <span style={PS.brand}>Кадр</span>
        <Link href={`/j/${code}/camera`} style={PS.btnPrimarySmall}>
          Снять ещё
        </Link>
      </div>

      <div style={PS.inner}>
        <h1 style={PS.title}>Галерея</h1>

        {/* Табы */}
        <div style={PS.tabs}>
          <button
            style={{ ...PS.tab, ...(activeTab === 'mine' ? PS.tabActive : {}) }}
            onClick={() => setActiveTab('mine')}
          >
            Мои кадры
            {myPhotos.length > 0 && (
              <span style={PS.tabBadge}>{myPhotos.length}</span>
            )}
          </button>
          <button
            style={{ ...PS.tab, ...(activeTab === 'all' ? PS.tabActive : {}) }}
            onClick={() => setActiveTab('all')}
          >
            Общая галерея
            {allPhotos.length > 0 && (
              <span style={PS.tabBadge}>{allPhotos.length}</span>
            )}
          </button>
        </div>

        {/* Плашка проявки */}
        {activeTab === 'all' && !revealed && revealLabel && (
          <div style={PS.revealBanner} role="status">
            <span style={{ fontSize: '1.2rem' }}>[ ]</span>
            <div>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>
                Фото проявятся в {revealLabel}
              </div>
              <div style={{ fontSize: '0.85rem', color: '#8a8580' }}>
                До этого момента вы видите только свои кадры
              </div>
            </div>
          </div>
        )}

        {/* Загрузка */}
        {currentLoading && (
          <div style={PS.centered}>
            <div style={PS.spinnerDiv} />
          </div>
        )}

        {/* Ошибка */}
        {!currentLoading && currentError && (
          <div style={PS.errorMsg} role="alert">
            <span>{currentError}</span>
            <button
              style={PS.retryBtn}
              onClick={handleRefresh}
            >
              Обновить
            </button>
          </div>
        )}

        {/* Пустое состояние */}
        {!currentLoading && !currentError && currentPhotos.length === 0 && (
          <div style={PS.emptyState}>
            {activeTab === 'mine'
              ? 'Вы ещё не сделали ни одного кадра. Нажмите «Снять ещё»!'
              : revealed
              ? 'В галерее пока нет фотографий.'
              : 'Ваши кадры появятся здесь. Чужие — после проявки.'}
          </div>
        )}

        {/* Сетка фото */}
        {!currentLoading && !currentError && currentPhotos.length > 0 && (
          <div style={PS.grid}>
            {currentPhotos.map(photo => (
              <PhotoCard
                key={photo.id}
                photo={photo}
                myGuestId={activeSession.guest_id}
                onClick={() => setLightboxId(photo.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Навигация */}
      <div style={PS.nav}>
        <Link href={`/j/${code}/camera`} style={PS.navLink}>
          Камера
        </Link>
        <Link href={`/j/${code}`} style={PS.navLink}>
          К событию
        </Link>
      </div>
    </main>
  )
}
