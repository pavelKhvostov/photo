import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // PWA-ready: отключаем x-powered-by
  poweredByHeader: false,
  // Только системные шрифты, никакого внешнего CDN
  // Запрет на зарубежные домены в CSP будет добавлен при деплое
}

export default nextConfig
