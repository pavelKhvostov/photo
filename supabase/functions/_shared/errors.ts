// Хелперы ответов для Edge Functions «Кадр».
// Формат ошибки строго: { "error": { "code": "...", "message": "..." } }
// + корректный HTTP-статус и CORS-заголовки.

import { corsHeaders } from "./cors.ts";

const jsonHeaders = {
  ...corsHeaders,
  "Content-Type": "application/json; charset=utf-8",
};

export function jsonError(
  code: string,
  message: string,
  status: number,
): Response {
  return new Response(
    JSON.stringify({ error: { code, message } }),
    { status, headers: jsonHeaders },
  );
}

export function jsonOk(body: unknown, status = 200): Response {
  return new Response(
    JSON.stringify(body),
    { status, headers: jsonHeaders },
  );
}
