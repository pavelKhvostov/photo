// Хелперы ответов для Edge Functions «Кадр».
// Формат ошибки строго: { "error": { "code": "...", "message": "..." } }
// + корректный HTTP-статус и CORS-заголовки.
//
// CORS (M5): jsonError/jsonOk принимают ОПЦИОНАЛЬНЫЙ последний параметр corsHdrs —
// origin-зависимые заголовки от corsHeadersFor(req). Если не передан, используется
// статический '*'-дефолт (обратная совместимость; локалка без ALLOWED_ORIGINS не
// ломается). Функции с приватными данными вычисляют const cors = corsHeadersFor(req)
// и передают его в каждый jsonError/jsonOk.

import { corsHeaders } from "./cors.ts";

function jsonHeadersFrom(corsHdrs?: Record<string, string>): Record<string, string> {
  return {
    ...(corsHdrs ?? corsHeaders),
    "Content-Type": "application/json; charset=utf-8",
  };
}

export function jsonError(
  code: string,
  message: string,
  status: number,
  corsHdrs?: Record<string, string>,
): Response {
  return new Response(
    JSON.stringify({ error: { code, message } }),
    { status, headers: jsonHeadersFrom(corsHdrs) },
  );
}

export function jsonOk(
  body: unknown,
  status = 200,
  corsHdrs?: Record<string, string>,
): Response {
  return new Response(
    JSON.stringify(body),
    { status, headers: jsonHeadersFrom(corsHdrs) },
  );
}
