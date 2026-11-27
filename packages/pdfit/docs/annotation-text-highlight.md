# Text selection and highlights

The viewer shares the left toolbar's `select` state with the annotation
tools. In that state, a [`DocumentTextLayer`][layer] lets the browser select
text over the open page. Pressing an annotation or clip tool takes the layer
out of the viewport. A drag on blank space still pans the page.

[PageTextSource][source] reads the embedded text with PDF.js. It checks the
text rendering mode when the shared hidden-layer quality check flags the
text. For a scan it requests a full-page raster from the existing PDFGPU
provider, then uses a single Tesseract.js worker with the bundled Korean and
English [tessdata_fast 4.1.0 models][models]. The browser fetches the worker
and models from the viewer origin when a scan first needs them. Image data
stays in the browser. This path uses single-block OCR, so copied reading
order can vary on pages with multiple columns or tables.

[PageTextModel][model] prioritizes the active page and keeps up to 24 page
results per open document. It stores coordinates in display-oriented PDF
points. The text layer applies `getPageTransform()` on zoom, scroll, and
Deskew updates. Clipboard copy uses the selected offsets. For scans,
[OCR layout][layout] infers word gaps and joins wrapped lines of Korean
prose using the OCR boxes. The selectable boxes keep their original
positions. If a touch hold has produced no browser
selection after 650 ms, the viewer selects the word and shows a copy button.

Highlights saved by the palette use the dragged area's existing vector
geometry. A future text-based highlight would need to convert the selection
ranges to PDF rectangles and store the multiple rectangles as one annotation.

[layer]: ../src/front/components/PdfGpuViewer/DocumentTextLayer.tsx
[source]: ../src/front/viewer/text-selection/pageTextSource.ts
[model]: ../src/front/viewer/text-selection/pageTextModel.ts
[layout]: ../src/front/viewer/text-selection/ocrLayout.ts
[models]: https://github.com/tesseract-ocr/tessdata_fast/tree/4.1.0
