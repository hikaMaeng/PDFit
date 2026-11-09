export type PdfitColorMode = 'light' | 'dark';

export const PDFIT_COLOR_MODE_STORAGE_KEY = 'pdfit.color-mode';

function initialMode(): PdfitColorMode {
  if (typeof window === 'undefined') return 'dark';
  try {
    const stored = window.localStorage.getItem(PDFIT_COLOR_MODE_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch { /* browser storage is optional */ }
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

class PdfitAppearancePreferenceModel {
  private current: PdfitColorMode = initialMode();
  private version = 0;
  private readonly listeners = new Set<() => void>();

  constructor() {
    if (typeof window === 'undefined') return;
    window.addEventListener('storage', (event) => {
      if (event.key !== PDFIT_COLOR_MODE_STORAGE_KEY) return;
      if (event.newValue !== 'light' && event.newValue !== 'dark') return;
      this.applyMode(event.newValue);
    });
  }

  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  getVersion = () => this.version;
  get mode(): PdfitColorMode { return this.current; }

  toggle(): void {
    this.setMode(this.current === 'dark' ? 'light' : 'dark');
  }

  /** Apply and persist an explicitly selected display mode. */
  setMode(mode: PdfitColorMode): void {
    if (mode === this.current) return;
    try { window.localStorage.setItem(PDFIT_COLOR_MODE_STORAGE_KEY, mode); } catch { /* unavailable storage */ }
    this.applyMode(mode);
  }

  private applyMode(mode: PdfitColorMode): void {
    if (mode === this.current) return;
    this.current = mode;
    this.version += 1;
    for (const listener of this.listeners) listener();
  }
}

export const pdfitAppearancePreferenceModel = new PdfitAppearancePreferenceModel();
