import Link from 'next/link'

export default function NotFound() {
  return (
    <main className="page" style={{ justifyContent: 'center' }}>
      <div className="card text-center">
        <div className="app-brand">Кадр</div>
        <div className="stack-lg">
          <div>
            <h1 style={{ marginBottom: '12px', fontSize: '3rem', color: 'var(--text-dim)' }}>
              404
            </h1>
            <h2 style={{ marginBottom: '8px' }}>Страница не найдена</h2>
            <p className="text-muted">
              Проверьте ссылку или отсканируйте QR-код события заново.
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
