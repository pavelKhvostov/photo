// CORS-хелпер для Edge Functions «Кадр».
// Один источник заголовков для всех функций + обработка preflight.
//
// PROD (M5): Access-Control-Allow-Origin не должен быть '*' для приватных функций
// (revoke-consent, deletion-request, upload-url и др.). Поведение управляется env
// ALLOWED_ORIGINS (список через запятую):
//   - ALLOWED_ORIGINS задан → echo-back origin запроса, ЕСЛИ он в списке; иначе
//     CORS-origin не ставим вовсе (браузер заблокирует cross-origin ответ). При
//     echo-back добавляем "Vary: Origin" для корректного кэширования.
//   - ALLOWED_ORIGINS НЕ задан (локалка/дев) → fallback на '*' (как было), чтобы не
//     ломать локальную разработку (гость заходит с любого IP).

const BASE_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

// Обратная совместимость: статический объект с '*' (дефолт для тел ответов в errors.ts,
// если функция не передала origin-зависимые заголовки). Не ломает локалку.
export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  ...BASE_HEADERS,
};

// Разбирает ALLOWED_ORIGINS в массив (trim, без пустых). Пусто/не задан → null.
function allowedOrigins(): string[] | null {
  const raw = Deno.env.get("ALLOWED_ORIGINS");
  if (!raw) return null;
  const list = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return list.length > 0 ? list : null;
}

// Возвращает CORS-заголовки с правильным Allow-Origin для конкретного запроса.
//  - ALLOWED_ORIGINS не задан → '*' (локалка).
//  - задан и Origin запроса в списке → echo-back этого origin + Vary: Origin.
//  - задан, но Origin отсутствует/не в списке → НЕ ставим Allow-Origin (браузер
//    заблокирует), но прочие CORS-заголовки оставляем.
export function corsHeadersFor(req: Request): Record<string, string> {
  const list = allowedOrigins();
  if (list === null) {
    // Локалка/дев: прежнее поведение.
    return { "Access-Control-Allow-Origin": "*", ...BASE_HEADERS };
  }

  const origin = req.headers.get("Origin");
  if (origin && list.includes(origin)) {
    return {
      "Access-Control-Allow-Origin": origin,
      Vary: "Origin",
      ...BASE_HEADERS,
    };
  }

  // Origin не разрешён — не отражаем его. Браузер заблокирует cross-origin доступ.
  // Vary: Origin сохраняем, чтобы ответ не закэшировался под «общий» origin.
  return { Vary: "Origin", ...BASE_HEADERS };
}

// Возвращает Response для preflight (OPTIONS), либо null если это не preflight.
export function handlePreflight(req: Request): Response | null {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeadersFor(req) });
  }
  return null;
}
