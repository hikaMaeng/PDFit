export type AiModelProgress = 'queued' | 'running';

export const AI_MODEL_PROGRESS_MEDIA_TYPE = 'application/vnd.pdfit.ai-progress+event-stream';
export const AI_MODEL_EVENT_STREAM = 'text/event-stream';

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
