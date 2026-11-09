import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

const here = path.dirname(fileURLToPath(import.meta.url));
const staticDir = path.resolve(here, '..', 'dist');
const port = 15201;
const tags = ['문학'];

const app = express();
app.use(express.json());
app.get('/api/folders', (_req, res) => res.json([{ name: '서재', pdfCount: 1, createdAt: '2026-09-10T00:00:00.000Z', isRoot: true, color: '#3b82f6' }]));
app.get('/api/folders/:folder/files', (_req, res) => res.json([{ name: '데미안.pdf', size: 1024, modifiedAt: '2026-09-10T00:00:00.000Z' }]));
app.get('/api/tags/summary', (_req, res) => res.json(tags.map((name) => ({ name, bookCount: 1, color: '#22c55e' }))));
app.get('/api/tags/folder/:folder', (_req, res) => res.json({ '데미안.pdf': [...tags] }));
app.get('/api/tags/book/:folder/:filename', (_req, res) => res.json([...tags]));
app.get('/api/tags', (_req, res) => res.json([...tags]));
app.post('/api/tags/book/:folder/:filename/auto', (_req, res) => {
  for (const tag of ['고전', '성장 소설']) if (!tags.includes(tag)) tags.push(tag);
  res.json({ title: '데미안', suggestedTags: ['고전', '성장 소설'], addedTags: ['고전', '성장 소설'] });
});
app.get('/api/settings/ai-servers', (_req, res) => res.json([]));
app.use(express.static(staticDir));
app.get('*', (_req, res) => res.sendFile(path.join(staticDir, 'index.html')));

app.listen(port, '127.0.0.1', () => {
  console.log(`PDFit AI auto-tag preview: http://127.0.0.1:${port}/folder/%EC%84%9C%EC%9E%AC`);
});
