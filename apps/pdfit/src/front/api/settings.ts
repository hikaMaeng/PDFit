// ─── 공유 타입 ─────────────────────────────────────────────────
export type AiServerType = 'lm-studio' | 'openai-compat';

export interface AiServerModels {
  vision?: string;
  llm?: string;
  embedding?: string;
}

export interface AiServer {
  id: number;
  name: string;
  type: AiServerType;
  url: string;
  headers: Record<string, string>;
  models: AiServerModels;
  created_at: number;
  updated_at: number;
}

export interface AiServerInput {
  name: string;
  type: AiServerType;
  url: string;
  headers?: Record<string, string>;
  models?: AiServerModels;
}

// ─── AI 서버 API ───────────────────────────────────────────────
export async function listAiServers(): Promise<AiServer[]> {
  const res = await fetch('/api/settings/ai-servers');
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function createAiServer(input: AiServerInput): Promise<{ id: number }> {
  const res = await fetch('/api/settings/ai-servers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await res.text());
  displayTranslationAvailability = undefined;
  return res.json();
}

export async function updateAiServer(
  id: number,
  input: Partial<AiServerInput>
): Promise<void> {
  const res = await fetch(`/api/settings/ai-servers/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await res.text());
  displayTranslationAvailability = undefined;
}

export async function deleteAiServer(id: number): Promise<void> {
  const res = await fetch(`/api/settings/ai-servers/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(await res.text());
  displayTranslationAvailability = undefined;
}

const displayTranslationCache = new Map<string, string>();
let displayTranslationAvailability: Promise<boolean> | undefined;

async function hasDisplayTranslationServer(): Promise<boolean> {
  displayTranslationAvailability ??= listAiServers()
    .then((servers) => servers.some((server) => Boolean(server.models.llm?.trim())))
    .catch(() => false);
  return displayTranslationAvailability;
}

/**
 * Display-name translation requests, batched. Every tag chip asks for its own label,
 * so a cover grid of hundreds of books asks for thousands at once. Requests are merged
 * per text, gathered for a short moment, and sent at most BATCH_SIZE texts per request
 * with one request in flight, because one AI server answers them one at a time.
 *
 * State: `queued` and `inflight` are keyed by language + NUL + text. An entry lives from
 * the first request for that text until its batch settles, then moves to
 * `displayTranslationCache` (page lifetime). They are bounded by the distinct labels on
 * the page. `flushBatches` clears them.
 */
const BATCH_SIZE = 50;
const MAX_TEXT_LENGTH = 200;
const BATCH_DELAY_MS = 30;
const queued = new Map<string, { text: string; language: string; resolve: (value: string) => void }[]>();
const inflight = new Map<string, Promise<string>>();
let flushTimer: ReturnType<typeof setTimeout> | undefined;
let sending: Promise<void> = Promise.resolve();

/** True when the text is already written in the target language's script. */
function alreadyInLanguage(text: string, language: string): boolean {
  if (language === 'ko') return /[\uac00-\ud7a3]/.test(text) && !/[A-Za-z]{2,}/.test(text);
  if (language === 'en') return /^[\x20-\x7e]+$/.test(text);
  return false;
}

async function sendBatch(language: string, entries: { text: string; resolve: (value: string) => void }[]): Promise<void> {
  const texts = entries.map((entry) => entry.text);
  let translations: string[] = texts;
  try {
    const res = await fetch('/api/settings/translations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texts, language }),
    });
    if (res.ok) {
      const list = (await res.json() as { translations?: unknown }).translations;
      if (Array.isArray(list)) translations = texts.map((text, index) => (typeof list[index] === 'string' ? list[index] as string : text));
    }
  } catch { /* offline: keep the original labels */ }
  entries.forEach((entry, index) => {
    const key = `${language}\u0000${entry.text}`;
    const value = translations[index]?.trim() ? translations[index] : entry.text;
    displayTranslationCache.set(key, value);
    inflight.delete(key);
    entry.resolve(value);
  });
}

function flushBatches(): void {
  flushTimer = undefined;
  const byLanguage = new Map<string, { text: string; resolve: (value: string) => void }[]>();
  for (const [, waiters] of queued) {
    const [first] = waiters;
    const list = byLanguage.get(first.language) ?? [];
    // One entry per text; every waiter for it resolves with the same value.
    list.push({ text: first.text, resolve: (value) => waiters.forEach((waiter) => waiter.resolve(value)) });
    byLanguage.set(first.language, list);
  }
  queued.clear();
  for (const [language, entries] of byLanguage) {
    for (let index = 0; index < entries.length; index += BATCH_SIZE) {
      const batch = entries.slice(index, index + BATCH_SIZE);
      sending = sending.then(() => sendBatch(language, batch));
    }
  }
}

function requestTranslation(text: string, language: string): Promise<string> {
  const key = `${language}\u0000${text}`;
  const existing = inflight.get(key);
  if (existing) return existing;
  const promise = new Promise<string>((resolve) => {
    const waiters = queued.get(key) ?? [];
    waiters.push({ text, language, resolve });
    queued.set(key, waiters);
  });
  inflight.set(key, promise);
  flushTimer ??= setTimeout(flushBatches, BATCH_DELAY_MS);
  return promise;
}

export async function translateDisplayTexts(texts: string[], language: string): Promise<string[]> {
  const missing = [...new Set(texts.filter((text) => !displayTranslationCache.has(`${language}\u0000${text}`)))];
  if (missing.length > 0) {
    if (!await hasDisplayTranslationServer()) {
      missing.forEach((text) => displayTranslationCache.set(`${language}\u0000${text}`, text));
    } else {
      await Promise.all(missing.map((text) => {
        if (!text.trim() || text.length > MAX_TEXT_LENGTH || alreadyInLanguage(text, language)) {
          displayTranslationCache.set(`${language}\u0000${text}`, text);
          return Promise.resolve(text);
        }
        return requestTranslation(text, language);
      }));
    }
  }
  return texts.map((text) => displayTranslationCache.get(`${language}\u0000${text}`) ?? text);
}
