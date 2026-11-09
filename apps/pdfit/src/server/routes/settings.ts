import { Router, type Request, type Response } from 'express';
import type { SettingsStore } from '../services/settingsStore.js';
import { translateDisplayTexts, type DisplayTranslationLanguage } from '../services/displayTranslation.js';

const DISPLAY_TRANSLATION_LANGUAGES = new Set<DisplayTranslationLanguage>(['en', 'ko', 'zh', 'es', 'hi', 'ar', 'fr', 'pt', 'ru', 'ms', 'bn', 'ja']);

export function createSettingsRouter(store: SettingsStore): Router {
  const router = Router();

  router.get('/ai-servers', async (_req: Request, res: Response) => {
    try {
      res.json(await store.listAiServers());
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.post('/ai-servers', async (req: Request, res: Response) => {
    const { name, type, url, headers = {}, models = {} } = req.body as {
      name?: string;
      type?: 'lm-studio' | 'openai-compat';
      url?: string;
      headers?: Record<string, string>;
      models?: Record<string, string>;
    };

    if (!name || !url) {
      res.status(400).json({ error: 'name and url are required.' });
      return;
    }

    try {
      const id = await store.createAiServer({
        name,
        type: type ?? 'openai-compat',
        url,
        headers,
        models,
      });
      res.status(201).json({ id });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.patch('/ai-servers/:id', async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      res.status(400).json({ error: 'invalid server id' });
      return;
    }

    try {
      const updated = await store.updateAiServer(id, req.body);
      if (!updated) {
        res.status(404).json({ error: 'server not found' });
        return;
      }
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.delete('/ai-servers/:id', async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      res.status(400).json({ error: 'invalid server id' });
      return;
    }

    try {
      const deleted = await store.deleteAiServer(id);
      if (!deleted) {
        res.status(404).json({ error: 'server not found' });
        return;
      }
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.get('/pgvector', async (_req: Request, res: Response) => {
    try {
      res.json(await store.getPgVectorConfig());
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.post('/translations', async (req: Request, res: Response) => {
    const { texts, language } = req.body as { texts?: unknown; language?: unknown };
    if (!Array.isArray(texts) || texts.length < 1 || texts.length > 50 || texts.some((text) => typeof text !== 'string' || text.length > 200)) {
      res.status(400).json({ error: 'texts must contain 1-50 strings of at most 200 characters.' });
      return;
    }
    if (typeof language !== 'string' || !DISPLAY_TRANSLATION_LANGUAGES.has(language as DisplayTranslationLanguage)) {
      res.status(400).json({ error: 'unsupported target language.' });
      return;
    }

    try {
      const server = (await store.listAiServers()).find((candidate) => Boolean(candidate.models.llm));
      if (!server) {
        res.status(503).json({ error: 'Configure an AI server with an LLM model to translate display names.' });
        return;
      }
      res.json({ translations: await translateDisplayTexts(server, texts as string[], language as DisplayTranslationLanguage) });
    } catch (error) {
      res.status(502).json({ error: String(error) });
    }
  });

  router.put('/pgvector', async (req: Request, res: Response) => {
    const { user, password } = req.body as { user?: string; password?: string };
    try {
      await store.savePgVectorConfig({ user, password });
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  return router;
}
