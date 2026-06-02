import type { Metadata, Viewport } from 'next'
import './globals.css'

// ВАЖНО: никакого внешнего CDN для шрифтов (инвариант 152-ФЗ).
// Используем системные шрифты через CSS (font-family в globals.css).
// Никаких Google Fonts, никакого Firebase, никакого Vercel Analytics.

export const metadata: Metadata = {
  title: 'Кадр — событийная камера',
  description: 'Снимай на плёночную камеру без установки приложения. Кадры появятся в общей галерее после проявки.',
  // PWA manifest — добавить при необходимости
  // manifest: '/manifest.json',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,  // Запрет масштабирования для камеры
  userScalable: false,
  themeColor: '#111010',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    // lang="ru" — обязательно по ТЗ
    <html lang="ru">
      <head>
        {/*
          Никаких внешних скриптов, трекеров, Google Tag Manager, Firebase SDK.
          Аналитика — AppMetrica/Метрика (добавить при деплое в РФ).
        */}
      </head>
      <body>
        {children}
      </body>
    </html>
  )
}
