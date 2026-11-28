import type { PdfitMessageKey } from '../../i18n/messages.js';
import type { ViewerBackgroundName } from '../../model/viewerBackgroundPreference.js';

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
  background: 'Background',
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

export const backgroundKeys = {
  button: 'viewer.background.palette.button',
  colors: {
    darkGray: 'viewer.background.darkGray.label',
    nearBlack: 'viewer.background.nearBlack.label',
    charcoal: 'viewer.background.charcoal.label',
    gray: 'viewer.background.gray.label',
    silver: 'viewer.background.silver.label',
    white: 'viewer.background.white.label',
    warmGray: 'viewer.background.warmGray.label',
    taupe: 'viewer.background.taupe.label',
    sand: 'viewer.background.sand.label',
    parchment: 'viewer.background.parchment.label',
    slate: 'viewer.background.slate.label',
    navy: 'viewer.background.navy.label',
    steelBlue: 'viewer.background.steelBlue.label',
    mistBlue: 'viewer.background.mistBlue.label',
    teal: 'viewer.background.teal.label',
    forest: 'viewer.background.forest.label',
    sage: 'viewer.background.sage.label',
    aubergine: 'viewer.background.aubergine.label',
    dustyRose: 'viewer.background.dustyRose.label',
    lavender: 'viewer.background.lavender.label',
  } satisfies Record<ViewerBackgroundName, PdfitMessageKey>,
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
  goToPage: 'viewer.ocr.goToPage.button',
} as const;
