import { createClient } from '@supabase/supabase-js'

// Self-hosted Supabase — только РФ (инвариант 152-ФЗ)
// Значения берутся из NEXT_PUBLIC_ env — никаких хардкодов ключей в коде
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''

if (!supabaseUrl || !supabaseAnonKey) {
  // В dev/prod выбросит ошибку, в build-time — переменные должны быть заданы через .env.local
  console.error(
    '[Кадр] Не заданы NEXT_PUBLIC_SUPABASE_URL или NEXT_PUBLIC_SUPABASE_ANON_KEY. ' +
    'Скопируй .env.local.example в .env.local и заполни значения.'
  )
}

// Один клиент на всё приложение (browser-only).
// Явные дженерик-параметры <any, any, any> обрезают вывод тяжёлого типа PostgREST-
// клиента: без них TS на связке с цепочками .from().select() в lib/photos.ts может
// уходить в экспоненциальный вывод типов и вешать tsc/next build.
export const supabase = createClient<any, any, any>(supabaseUrl || 'http://localhost:54321', supabaseAnonKey || 'placeholder', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
})
