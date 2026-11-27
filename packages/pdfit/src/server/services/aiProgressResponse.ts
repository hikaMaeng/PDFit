import type { Request, Response } from 'express';
import { AI_MODEL_EVENT_STREAM, AI_MODEL_PROGRESS_MEDIA_TYPE, type AiModelEvent, type AiModelProgress } from '../../common/protocol/ai-model/index.js';
import { openEventStream } from './eventStream.js';

export function createAiProgressResponse(req: Request, res: Response) {
  const wantsProgress = req.accepts(['json', AI_MODEL_PROGRESS_MEDIA_TYPE]) === AI_MODEL_PROGRESS_MEDIA_TYPE;
  let stream: ReturnType<typeof openEventStream<AiModelEvent>> | undefined;
  return {
    report: wantsProgress ? (phase: AiModelProgress, item?: number) => {
      if (res.destroyed) return;
      stream ??= openEventStream(res, AI_MODEL_EVENT_STREAM);
      stream.write({ type: 'progress', phase, item });
    } : undefined,
    send(status: number, body: unknown) {
      if (stream) {
        stream.write({ type: 'result', status, body });
        stream.close();
      } else if (!res.destroyed) res.status(status).json(body);
    },
  };
}
