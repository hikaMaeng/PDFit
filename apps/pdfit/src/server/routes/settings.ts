import { Router, type Request, type Response } from 'express';
import { aiServerConcurrency, type SettingsStore } from '../services/settingsStore.js';
import { createAiProgressResponse } from '@pdfit/pdfit/server';
import { translateDisplayTexts, type DisplayTranslationLanguage } from '../services/displayTranslation.js';
import { BOOK_BOT_MAX_CONTEXT_TOKENS, BOOK_BOT_MIN_CONTEXT_TOKENS, isBookBotContextTokens } from '@pdfit/pdfit/common/protocol/book-bot';

const DISPLAY_TRANSLATION_LANGUAGES = new Set<DisplayTranslationLanguage>(['en', 'ko', 'zh', 'es', 'hi', 'ar', 'fr', 'pt', 'ru', 'ms', 'bn', 'ja']);

function validOcrConcurrency(value: unknown) {
  return value === undefined || (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 2_147_483_647);
}

function validBotContextTokens(value: unknown) {
  return value == null || isBookBotContextTokens(value);
}

const contextTokensError = `botContextTokens must be null or an integer from ${BOOK_BOT_MIN_CONTEXT_TOKENS} to ${BOOK_BOT_MAX_CONTEXT_TOKENS}.`;

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
    const { name, type, url, headers = {}, models = {}, ocrConcurrency, botContextTokens } = (req.body ?? {}) as {
      name?: string;
      type?: 'lm-studio' | 'openai-compat';
      url?: string;
      headers?: Record<string, string>;
      models?: Record<string, string>;
      ocrConcurrency?: number;
      botContextTokens?: number | null;
    };

    if (!name || !url) {
      res.status(400).json({ error: 'name and url are required.' });
      return;
    }
    if (!validOcrConcurrency(ocrConcurrency)) {
      res.status(400).json({ error: 'ocrConcurrency must be a positive integer.' });
      return;
    }
    if (!validBotContextTokens(botContextTokens)) { res.status(400).json({ error: contextTokensError }); return; }

    try {
      const id = await store.createAiServer({
        name,
        type: type ?? 'openai-compat',
        url,
        headers,
        models,
        ocrConcurrency,
        botContextTokens,
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

    const patch = req.body ?? {};
    if (!validOcrConcurrency(patch.ocrConcurrency)) {
      res.status(400).json({ error: 'ocrConcurrency must be a positive integer.' });
      return;
    }
    if (!validBotContextTokens(patch.botContextTokens)) { res.status(400).json({ error: contextTokensError }); return; }
    try {
      const updated = await store.updateAiServer(id, patch);
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

    const progress = createAiProgressResponse(req, res);
    try {
      const servers = await store.listAiServers();
      const server = servers.find((candidate) => Boolean(candidate.models.llm));
      if (!server) {
        res.status(503).json({ error: 'Configure an AI server with an LLM model to translate display names.' });
        return;
      }
      const modelServer = { ...server, ocrConcurrency: aiServerConcurrency(servers, server.url) ?? server.ocrConcurrency };
      progress.send(200, { translations: await translateDisplayTexts(modelServer, texts as string[], language as DisplayTranslationLanguage, progress.report) });
    } catch (error) {
      progress.send(502, { error: String(error) });
    }
  });

  return router;
}
