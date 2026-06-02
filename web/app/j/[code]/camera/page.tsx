'use client'

/**
 * Экран камеры — SPECIFICATION §8.2
 * Реальная камера: getUserMedia, плёночный фильтр (applyFilter), загрузка кадров.
 *
 * Инварианты:
 * - Фильтр применяется НА КЛИЕНТЕ до загрузки; оригинал не отправляется.
 * - Нет распознавания/детекции лиц — только пиксельная обработка.
 * - Фото только через подписанные URL.
 * - Нет зарубежних сервисов/трекеров.
 * - getUserMedia и navigator — только в useEffect/обработчиках (не SSR).
 */

import type { CSSProperties } from 'react'
import { useState, useEffect, useRef, useCallback, use } from 'react'
import Link from 'next/link'
import type { GuestSession, CameraStyle } from '@/lib/types'
import { GUEST_SESSION_KEY } from '@/lib/types'
import { applyFilter, captureVideoFrame } from '@/lib/filters'
import { requestUploadUrl, uploadBlob, confirmUpload } from '@/lib/photos'

interface Props {
  params: Promise<{ code: string }>
}

const STYLE_LABELS: Record<CameraStyle, string> = {
  film35:  'Плёнка 35мм',
  vintage: 'Винтаж',
  bw:      'Ч/Б',
  summer:  'Лето',
}

type UploadPhase =
  | 'idle'
  | 'capturing'    // захват кадра + применение фильтра
  | 'preview'      // показываем предпросмотр кадра с кнопками «Загрузить» / «Переснять»
  | 'uploading'    // PUT → confirm

/** Форматирует shots_left для показа пользователю. */
function formatShots(n: number): string {
  if (n >= 1_000_000) return '∞'
  return n.toString()
}

function getShotsWord(n: number): string {
  if (n >= 1_000_000) return 'без лимита'
  if (n === 0) return 'кадров не осталось'
  const last = n % 10
  const lastTwo = n % 100
  if (lastTwo >= 11 && lastTwo <= 19) return 'кадров осталось'
  if (last === 1) return 'кадр остался'
  if (last >= 2 && last <= 4) return 'кадра осталось'
  return 'кадров осталось'
}

// ---- Стили ---------------------------------------------------------------
// Используют @keyframes spin из globals.css

const S: Record<string, CSSProperties> = {
  page: {
    minHeight: '100dvh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    background: '#111010',
    color: '#f0ede8',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, Arial, sans-serif',
    paddingBottom: 32,
    position: 'relative',
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
    gap: 20,
    margin: '40px 16px',
  },
  header: {
    width: '100%',
    maxWidth: 480,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px 16px 8px',
  },
  headerRight: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: 2,
  },
  brand: {
    fontSize: 13,
    letterSpacing: '0.18em',
    textTransform: 'uppercase',
    color: '#d4a853',
    fontWeight: 600,
  },
  styleLabel: {
    fontSize: '0.8rem',
    color: '#d4a853',
    letterSpacing: '0.05em',
  },
  shotsCounter: {
    fontSize: '0.78rem',
    color: '#8a8580',
  },
  shotsCounterEmpty: {
    color: '#c0392b',
  },
  viewfinderWrap: {
    width: '100%',
    maxWidth: 480,
    aspectRatio: '3/4',
    background: '#000',
    position: 'relative',
    overflow: 'hidden',
    borderRadius: 12,
  },
  video: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  previewImg: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    display: 'block',
  },
  overlay: {
    position: 'absolute',
    inset: 0,
    background: 'rgba(0,0,0,0.6)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  spinnerDiv: {
    width: 36,
    height: 36,
    border: '3px solid rgba(212,168,83,0.3)',
    borderTopColor: '#d4a853',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },
  cameraError: {
    position: 'absolute',
    inset: 0,
    background: 'rgba(0,0,0,0.8)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    color: '#f0ede8',
    fontSize: '0.9rem',
    textAlign: 'center',
    zIndex: 20,
  },
  corner: {
    position: 'absolute',
    width: 20,
    height: 20,
    borderColor: 'rgba(212,168,83,0.7)',
    borderStyle: 'solid',
    borderWidth: 0,
  },
  limitBanner: {
    position: 'absolute',
    bottom: 16,
    left: '50%',
    transform: 'translateX(-50%)',
    background: 'rgba(192,57,43,0.9)',
    color: '#fff',
    borderRadius: 8,
    padding: '10px 20px',
    fontSize: '0.85rem',
    fontWeight: 600,
    whiteSpace: 'nowrap',
    zIndex: 5,
  },
  errorMsg: {
    width: '100%',
    maxWidth: 480,
    background: 'rgba(192,57,43,0.12)',
    border: '1px solid rgba(192,57,43,0.3)',
    borderRadius: 10,
    padding: '12px 16px',
    color: '#e57373',
    fontSize: '0.875rem',
    lineHeight: '1.4',
    margin: '10px 16px 0',
  },
  controls: {
    width: '100%',
    maxWidth: 480,
    display: 'flex',
    gap: 12,
    padding: '16px 16px 0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  shootBtn: {
    width: 72,
    height: 72,
    borderRadius: '50%',
    border: '4px solid #d4a853',
    background: 'transparent',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'transform 0.1s, opacity 0.15s',
    WebkitTapHighlightColor: 'transparent',
  },
  shootBtnDisabled: {
    opacity: 0.35,
    cursor: 'not-allowed',
    borderColor: '#5a5755',
  },
  shootBtnInner: {
    width: 52,
    height: 52,
    borderRadius: '50%',
    background: '#d4a853',
    display: 'block',
  },
  btnPrimary: {
    flex: 1,
    display: 'block',
    padding: '16px 24px',
    background: '#d4a853',
    color: '#111010',
    borderRadius: 10,
    fontSize: '1rem',
    fontWeight: 700,
    textAlign: 'center',
    border: 'none',
    cursor: 'pointer',
    letterSpacing: '0.02em',
    transition: 'opacity 0.15s',
    textDecoration: 'none',
  },
  btnSecondary: {
    flex: 1,
    display: 'block',
    padding: '16px 24px',
    background: 'transparent',
    color: '#d4a853',
    borderRadius: 10,
    fontSize: '1rem',
    fontWeight: 600,
    textAlign: 'center',
    border: '1px solid #d4a853',
    cursor: 'pointer',
    transition: 'opacity 0.15s',
  },
  btnSecondarySmall: {
    padding: '10px 20px',
    background: 'transparent',
    color: '#d4a853',
    borderRadius: 8,
    fontSize: '0.9rem',
    fontWeight: 600,
    border: '1px solid #d4a853',
    cursor: 'pointer',
  },
  mutedText: {
    color: '#8a8580',
    fontSize: '0.875rem',
    lineHeight: '1.5',
    marginBottom: 20,
  },
  dimText: {
    color: '#5a5755',
    marginTop: 40,
  },
  nav: {
    display: 'flex',
    gap: 24,
    padding: '16px 16px 0',
    justifyContent: 'center',
  },
  navLink: {
    color: '#8a8580',
    fontSize: '0.85rem',
    textDecoration: 'none',
    letterSpacing: '0.02em',
  },
  toast: {
    position: 'fixed',
    top: 24,
    left: '50%',
    transform: 'translateX(-50%)',
    background: '#4a9e6b',
    color: '#fff',
    borderRadius: 8,
    padding: '12px 24px',
    fontWeight: 600,
    fontSize: '0.9rem',
    zIndex: 1000,
    boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
    whiteSpace: 'nowrap',
  },
}

// ---- Компонент -----------------------------------------------------------

export default function CameraPage({ params }: Props) {
  const { code } = use(params)

  // Сессия гостя
  const [session, setSession] = useState<GuestSession | null>(null)
  const [sessionLoaded, setSessionLoaded] = useState(false)

  // Камера
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [cameraReady, setCameraReady] = useState(false)

  // Состояние съёмки
  const [phase, setPhase] = useState<UploadPhase>('idle')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const previewBlobRef = useRef<Blob | null>(null)
  const pendingUploadRef = useRef<{
    photo_id: string
    storage_path: string
    token: string
  } | null>(null)

  const [uploadError, setUploadError] = useState<string | null>(null)
  const [toastMsg, setToastMsg] = useState<string | null>(null)
  const [shotsExhausted, setShotsExhausted] = useState(false)

  // ---- Загрузка сессии --------------------------------------------------

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(GUEST_SESSION_KEY)
      if (raw) {
        const s = JSON.parse(raw) as GuestSession
        setSession(s)
        setShotsExhausted(s.shots_left === 0)
      }
    } catch {
      // sessionStorage недоступен
    }
    setSessionLoaded(true)
  }, [])

  // ---- Инициализация камеры ---------------------------------------------

  const startCamera = useCallback(async () => {
    setCameraError(null)
    setCameraReady(false)

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Камера не поддерживается этим браузером.')
      return
    }

    let stream: MediaStream
    try {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        })
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        })
      }
    } catch (err) {
      const e = err as { name?: string }
      if (e?.name === 'NotAllowedError' || e?.name === 'PermissionDeniedError') {
        setCameraError(
          'Доступ к камере запрещён. Разрешите доступ в настройках браузера и нажмите «Повторить».'
        )
      } else if (e?.name === 'NotFoundError' || e?.name === 'DevicesNotFoundError') {
        setCameraError('Камера не найдена на устройстве.')
      } else if (e?.name === 'NotReadableError' || e?.name === 'TrackStartError') {
        setCameraError('Камера занята другим приложением. Закройте его и нажмите «Повторить».')
      } else {
        setCameraError('Не удалось запустить камеру. Попробуйте ещё раз.')
      }
      return
    }

    streamRef.current = stream

    if (videoRef.current) {
      videoRef.current.srcObject = stream
      videoRef.current.onloadedmetadata = () => {
        videoRef.current?.play().catch(() => {})
        setCameraReady(true)
      }
    }
  }, [])

  useEffect(() => {
    if (!sessionLoaded || !session) return
    startCamera()
  }, [sessionLoaded, session, startCamera])

  // Очистка стрима при размонтировании
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
  }, [])

  // Очистка preview URL при размонтировании
  const latestPreviewUrl = useRef<string | null>(null)
  useEffect(() => {
    latestPreviewUrl.current = previewUrl
  })
  useEffect(() => {
    return () => {
      if (latestPreviewUrl.current) URL.revokeObjectURL(latestPreviewUrl.current)
    }
  }, [])

  // ---- Тост ---------------------------------------------------------------

  function showToast(msg: string) {
    setToastMsg(msg)
    setTimeout(() => setToastMsg(null), 3000)
  }

  // ---- Очистка preview ---------------------------------------------------

  function clearPreview(pUrl: string | null) {
    if (pUrl) URL.revokeObjectURL(pUrl)
    setPreviewUrl(null)
    previewBlobRef.current = null
    pendingUploadRef.current = null
  }

  // ---- Захват кадра -------------------------------------------------------

  async function handleCapture() {
    if (!session || !videoRef.current || !cameraReady) return
    if (shotsExhausted) return
    if (phase !== 'idle') return

    setPhase('capturing')
    setUploadError(null)

    // Очищаем предыдущий preview если был
    const prevUrl = latestPreviewUrl.current
    if (prevUrl) {
      URL.revokeObjectURL(prevUrl)
      setPreviewUrl(null)
    }

    let pUrl: string | null = null

    try {
      const rawCanvas = captureVideoFrame(videoRef.current)

      // Применяем фильтр (ИНВАРИАНТ: до загрузки, оригинал не уходит)
      const filteredBlob = await applyFilter(rawCanvas, session.camera_style)

      pUrl = URL.createObjectURL(filteredBlob)
      setPreviewUrl(pUrl)
      previewBlobRef.current = filteredBlob

      // Запрашиваем upload URL
      const w = rawCanvas.width
      const h = rawCanvas.height
      const urlResult = await requestUploadUrl(session.event_id, session.camera_style, w, h)

      if (!urlResult.ok) {
        if (urlResult.code === 'shot_limit_reached') {
          setShotsExhausted(true)
          const updated: GuestSession = { ...session, shots_left: 0 }
          setSession(updated)
          try { sessionStorage.setItem(GUEST_SESSION_KEY, JSON.stringify(updated)) } catch {}
          setUploadError('Вы сняли все доступные кадры. Спасибо за участие!')
          setPhase('idle')
          clearPreview(pUrl)
          return
        }
        if (urlResult.code === 'event_closed') {
          setUploadError('Событие закрыто. Съёмка завершена.')
          setPhase('idle')
          clearPreview(pUrl)
          return
        }
        setUploadError(urlResult.message)
        setPhase('idle')
        clearPreview(pUrl)
        return
      }

      pendingUploadRef.current = {
        photo_id: urlResult.photo_id,
        storage_path: urlResult.storage_path,
        token: urlResult.token,
      }

      setPhase('preview')
    } catch {
      setUploadError('Ошибка при обработке кадра. Попробуйте ещё раз.')
      setPhase('idle')
      clearPreview(pUrl)
    }
  }

  // ---- Загрузка кадра (после предпросмотра) -------------------------------

  async function handleUpload() {
    if (!session || !previewBlobRef.current || !pendingUploadRef.current) return
    if (phase !== 'preview') return

    setPhase('uploading')
    setUploadError(null)

    const { photo_id, storage_path, token } = pendingUploadRef.current
    const blob = previewBlobRef.current
    const currentPUrl = previewUrl

    const uploadResult = await uploadBlob(storage_path, token, blob)
    if (!uploadResult.ok) {
      setUploadError(uploadResult.message)
      setPhase('preview')
      return
    }

    const confirmResult = await confirmUpload(photo_id)
    if (!confirmResult.ok) {
      setUploadError('Кадр загружен, но подтверждение не прошло. Он появится позже.')
    }

    // Уменьшаем счётчик
    const newShotsLeft = session.shots_left >= 1_000_000
      ? session.shots_left
      : Math.max(0, session.shots_left - 1)

    const updated: GuestSession = { ...session, shots_left: newShotsLeft }
    setSession(updated)
    setShotsExhausted(newShotsLeft === 0)
    try { sessionStorage.setItem(GUEST_SESSION_KEY, JSON.stringify(updated)) } catch {}

    setPreviewUrl(null)
    previewBlobRef.current = null
    pendingUploadRef.current = null
    if (currentPUrl) URL.revokeObjectURL(currentPUrl)

    setPhase('idle')
    if (confirmResult.ok) showToast('Кадр загружен!')
  }

  // ---- Переснять ----------------------------------------------------------

  function handleRetake() {
    const currentPUrl = previewUrl
    setPreviewUrl(null)
    previewBlobRef.current = null
    pendingUploadRef.current = null
    setUploadError(null)
    setPhase('idle')
    if (currentPUrl) URL.revokeObjectURL(currentPUrl)
  }

  // ---- Рендер -------------------------------------------------------------

  if (!sessionLoaded) {
    return (
      <main style={S.page}>
        <p style={S.dimText}>Загрузка...</p>
      </main>
    )
  }

  if (!session) {
    return (
      <main style={S.page}>
        <div style={S.card}>
          <div style={S.brand}>Кадр</div>
          <h2 style={{ marginBottom: 12, color: '#f0ede8' }}>Сессия не найдена</h2>
          <p style={S.mutedText}>
            Сессия истекла или вы открыли ссылку в другом браузере. Войдите заново.
          </p>
          <Link href={`/j/${code}/join`} style={S.btnPrimary}>
            Войти снова
          </Link>
        </div>
      </main>
    )
  }

  const isCapturing = phase === 'capturing'
  const isPreview = phase === 'preview'
  const isUploading = phase === 'uploading'
  const canShoot = cameraReady && !shotsExhausted && phase === 'idle'

  return (
    <main style={S.page}>
      {/* Тост */}
      {toastMsg && (
        <div style={S.toast} role="status" aria-live="polite">
          {toastMsg}
        </div>
      )}

      {/* Шапка */}
      <div style={S.header}>
        <span style={S.brand}>Кадр</span>
        <div style={S.headerRight}>
          <span style={S.styleLabel}>{STYLE_LABELS[session.camera_style]}</span>
          <span style={{ ...S.shotsCounter, ...(shotsExhausted ? S.shotsCounterEmpty : {}) }}>
            {formatShots(session.shots_left)} {getShotsWord(session.shots_left)}
          </span>
        </div>
      </div>

      {/* Видоискатель */}
      <div style={S.viewfinderWrap}>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          style={{ ...S.video, display: isPreview || isUploading ? 'none' : 'block' }}
        />

        {/* Предпросмотр */}
        {(isPreview || isUploading) && previewUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previewUrl} alt="Предпросмотр кадра" style={S.previewImg} />
        )}

        {/* Ошибка камеры */}
        {cameraError && !isPreview && !isUploading && (
          <div style={S.cameraError}>
            <p style={{ marginBottom: 16, lineHeight: '1.5' }}>{cameraError}</p>
            <button onClick={startCamera} style={S.btnSecondarySmall}>
              Повторить
            </button>
          </div>
        )}

        {/* Оверлей — захват / загрузка */}
        {(isCapturing || isUploading) && (
          <div style={S.overlay}>
            <div style={S.spinnerDiv} />
            <span style={{ marginTop: 12, color: '#f0ede8', fontSize: '0.9rem' }}>
              {isCapturing ? 'Обработка...' : 'Загрузка...'}
            </span>
          </div>
        )}

        {/* Декоративные уголки видоискателя */}
        {!isPreview && !isUploading && cameraReady && !cameraError && (
          <>
            <div style={{ ...S.corner, top: 12, left: 12, borderTopWidth: 3, borderLeftWidth: 3 }} />
            <div style={{ ...S.corner, top: 12, right: 12, borderTopWidth: 3, borderRightWidth: 3 }} />
            <div style={{ ...S.corner, bottom: 12, left: 12, borderBottomWidth: 3, borderLeftWidth: 3 }} />
            <div style={{ ...S.corner, bottom: 12, right: 12, borderBottomWidth: 3, borderRightWidth: 3 }} />
          </>
        )}

        {/* Плашка лимита */}
        {shotsExhausted && !cameraError && !isPreview && (
          <div style={S.limitBanner}>
            Кадры закончились. Спасибо за участие!
          </div>
        )}
      </div>

      {/* Ошибка загрузки */}
      {uploadError && (
        <div style={S.errorMsg} role="alert">
          {uploadError}
        </div>
      )}

      {/* Кнопки */}
      <div style={S.controls}>
        {isPreview ? (
          <>
            <button onClick={handleRetake} style={S.btnSecondary} disabled={isUploading}>
              Переснять
            </button>
            <button
              onClick={handleUpload}
              style={{ ...S.btnPrimary, ...(isUploading ? { opacity: 0.5, cursor: 'not-allowed' } : {}) }}
              disabled={isUploading}
            >
              {isUploading ? 'Загрузка...' : 'Загрузить'}
            </button>
          </>
        ) : (
          <button
            onClick={handleCapture}
            style={{ ...S.shootBtn, ...(canShoot ? {} : S.shootBtnDisabled) }}
            disabled={!canShoot}
            aria-disabled={!canShoot}
            title={
              shotsExhausted
                ? 'Кадры закончились'
                : !cameraReady
                ? 'Камера инициализируется...'
                : 'Снять кадр'
            }
          >
            <span style={S.shootBtnInner} />
          </button>
        )}
      </div>

      {/* Навигация */}
      <div style={S.nav}>
        <Link href={`/j/${code}/gallery`} style={S.navLink}>
          Галерея
        </Link>
        <Link href={`/j/${code}`} style={S.navLink}>
          К событию
        </Link>
      </div>
    </main>
  )
}
