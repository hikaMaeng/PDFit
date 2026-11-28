export type AiModelProgress = 'queued' | 'running';

export const AI_MODEL_PROGRESS_MEDIA_TYPE = 'application/vnd.pdfit.ai-progress+event-stream';
export const AI_MODEL_EVENT_STREAM = 'text/event-stream';
export const AI_MODEL_DEFAULT_TIMEOUT_MINUTES = 20;
export const AI_MODEL_MAX_TIMEOUT_MINUTES = Math.floor(2_147_483_647 / 60_000);

export function isAiModelTimeoutMinutes(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= AI_MODEL_MAX_TIMEOUT_MINUTES;
}

export function aiModelTimeoutMs(minutes = AI_MODEL_DEFAULT_TIMEOUT_MINUTES): number {
  return minutes * 60_000;
}

export type AiModelEvent =
  | { type: 'progress'; phase: AiModelProgress; item?: number }
  | { type: 'result'; status: number; body: unknown };

export function parseAiModelEvent(value: unknown): AiModelEvent | null {
  if (!value || typeof value !== 'object' || !('type' in value)) return null;
  if (value.type === 'progress' && 'phase' in value && (value.phase === 'queued' || value.phase === 'running')) {
    if (!('item' in value)) return { type: 'progress', phase: value.phase };
    if (typeof value.item === 'number' && Number.isSafeInteger(value.item) && value.item >= 0) {
      return { type: 'progress', phase: value.phase, item: value.item };
    }
  }
  if (value.type === 'result' && 'body' in value && 'status' in value && typeof value.status === 'number' &&
      Number.isInteger(value.status) && value.status >= 200 && value.status <= 599 && ![204, 205, 304].includes(value.status)) {
    return { type: 'result', status: value.status, body: value.body };
  }
  return null;
}
