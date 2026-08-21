# PDF Annotation Architecture

PDFit keeps PDF rendering and editing concerns separated.

```text
Browser
  → PdfGpuViewer
    → @pdfgpu/core 0.1.9
      → PDFium document engine
      → WebGPU/Canvas page rendering
    → AnnotationLayer
      → SVG shapes and ink
      → HTML textarea / SVG foreignObject text
      → PDFGPU overlay projection
    → Annotation history
      → optimistic local snapshots
      → REST CRUD / metadata outbox
        → PostgreSQL annotations table
```

The original PDF is never modified. Annotation geometry is stored in zero-based page PDF coordinates, then projected at render time. This keeps zoom, scroll, page virtualization, and future renderer improvements independent from editing state.

Area highlight is implemented. Text-selection highlight requires a future PDFGPU public contract for text runs and glyph bounds; see `annotation-text-highlight.md`.
