import { Router, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { ActiveModelConflict, aiServerConcurrency, type AiServerInput, type PostgresSettingsStore } from '../services/settingsStore.js';
import { createAiProgressResponse, type EmbeddingService } from '@pdfit/pdfit/server';
import { translateDisplayTexts, type DisplayTranslationLanguage } from '../services/displayTranslation.js';
import { BOOK_BOT_MAX_CONTEXT_TOKENS, BOOK_BOT_MIN_CONTEXT_TOKENS, isBookBotContextTokens } from '@pdfit/pdfit/common/protocol/book-bot';
import { isEmbeddingModel, type ModelChoice } from '@pdfit/pdfit/common/protocol/embedding-search';

const DISPLAY_TRANSLATION_LANGUAGES = new Set<DisplayTranslationLanguage>(['en', 'ko', 'zh', 'es', 'hi', 'ar', 'fr', 'pt', 'ru', 'ms', 'bn', 'ja']);

function validOcrConcurrency(value: unknown) {
  return value === undefined || (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 2_147_483_647);
}

function validBotContextTokens(value: unknown) {
  return value == null || isBookBotContextTokens(value);
}

const contextTokensError = `botContextTokens must be null or an integer from ${BOOK_BOT_MIN_CONTEXT_TOKENS} to ${BOOK_BOT_MAX_CONTEXT_TOKENS}.`;

function validCandidates(input: Partial<AiServerInput>): boolean {
  return ([input.llmCandidates, input.embeddingCandidates] as const).every((list) => list === undefined || (
    Array.isArray(list) && list.length <= 64 && new Set(list.flatMap((model) => model?.id ? [model.id] : [])).size
      === list.filter((model) => model?.id).length
  )) && (input.llmCandidates === undefined || input.llmCandidates.every((model) => model && typeof model.name === 'string'
    && !!model.name.trim() && model.name.length <= 300 && !model.name.includes('\0')
    && (model.id === undefined || (typeof model.id === 'string' && model.id.length <= 100))))
    && (input.embeddingCandidates === undefined || input.embeddingCandidates.every((model) => isEmbeddingModel(model)
      && Buffer.byteLength(model.documentPrefix) + 12 <= Math.min(512, model.maxInputTokens)
      && Buffer.byteLength(model.queryPrefix) + 12 <= model.maxInputTokens));
}

export function createSettingsRouter(store: PostgresSettingsStore, embedding: EmbeddingService): Router {
  const router = Router();

  router.get('/ai-models/defaults', async (_req, res, next) => {
    try { res.json(await store.defaultModels()); } catch (error) { next(error); }
  });

  router.patch('/ai-models/defaults', async (req, res, next) => {
    const { role, choice } = req.body ?? {};
    if ((role !== 'llm' && role !== 'embedding') || (choice !== null && (!choice || !Number.isSafeInteger(choice.serverId)
      || choice.serverId < 1 || typeof choice.modelId !== 'string' || !choice.modelId || choice.modelId.length > 100))) {
      res.sendStatus(400); return;
    }
    const selected: ModelChoice | null = choice;
    try {
      if (role === 'llm') {
        await embedding.store.transaction(async (client) => {
          await store.lockDefaults(client);
          await store.selectLlm(client, selected);
        });
      } else {
        const token = randomUUID();
        const endpoint = await embedding.store.transaction(async (client) => {
          await store.lockDefaults(client);
          const candidate = selected ? await store.embeddingEndpoint(selected, client) : null;
          if (selected && !candidate) throw new ActiveModelConflict('Embedding candidate no longer exists');
          await client.query('UPDATE embedding_control SET selection = $1 WHERE singleton', [token]);
          return candidate;
        });
        if (endpoint) {
          try {
            const input = ['PDFit index check', 'PDFit search check'].slice(0, endpoint.model.embeddingConcurrency);
            await embedding.client.embed(endpoint, input);
          } catch { res.status(502).json({ error: 'Embedding model check failed' }); return; }
        }
        await embedding.store.transaction(async (client) => {
          const { rows: [{ selection }] } = await client.query('SELECT selection FROM embedding_control WHERE singleton FOR UPDATE');
          const current = selected ? await store.embeddingEndpoint(selected, client) : null;
          if (selection !== token || (selected && (!current || current.version !== endpoint?.version))) {
            throw new ActiveModelConflict('Model settings changed during verification');
          }
          await embedding.store.activate(client, selected, current);
        });
        embedding.wake();
      }
      res.json(await store.defaultModels());
    } catch (error) {
      if (error instanceof ActiveModelConflict) { res.status(409).json({ error: error.message }); return; }
      next(error);
    }
  });

  router.get('/ai-servers', async (_req: Request, res: Response) => {
    try {
      res.json(await store.listAiServers());
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.post('/ai-servers', async (req: Request, res: Response) => {
    const input = (req.body ?? {}) as Partial<AiServerInput>;
    const { name, type, url, headers = {}, models = {}, ocrConcurrency, botContextTokens } = input;

    if (!name || !url) {
      res.status(400).json({ error: 'name and url are required.' });
      return;
    }
    if (!validOcrConcurrency(ocrConcurrency)) {
      res.status(400).json({ error: 'ocrConcurrency must be a positive integer.' });
      return;
    }
    if (!validBotContextTokens(botContextTokens)) { res.status(400).json({ error: contextTokensError }); return; }
    if (!validCandidates(input)) { res.status(400).json({ error: 'Invalid model candidates' }); return; }

    try {
      const id = await store.createAiServer({
        name,
        type: type ?? 'openai-compat',
        url,
        headers,
        models,
        ocrConcurrency,
        botContextTokens,
        llmCandidates: input.llmCandidates,
        embeddingCandidates: input.embeddingCandidates,
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
    if (!validCandidates(patch)) { res.status(400).json({ error: 'Invalid model candidates' }); return; }
    try {
      const updated = await store.updateAiServer(id, patch);
      if (!updated) {
        res.status(404).json({ error: 'server not found' });
        return;
      }
      res.json({ ok: true });
    } catch (error) {
      res.status(error instanceof ActiveModelConflict ? 409 : 500).json({ error: String(error) });
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
      res.status(error instanceof ActiveModelConflict ? 409 : 500).json({ error: String(error) });
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
      const server = await store.resolveLlm(servers);
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
