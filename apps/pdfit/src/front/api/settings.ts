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

export interface PgVectorConfig {
  user?: string;
  password?: string;
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

// ─── PGVector 설정 API ────────────────────────────────────────
export async function getPgVectorConfig(): Promise<PgVectorConfig> {
  const res = await fetch('/api/settings/pgvector');
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function savePgVectorConfig(config: PgVectorConfig): Promise<void> {
  const res = await fetch('/api/settings/pgvector', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  if (!res.ok) throw new Error(await res.text());
}

const displayTranslationCache = new Map<string, string>();
let displayTranslationAvailability: Promise<boolean> | undefined;

async function hasDisplayTranslationServer(): Promise<boolean> {
  displayTranslationAvailability ??= listAiServers()
    .then((servers) => servers.some((server) => Boolean(server.models.llm?.trim())))
    .catch(() => false);
  return displayTranslationAvailability;
}

export async function translateDisplayTexts(texts: string[], language: string): Promise<string[]> {
  const missing = [...new Set(texts.filter((text) => !displayTranslationCache.has(`${language}\u0000${text}`)))];
  if (missing.length > 0) {
    if (!await hasDisplayTranslationServer()) {
      missing.forEach((text) => displayTranslationCache.set(`${language}\u0000${text}`, text));
      return texts.map((text) => displayTranslationCache.get(`${language}\u0000${text}`) ?? text);
    }
    const res = await fetch('/api/settings/translations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texts: missing, language }),
    });
    if (res.ok) {
      const payload = await res.json() as { translations: string[] };
      missing.forEach((text, index) => displayTranslationCache.set(`${language}\u0000${text}`, payload.translations[index] ?? text));
    } else {
      missing.forEach((text) => displayTranslationCache.set(`${language}\u0000${text}`, text));
    }
  }
  return texts.map((text) => displayTranslationCache.get(`${language}\u0000${text}`) ?? text);
}
