// Visible toolbar captions are English in every UI locale.
export const toolbarLabels = {
  controls: 'viewer controls',
  single: '1 Page',
  double: '2 Pages',
  cover: 'Cover',
  scroll: 'Scroll',
  fitWidth: 'Fit Width',
  fitHeight: 'Fit Height',
  zoomOut: 'Zoom −',
  zoomIn: 'Zoom +',
  image: 'Image',
  deskew: 'Deskew',
  ocr: 'OCR',
  download: 'Download',
  comments: 'Comments',
  contents: 'Contents',
  scan: 'Scan',
  previous: 'Prev',
  next: 'Next',
} as const;

export const deskewKeys = {
  toggle: 'viewer.deskew.toggle.button',
} as const;

export const scanKeys = {
  status: 'scanStatus',
  coverage: 'scanCoverage',
  startPage: 'scanStartPage',
  start: 'scanStart',
  preparing: 'scanPreparing',
  queued: 'scanQueued',
  modelQueued: 'aiModelQueued',
  modelRunning: 'aiModelRunning',
  progress: 'scanProgress',
  activePages: 'scanActivePages',
  activeCount: 'scanActiveCount',
  cancelling: 'scanCancelling',
  completed: 'scanCompleted',
  cancelled: 'scanCancelled',
  failed: 'scanFailed',
  sourceChanged: 'scanSourceChanged',
  requestFailed: 'scanRequestFailed',
  saved: 'scanSaved',
  unsaved: 'scanUnsaved',
  pageStatus: 'scanPageStatus',
} as const;
