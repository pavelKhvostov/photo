'use client'

import { useState, FormEvent } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Корневой экран — /
 * Для тех, кто зашёл не по прямой ссылке события.
 * Основной сценарий: гость получает /j/<code> через QR или ссылку напрямую.
 */
export default function HomePage() {
  const router = useRouter()
  const [code, setCode] = useState('')
  const [error, setError] = useState('')

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const trimmed = code.trim().toLowerCase()
    if (!trimmed) {
      setError('Введите код события')
      return
    }
    // Базовая валидация: short_code = 6 символов base32 (SPECIFICATION §6.2)
    if (!/^[a-z2-7]{4,10}$/i.test(trimmed)) {
      setError('Код события состоит из букв и цифр, обычно 6 символов')
      return
    }
    setError('')
    router.push(`/j/${trimmed}`)
  }

  return (
    <main className="page" style={{ justifyContent: 'center' }}>
      <div className="card">
        <div className="app-brand">Кадр</div>

        <div className="film-strip">
          <span /><span /><span /><span /><span />
        </div>

        <div className="stack-lg">
          <div className="text-center">
            <h1 style={{ marginBottom: '12px' }}>Событийная камера</h1>
            <p className="text-muted">
              Снимайте на плёночную камеру вместе с друзьями —
              без установки приложения.
            </p>
          </div>

          <div
            className="info-banner"
            style={{ fontSize: '0.875rem' }}
          >
            Чтобы присоединиться, отсканируйте QR-код
            или откройте ссылку события
          </div>

          <div className="divider" style={{ margin: '0' }} />

          <form onSubmit={handleSubmit} className="stack-md">
            <div>
              <label className="field-label" htmlFor="code-input">
                Или введите код события вручную
              </label>
              <input
                id="code-input"
                className={`input-field${error ? ' error' : ''}`}
                type="text"
                inputMode="text"
                placeholder="k7p2qx"
                value={code}
                onChange={e => {
                  setCode(e.target.value)
                  setError('')
                }}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={10}
                aria-describedby={error ? 'code-error' : undefined}
              />
              {error && (
                <p
                  id="code-error"
                  style={{
                    color: 'var(--error)',
                    fontSize: '0.85rem',
                    marginTop: '6px',
                  }}
                  role="alert"
                >
                  {error}
                </p>
              )}
            </div>
            <button
              type="submit"
              className="btn-primary"
              disabled={!code.trim()}
            >
              Перейти к событию
            </button>
          </form>
        </div>
      </div>
    </main>
  )
}
