export const PDFIT_LANGUAGES = ['en', 'ko', 'zh', 'es', 'hi', 'ar', 'fr', 'pt'] as const;
export type PdfitLanguage = (typeof PDFIT_LANGUAGES)[number];

const FALLBACK_LANGUAGE: PdfitLanguage = 'en';
export const PDFIT_LANGUAGE_STORAGE_KEY = 'pdfit.language';
const LEGACY_LANGUAGE_STORAGE_KEY = 'pdfit.service.login-language';

export function resolvePdfitLanguage(value: unknown): PdfitLanguage {
  if (typeof value !== 'string') return FALLBACK_LANGUAGE;
  const normalized = value.trim().toLowerCase().split(/[-_]/, 1)[0] ?? '';
  return PDFIT_LANGUAGES.includes(normalized as PdfitLanguage) ? normalized as PdfitLanguage : FALLBACK_LANGUAGE;
}

function readStoredLanguage(): PdfitLanguage | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = window.localStorage.getItem(PDFIT_LANGUAGE_STORAGE_KEY) ?? window.localStorage.getItem(LEGACY_LANGUAGE_STORAGE_KEY);
    if (!stored) return null;
    const normalized = stored.trim().toLowerCase();
    return PDFIT_LANGUAGES.includes(normalized as PdfitLanguage) ? normalized as PdfitLanguage : null;
  } catch {
    return null;
  }
}

function readBrowserLanguage(): unknown {
  if (typeof navigator === 'undefined') return null;
  return navigator.languages?.[0] ?? navigator.language;
}

export class PdfitLanguagePreferenceModel {
  private version = 0;
  private readonly listeners = new Set<() => void>();
  private currentLanguage: PdfitLanguage = readStoredLanguage() ?? resolvePdfitLanguage(readBrowserLanguage());

  constructor() {
    this.applyDocumentLanguage();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getVersion = (): number => this.version;

  get language(): PdfitLanguage {
    return this.currentLanguage;
  }

  setLanguage(language: PdfitLanguage): void {
    if (language === this.currentLanguage) return;
    this.currentLanguage = language;
    if (typeof window !== 'undefined') {
      try { window.localStorage.setItem(PDFIT_LANGUAGE_STORAGE_KEY, language); } catch { /* unavailable storage */ }
    }
    this.applyDocumentLanguage();
    this.version += 1;
    for (const listener of this.listeners) listener();
  }

  private applyDocumentLanguage(): void {
    if (typeof document === 'undefined') return;
    document.documentElement.lang = this.currentLanguage;
    document.documentElement.dir = this.currentLanguage === 'ar' ? 'rtl' : 'ltr';
  }
}

export const pdfitLanguagePreferenceModel = new PdfitLanguagePreferenceModel();
