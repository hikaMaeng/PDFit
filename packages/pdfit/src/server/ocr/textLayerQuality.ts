/**
 * Quality check for a PDF text layer.
 *
 * Most scanned books in a library carry an invisible OCR text layer (text rendering
 * mode 3 over a page image) made by whoever scanned them. Its quality varies by book
 * and by area: body text is often usable, headings and boxed text are often not
 * ("인공지능빼서는 01렇게 팔용한다"). A digital PDF draws its text visibly.
 *
 * Calibrated on 2026-11-13 against this library (`tests/reports/ocr-quality/20261113.md`):
 * digital pages scored 0 and 0.22, a clean hidden layer 0.49, garbled hidden layers
 * 1.57 to 9.51, the garbled clip area 5.94.
 */

/** Weighted OCR-error signals per 100 non-space characters at or above which a hidden layer is not trusted. */
export const HIDDEN_LAYER_GARBLE_LIMIT = 1.0;

export interface GarbleSignals {
  /** Non-space characters. */
  chars: number;
  /** Tokens in runs of 3+ Latin-only tokens that contain a word fragment: "pr i ntf", "Ca non i c al". */
  spacedLatin: number;
  /** CJK ideographs, which OCR substitutes for Hangul or Greek ("亢", "澤"). */
  han: number;
  /** Stand-alone Hangul jamo. */
  jamo: number;
  /** "댜", the usual misreading of "다.". */
  dya: number;
  /** Full-width or stray marks: ， ． ＂ 〔 〕 » « ´ ` | */
  odd: number;
  /** (spacedLatin + 2·han + 2·jamo + 2·dya + odd) per 100 non-space characters. */
  per100: number;
}

/** Two-letter words and abbreviations that are whole words, not pieces of a split word. */
const WHOLE_TWO_LETTER = new Set(['an', 'as', 'at', 'be', 'by', 'do', 'go', 'he', 'if', 'in', 'is', 'it', 'me', 'my', 'no', 'of', 'on', 'or', 'so', 'to', 'up', 'us', 'we', 'id', 'io', 'ui', 'ux', 'ai', 'os', 'pc', 'db', 'js', 'vm', 'ci', 'cd', 'ip', 'qa', 'ok', 'vs']);

/** A Latin token that looks like a piece of a split word: one letter other than a/I, or an uncommon pair. */
function isWordFragment(token: string): boolean {
  if (token.length === 1) return !/^[aAI]$/.test(token);
  return token.length === 2 && !WHOLE_TWO_LETTER.has(token.toLowerCase());
}

export function garbleSignals(text: string): GarbleSignals {
  const compact = text.replace(/\s+/g, '');
  let spacedLatin = 0;
  let run: string[] = [];
  // A run counts only when it holds a word fragment, so "Git for Teams" or "it is a set" do not.
  const flush = () => {
    if (run.length >= 3 && run.some(isWordFragment)) spacedLatin += run.length;
    run = [];
  };
  for (const token of text.split(/\s+/)) {
    if (!token) continue;
    if (/^[A-Za-z]+[\[\]()'.,]?$/.test(token)) run.push(token.replace(/[^A-Za-z]/g, ''));
    else flush();
  }
  flush();
  const count = (pattern: RegExp) => (compact.match(pattern) ?? []).length;
  const han = count(/[一-鿿]/g);
  const jamo = count(/[ㄱ-ㆎ]/g);
  const dya = count(/댜/g);
  const odd = count(/[，．＂〔〕»«´`|]/g);
  const weighted = spacedLatin + 2 * han + 2 * jamo + 2 * dya + odd;
  const per100 = compact.length ? (weighted * 100) / compact.length : 0;
  return { chars: compact.length, spacedLatin, han, jamo, dya, odd, per100: Math.round(per100 * 100) / 100 };
}

/** Whether a text layer should be replaced by the vision model. A visible (digital) layer is always kept. */
export function isUntrustedTextLayer(layer: 'visible' | 'hidden' | 'none', text: string): boolean {
  if (layer !== 'hidden') return false;
  return garbleSignals(text).per100 >= HIDDEN_LAYER_GARBLE_LIMIT;
}
