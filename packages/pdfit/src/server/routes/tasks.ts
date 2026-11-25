import { Router, type Request, type Response } from 'express';
import type { TaskScheduler } from '../tasks/taskScheduler.js';

/** Read-only view of the background task scheduler, plus per-job details a job chooses to expose. */
export function createTasksRouter(scheduler: TaskScheduler, details?: () => Record<string, unknown> | Promise<Record<string, unknown>>): Router {
  const router = Router();

  router.get('/status', async (_req: Request, res: Response, next) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.json({ ...scheduler.status(), details: await details?.() ?? {} });
    } catch (error) { next(error); }
  });

  return router;
}
