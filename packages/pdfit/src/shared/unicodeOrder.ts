/**
 * Orders two names by Unicode code point after NFC normalization.
 *
 * NFC first, so a filename stored decomposed (macOS, some SMB shares) sorts with its
 * composed twin instead of before every Hangul syllable. Code points rather than UTF-16
 * code units, so a character outside the BMP sorts after U+FFFF as Unicode orders it.
 * No locale rules: digits, then Latin capitals, then lowercase, then Hangul, as in the
 * code charts.
 */
export function compareUnicode(left: string, right: string): number {
  const a = left.normalize('NFC');
  const b = right.normalize('NFC');
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const x = a.codePointAt(i)!;
    const y = b.codePointAt(j)!;
    if (x !== y) return x < y ? -1 : 1;
    i += x > 0xffff ? 2 : 1;
    j += y > 0xffff ? 2 : 1;
  }
  return (a.length - i) - (b.length - j);
}
