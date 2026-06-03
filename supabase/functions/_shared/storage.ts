// Storage-хелперы для Edge Functions «Кадр».
//
// toPublicUrl: на локалке Storage подписывает URL внутренним хостом Docker-сети
// (http://kong:8000), который НЕ резолвится из браузера. Подменяем origin на
// публичный, доступный клиенту. Путь и подпись (токен) не трогаем.
//
// Источник публичного origin (по приоритету):
//   1. PUBLIC_STORAGE_URL  — явный публичный домен Storage;
//   2. PUBLIC_SUPABASE_URL  — публичный домен Supabase;
//   3. fallback на localhost — ТОЛЬКО для локалки/дева.
//
// L1 (прод-фикс): раньше fallback на http://127.0.0.1:54321 срабатывал всегда при
// отсутствии env — на проде это давало битый localhost-URL. Теперь localhost
// применяется ТОЛЬКО когда мы НЕ в проде. Прод определяется по KADR_ENV=production.
// Если KADR_ENV=production и публичный origin не задан — это конфигурационная ошибка:
// логируем console.error и возвращаем исходный signedUrl КАК ЕСТЬ (не подменяем на
// localhost, чтобы не отдать заведомо нерабочую ссылку). Инвариант 152-ФЗ соблюдён:
// это всё ещё подписанный URL приватного бакета, просто с тем хостом, что выдал Storage.

const LOCAL_FALLBACK = "http://127.0.0.1:54321";

export function toPublicUrl(signedUrl: string): string {
  const publicBase = Deno.env.get("PUBLIC_STORAGE_URL") ??
    Deno.env.get("PUBLIC_SUPABASE_URL");

  if (!publicBase) {
    const isProd = Deno.env.get("KADR_ENV") === "production";
    if (isProd) {
      // Прод без публичного origin — конфигурационная ошибка. НЕ подменяем на
      // localhost. Отдаём исходный подписанный URL и сигналим в логи.
      console.error(
        "[storage.toPublicUrl] KADR_ENV=production, но PUBLIC_STORAGE_URL/" +
          "PUBLIC_SUPABASE_URL не заданы — возвращаю signedUrl без подмены origin. " +
          "Задайте PUBLIC_STORAGE_URL.",
      );
      return signedUrl;
    }
    // Локалка/дев: прежнее поведение — подмена на localhost.
    return rewriteOrigin(signedUrl, LOCAL_FALLBACK);
  }

  return rewriteOrigin(signedUrl, publicBase);
}

// Подменяет протокол+host (включая порт) URL на origin из base. Путь/query/токен —
// без изменений. При невалидном URL возвращает исходную строку.
function rewriteOrigin(signedUrl: string, base: string): string {
  try {
    const u = new URL(signedUrl);
    const pub = new URL(base);
    u.protocol = pub.protocol;
    u.host = pub.host; // host включает порт
    return u.toString();
  } catch {
    return signedUrl;
  }
}
