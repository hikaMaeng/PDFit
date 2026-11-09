# Annotation Persistence

PDFit stores annotations separately from the original PDF. The browser renders the original document through PDFGPU/PDFium and composes persisted records through the SVG/HTML annotation layer.

## Document identity

The `url` already passed to `PdfGpuViewer` is the document identifier. Local files use their encoded folder/file API path and remote files use their existing by-id API path, so the annotation layer does not duplicate viewer routing knowledge.

## Storage

PostgreSQL table `annotations` stores UUID, document ID, zero-based page index, type, JSONB geometry, JSONB style, and timestamps. PDF bytes are never updated.

## Save flow

Create, update, and delete operations update the local history first, then persist only the changed IDs. The toolbar exposes loading, saving, saved, and failed states. Failed operations remain eligible for retry and the existing metadata outbox can replay queued writes after connectivity returns.

## Rendering flow

`PostgreSQL → Annotation API → annotation history → SVG/HTML layer → PDFGPU page projection`
