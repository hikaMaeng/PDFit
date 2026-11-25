export const AI_MODEL_REQUEST_TIMEOUT_MS = 20 * 60_000;

export function chatCompletionsUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.pathname = `${url.pathname.replace(/\/$/, '')}/chat/completions`;
  return url.toString();
}
