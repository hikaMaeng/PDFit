import type { Response } from 'express';
import { BOOK_BOT_STREAM_TYPE, type BookBotStreamEvent } from '../../common/protocol/book-bot/index.js';

export function openBookBotStream(res: Response) {
  res.set({
    'Content-Type': BOOK_BOT_STREAM_TYPE,
    'Cache-Control': 'no-store, no-transform',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  const active = () => !res.destroyed && !res.writableEnded;
  const heartbeat = setInterval(() => { if (active()) res.write(': keep-alive\n\n'); }, 15_000);
  heartbeat.unref();
  res.once('close', () => clearInterval(heartbeat));
  return {
    write(event: BookBotStreamEvent) {
      if (!active()) return;
      // Disconnect a stalled reader instead of buffering an unbounded write queue.
      if (res.writableLength > 2 * 1024 * 1024) { res.destroy(); return; }
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    },
    close() {
      clearInterval(heartbeat);
      if (active()) res.end();
    },
  };
}
