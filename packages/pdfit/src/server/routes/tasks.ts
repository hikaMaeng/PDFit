import { Router, type Request, type Response } from 'express';
import type { TaskScheduler } from '../tasks/taskScheduler.js';

/** Read-only view of the background task scheduler, plus per-job details a job chooses to expose. */
export function createTasksRouter(scheduler: TaskScheduler, details?: () => Record<string, unknown>): Router {
  const router = Router();

  router.get('/status', (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ...scheduler.status(), details: details?.() ?? {} });
  });

  return router;
}
