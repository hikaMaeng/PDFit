import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { createPdfitServer, createTagSuggestionProviderFromEnvironment, EmbeddingService, EmbeddingStore, readPdfitTaskSchedulerEnvironment } from '@pdfit/pdfit/server';
import { createPostgresMetadataStore, migrateSqliteMetadata } from '@pdfit/pdfit/server/postgres';
import { aiModelTimeoutMs } from '@pdfit/pdfit/common/protocol/ai-model';
import { createSettingsRouter } from './routes/settings.js';
import { fetchAiModel } from './services/aiModelFetch.js';
import { aiServerConcurrency, PostgresSettingsStore } from './services/settingsStore.js';

function readPort(value: string | undefined): number {
  const port = Number(value ?? '15201');
  if (!Number.isInteger(port) || port < 10000 || port > 59999) {
    throw new Error('SERVER_PORT must be an integer between 10000 and 59999.');
  }
  return port;
}

function readBooksRoot(value: string | undefined): string {
  if (!value) {
    throw new Error('BOOKS_ROOT is required.');
  }
  return path.resolve(process.cwd(), value);
}

function readBookmarksRoot(value: string | undefined): string {
  if (!value) {
    throw new Error('BOOKMARKS_ROOT is required.');
  }
  return path.resolve(process.cwd(), value);
}

function readMaxUploadBytes(value: string | undefined): number {
  const megabytes = Number(value ?? '2048');
  if (!Number.isInteger(megabytes) || megabytes < 1 || megabytes > 10240) {
    throw new Error('MAX_UPLOAD_MB must be an integer between 1 and 10240.');
  }
  return megabytes * 1024 * 1024;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = readPort(process.env.SERVER_PORT);
const booksRoot = readBooksRoot(process.env.BOOKS_ROOT);
const bookmarksRoot = readBookmarksRoot(process.env.BOOKMARKS_ROOT);
const booksRootName = process.env.BOOKS_ROOT_NAME ?? '이북';
const maxUploadBytes = readMaxUploadBytes(process.env.MAX_UPLOAD_MB);
// Background jobs (first-page thumbnails today) share one hourly schedule and one worker pool.
const thumbnailsRoot = path.resolve(process.cwd(), process.env.THUMBNAILS_ROOT ?? path.join(path.dirname(bookmarksRoot), 'thumbnails'));
const taskSchedulerOptions = readPdfitTaskSchedulerEnvironment(process.env);
const pool = new Pool({
  host: process.env.PGHOST ?? '127.0.0.1',
  port: Number(process.env.PGPORT ?? '5432'),
  database: process.env.PGDATABASE ?? 'books',
  user: process.env.PGUSER ?? 'books',
  password: process.env.PGPASSWORD ?? 'books',
});
const metadataStore = await createPostgresMetadataStore(pool, bookmarksRoot);
const migrated = await migrateSqliteMetadata(path.join(path.dirname(booksRoot), 'app.db'), pool);
if (migrated) console.log('[pdfit] migrated SQLite metadata into PostgreSQL.');
const settingsStore = new PostgresSettingsStore(pool);
await settingsStore.ensureSchema();
const embeddingStore = new EmbeddingStore(pool);
await embeddingStore.ensureSchema();
const embedding = new EmbeddingService(embeddingStore, (choice) => settingsStore.embeddingEndpoint(choice));
const resolveChatModel = async () => {
  const servers = await settingsStore.listAiServers();
  const server = await settingsStore.resolveLlm(servers);
  return server?.models.llm ? {
    baseUrl: server.url, model: server.models.llm, headers: server.headers,
    ocrConcurrency: aiServerConcurrency(servers, server.url), contextTokens: server.botContextTokens,
    timeoutMs: aiModelTimeoutMs(server.requestTimeoutMinutes),
  } : null;
};
// OCR can use a multimodal LLM when no vision model is set.
const resolveVisionModel = async () => {
  const servers = await settingsStore.listAiServers();
  const server = servers.find((candidate) => Boolean(candidate.models.vision)) ?? await settingsStore.resolveLlm(servers);
  const model = server?.models.vision || server?.models.llm;
  return server && model ? {
    baseUrl: server.url, model, headers: server.headers, ocrConcurrency: aiServerConcurrency(servers, server.url),
    timeoutMs: aiModelTimeoutMs(server.requestTimeoutMinutes),
  } : null;
};
const suggestBookTags = createTagSuggestionProviderFromEnvironment(process.env, fetch, {
  requestAi: fetchAiModel,
  useEnvironmentClassifier: async () => !(await settingsStore.defaultModels()).llmExplicit,
  resolveEnvironmentConcurrency: async (baseUrl) => aiServerConcurrency(await settingsStore.listAiServers(), baseUrl),
  resolveAiServer: async () => {
    const model = await resolveChatModel();
    return model ? { ...model, reasoningEffort: 'low' } : null;
  },
});
const app = createPdfitServer({
  metadataStore,
  booksRoot,
  bookmarkAssetRoot: bookmarksRoot,
  booksRootName,
  staticDir: path.resolve(__dirname, '..'),
  logLabel: 'pdfit',
  extraRouters: [{ path: '/api/settings', router: createSettingsRouter(settingsStore, embedding) }],
  watcherEnabled: true,
  viewerBasePath: '/viewer',
  viewerIndexFile: path.join('viewer', 'index.html'),
  maxUploadBytes,
  suggestBookTags,
  bookBot: {
    store: metadataStore.bookBot,
    resolveModel: resolveChatModel,
    searchBook: (book, query, onProgress) => embedding.searchBook(book, query, onProgress),
    request: fetchAiModel,
  },
  backgroundTasks: {
    thumbnailRoot: thumbnailsRoot,
    ...taskSchedulerOptions,
    resolveVisionServer: resolveVisionModel,
    requestVision: fetchAiModel,
    embedding,
  },
});

// Establish the first database connections and load the two initial read
// models before exposing the HTTP port. The browser should not pay the
// PostgreSQL cold-start cost on its first concurrent requests.
await Promise.all([
  metadataStore.listFolderBookCounts(),
  metadataStore.listTagSummaries(),
]);

app.listen(port, () => {
  console.log(`[pdfit] listening on http://localhost:${port}`);
});
