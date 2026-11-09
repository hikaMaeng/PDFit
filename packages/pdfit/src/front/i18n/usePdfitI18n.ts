import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { usePdfitFrontConfig } from '../context.js';
import { pdfitLanguagePreferenceModel, type PdfitLanguage } from '../model/languagePreference.js';
import { pdfitMessage, type PdfitMessageKey, type PdfitMessageParams } from './messages.js';
import { translateUiText } from './uiText.js';

export interface PdfitI18n {
  language: PdfitLanguage;
  t: (key: PdfitMessageKey, params?: PdfitMessageParams) => string;
  ui: (source: string, params?: PdfitMessageParams) => string;
}

export function usePdfitI18n(): PdfitI18n {
  const { languagePreference } = usePdfitFrontConfig();
  const model = languagePreference?.model ?? pdfitLanguagePreferenceModel;
  useSyncExternalStore(model.subscribe, model.getVersion, model.getVersion);
  const language = model.language;
  return useMemo(() => ({ language, t: (key, params) => pdfitMessage(language, key, params), ui: (source, params) => translateUiText(language, source, params) }), [language]);
}

export function useTranslatedDisplayText(value: string, enabled = true): string {
  const { displayTranslation } = usePdfitFrontConfig();
  const { language } = usePdfitI18n();
  const [translated, setTranslated] = useState(value);

  useEffect(() => {
    let active = true;
    setTranslated(value);
    if (!enabled || !value.trim() || !displayTranslation) return () => { active = false; };
    void displayTranslation.translate([value], language)
      .then(([next]) => { if (active && next?.trim()) setTranslated(next); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [displayTranslation, enabled, language, value]);

  return translated;
}
