import assert from 'node:assert/strict';
import test from 'node:test';
import {
  exportBaseName,
  formatDocumentExportMarkdown,
} from '../dist/front/export/documentExport.js';

test('document export produces a portable Markdown note', () => {
  const markdown = formatDocumentExportMarkdown({
    formatVersion: 1,
    exportedAt: '2026-09-04T06:30:00.000Z',
    document: {
      folder: '연구',
      filename: '인공지능 개론.pdf',
      driveFileId: 'drive-file-1',
      documentId: '/api/folders/by-id/drive-file-1',
    },
    tags: ['AI', '학습'],
    progressPage: 35,
    viewerState: null,
    annotations: [{
      id: 'annotation-1',
      documentId: '/api/folders/by-id/drive-file-1',
      pageIndex: 34,
      type: 'text',
      geometry: { x: 10, y: 20, width: 120, height: 30, text: '핵심 개념', fontSize: 14 },
      style: { color: '#ef4444', opacity: 1, strokeWidth: 2, fillColor: null },
      createdAt: '2026-09-04T06:00:00.000Z',
      updatedAt: '2026-09-04T06:00:00.000Z',
    }],
    bookmarks: [{
      id: 'bookmark-1', folder: '연구', filename: '인공지능 개론.pdf', pageIndex: 34,
      rect: { x: 10, y: 20, width: 120, height: 80 }, borderColor: '#f59e0b',
      fillColor: null, fillOpacity: 0.2, comment: '다시 읽기', imageMimeType: 'image/jpeg',
      imageDataUrl: 'data:image/jpeg;base64,YWJj',
      createdAt: '2026-09-04T06:00:00.000Z', updatedAt: '2026-09-04T06:00:00.000Z',
    }],
  });

  assert.match(markdown, /^# 인공지능 개론\.pdf/m);
  assert.match(markdown, /Reading page: 35/);
  assert.match(markdown, /> 다시 읽기/);
  assert.match(markdown, /data:image\/jpeg;base64,YWJj/);
  assert.match(markdown, /Page 35 · 핵심 개념/);
});

test('document export creates a safe base filename', () => {
  assert.equal(exportBaseName('보고서:초안?.pdf'), '보고서_초안_');
  assert.equal(exportBaseName('.pdf'), 'pdfit-document');
});
