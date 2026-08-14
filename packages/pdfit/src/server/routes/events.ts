import type { EventEmitter } from 'node:events';
import { Router, type Request, type Response } from 'express';

export function createEventsRouter(bus: EventEmitter): Router {
  const router = Router();
  const clients = new Set<Response>();

  bus.on('change', (event: string) => {
    for (const client of clients) {
      try {
        client.write(`data: ${event}\n\n`);
      } catch {
        // ignore broken clients
      }
    }
  });

  router.get('/', (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    clients.add(res);
    const heartbeat = setInterval(() => {
      try {
        res.write(': heartbeat\n\n');
      } catch {
        clearInterval(heartbeat);
      }
    }, 30_000);

    req.on('close', () => {
      clients.delete(res);
      clearInterval(heartbeat);
    });
  });

  return router;
}
