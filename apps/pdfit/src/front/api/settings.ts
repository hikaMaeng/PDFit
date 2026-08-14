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
}

export async function deleteAiServer(id: number): Promise<void> {
  const res = await fetch(`/api/settings/ai-servers/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(await res.text());
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
