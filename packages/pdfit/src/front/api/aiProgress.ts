import { AI_MODEL_EVENT_STREAM, parseAiModelEvent, type AiModelProgress } from '../../common/protocol/ai-model/index.js';
import { readServerSentData } from '../../common/protocol/server-sent-data.js';

export async function readAiProgressResponse(response: Response, onProgress?: (phase: AiModelProgress, item?: number) => void): Promise<Response> {
  if (response.headers.get('content-type')?.split(';', 1)[0] !== AI_MODEL_EVENT_STREAM) return response;
  if (!response.body) throw new Error('Missing AI response stream.');
  for await (const data of readServerSentData(response.body)) {
    const event = parseAiModelEvent(JSON.parse(data));
    if (!event) throw new Error('Invalid AI response stream event.');
    if (event.type === 'result') return Response.json(event.body, { status: event.status });
    onProgress?.(event.phase, event.item);
  }
  throw new Error('AI response stream ended before completion.');
}
