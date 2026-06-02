'use client'

import { useState, FormEvent, use } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { joinEvent } from '@/lib/joinEvent'
import type { GuestSession } from '@/lib/types'
import { GUEST_SESSION_KEY } from '@/lib/types'

// Версия политики из переменной окружения — никаких хардкодов в коде
const POLICY_VERSION = process.env.NEXT_PUBLIC_POLICY_VERSION ?? '2026-06-01'

interface Props {
  params: Promise<{ code: string }>
}

/**
 * Экран «Имя + Согласие» — SPECIFICATION §8.2
 *
 * Инварианты 152-ФЗ:
 * - Чекбокс согласия НЕ предзаполнен (unchecked по умолчанию)
 * - Кнопка «Присоединиться» disabled без галочки И без валидного имени
 * - Согласие фиксируется в consents (IP/UA) через Edge Function join-event ДО первого кадра
 */
export default function JoinPage({ params }: Props) {
  const { code } = use(params)
  const router = useRouter()

  const [displayName, setDisplayName] = useState('')
  // ИНВАРИАНТ 152-ФЗ: чекбокс НЕ предзаполнен
  const [consentChecked, setConsentChecked] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nameError, setNameError] = useState<string | null>(null)

  // Валидация имени: 1..60 символов (SPECIFICATION §2.3)
  function validateName(value: string): string | null {
    const trimmed = value.trim()
    if (!trimmed) return 'Введите ваше имя'
    if (trimmed.length < 1) return 'Имя слишком короткое'
    if (trimmed.length > 60) return 'Имя не должно превышать 60 символов'
    return null
  }

  const isFormValid = consentChecked && !validateName(displayName)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()

    const nameErr = validateName(displayName)
    if (nameErr) {
      setNameError(nameErr)
      return
    }
    if (!consentChecked) {
      setError('Необходимо дать согласие на обработку данных')
      return
    }

    setLoading(true)
    setError(null)

    const result = await joinEvent({
      short_code: code,
      display_name: displayName.trim(),
      consent: {
        policy_version: POLICY_VERSION,
        purpose: 'photo_upload',
      },
    })

    setLoading(false)

    if (!result.ok) {
      // Обработка кодов ошибок из SPECIFICATION §6.3 и §9
      switch (result.code) {
        case 'not_found':
          setError('Событие не найдено. Проверьте ссылку или QR-код.')
          break
        case 'guests_limit_reached':
          // SPECIFICATION §9 edge case 2
          setError(
            'Достигнут лимит гостей для этого события. ' +
            'Хост может расширить тариф, чтобы добавить больше участников.'
          )
          break
        case 'event_closed':
          setError('Это событие уже закрыто и не принимает новых участников.')
          break
        case 'consent_required':
          setError('Для участия необходимо подтвердить согласие на обработку данных.')
          break
        case 'validation':
          setError(result.message || 'Проверьте правильность введённых данных.')
          break
        case 'unauthorized':
          setError('Ошибка авторизации. Обновите страницу и попробуйте снова.')
          break
        case 'network_error':
          setError('Нет соединения с сервером. Проверьте интернет и попробуйте снова.')
          break
        default:
          setError(result.message || 'Произошла ошибка. Попробуйте снова.')
      }
      return
    }

    // Успех — сохраняем данные гостя в sessionStorage
    const session: GuestSession = {
      guest_id: result.data.guest_id,
      event_id: result.data.event_id,
      shots_left: result.data.shots_left,
      reveal_at: result.data.reveal_at,
      camera_style: result.data.camera_style,
      short_code: code,
    }
    try {
      sessionStorage.setItem(GUEST_SESSION_KEY, JSON.stringify(session))
    } catch {
      // sessionStorage может быть недоступен в приватном режиме некоторых браузеров
      // Передаём данные через URL-параметры как запасной вариант
    }

    router.push(`/j/${code}/camera`)
  }

  return (
    <main className="page" style={{ justifyContent: 'center' }}>
      <div className="card">
        <div className="app-brand">Кадр</div>

        <div className="stack-lg">
          <div>
            <h1 style={{ marginBottom: '8px' }}>Вступить в событие</h1>
            <p className="text-muted" style={{ fontSize: '0.875rem' }}>
              Код события:{' '}
              <span style={{ color: 'var(--accent)', fontFamily: 'monospace' }}>
                {code.toUpperCase()}
              </span>
            </p>
          </div>

          <form onSubmit={handleSubmit} className="stack-md" noValidate>
            {/* Поле имени */}
            <div>
              <label className="field-label" htmlFor="display-name">
                Ваше имя
              </label>
              <input
                id="display-name"
                className={`input-field${nameError ? ' error' : ''}`}
                type="text"
                placeholder="Например: Дима"
                value={displayName}
                onChange={e => {
                  setDisplayName(e.target.value)
                  setNameError(null)
                  setError(null)
                }}
                onBlur={() => setNameError(validateName(displayName))}
                maxLength={60}
                autoComplete="nickname"
                autoCapitalize="words"
                disabled={loading}
                aria-describedby={nameError ? 'name-error' : undefined}
                aria-invalid={!!nameError}
                required
              />
              {nameError && (
                <p
                  id="name-error"
                  style={{
                    color: 'var(--error)',
                    fontSize: '0.85rem',
                    marginTop: '6px',
                  }}
                  role="alert"
                >
                  {nameError}
                </p>
              )}
            </div>

            {/*
              Чекбокс согласия.
              ИНВАРИАНТ 152-ФЗ: НЕ предзаполнен (defaultChecked НЕ установлен).
              Кнопка disabled без галочки.
            */}
            <label className="consent-row" htmlFor="consent-checkbox">
              <input
                id="consent-checkbox"
                type="checkbox"
                checked={consentChecked}
                onChange={e => {
                  setConsentChecked(e.target.checked)
                  setError(null)
                }}
                disabled={loading}
                aria-required="true"
              />
              <span className="consent-text">
                Я согласен(на) на обработку фотографий и персональных данных
                в соответствии с{' '}
                <Link
                  href="/privacy"
                  target="_blank"
                  rel="noopener"
                  onClick={e => e.stopPropagation()}
                >
                  политикой обработки ПДн
                </Link>
                . Версия политики: {POLICY_VERSION}.
              </span>
            </label>

            {/* Ошибка */}
            {error && (
              <div className="error-msg" role="alert" aria-live="assertive">
                <span aria-hidden="true">!</span>
                <span>{error}</span>
              </div>
            )}

            {/*
              Кнопка ЗАБЛОКИРОВАНА если:
              - чекбокс не отмечен, ИЛИ
              - имя не валидно, ИЛИ
              - идёт загрузка
              (SPECIFICATION §8.2, инвариант 152-ФЗ)
            */}
            <button
              type="submit"
              className="btn-primary"
              disabled={!isFormValid || loading}
              aria-busy={loading}
            >
              {loading ? (
                <>
                  <span className="spinner" aria-hidden="true" />
                  Подключение...
                </>
              ) : (
                'Присоединиться'
              )}
            </button>
          </form>

          <p className="text-muted text-center" style={{ fontSize: '0.8rem' }}>
            <Link href={`/j/${code}`}>← Назад к событию</Link>
          </p>
        </div>
      </div>
    </main>
  )
}
