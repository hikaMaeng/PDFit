const TAG_COLOR_PALETTE = [
  '#2563eb', '#dc2626', '#16a34a', '#9333ea', '#ea580c', '#0891b2', '#db2777', '#65a30d',
  '#4f46e5', '#c026d3', '#0d9488', '#ca8a04', '#e11d48', '#7c3aed', '#0284c7', '#059669',
  '#b91c1c', '#6d28d9', '#c2410c', '#15803d', '#a21caf', '#0369a1', '#be123c', '#4d7c0f',
] as const;

function hashTagName(value: string): number {
  let hash = 2166136261;
  for (const character of value.normalize('NFKC').toLocaleLowerCase()) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function hslToHex(hue: number, saturation: number, lightness: number): string {
  const s = saturation / 100;
  const l = lightness / 100;
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const section = hue / 60;
  const x = chroma * (1 - Math.abs((section % 2) - 1));
  const [red, green, blue] = section < 1 ? [chroma, x, 0]
    : section < 2 ? [x, chroma, 0]
      : section < 3 ? [0, chroma, x]
        : section < 4 ? [0, x, chroma]
          : section < 5 ? [x, 0, chroma]
            : [chroma, 0, x];
  const offset = l - chroma / 2;
  return `#${[red, green, blue].map((channel) => Math.round((channel + offset) * 255).toString(16).padStart(2, '0')).join('')}`;
}

/** Returns a stable high-contrast color that is not already used in the current tag collection. */
export function distinctTagColor(tagName: string, usedColors: Iterable<string> = []): string {
  return '#3b82f6';
}

/** Preserves saved colors, including duplicates; see docs/internals.md. */
export function withDistinctTagColors<T extends { name: string; color: string }>(tags: T[]): T[] {
  const used = new Set<string>();
  return tags.map((tag) => {
    const normalized = /^#[0-9a-f]{6}$/i.test(tag.color) ? tag.color.toLocaleLowerCase() : '';
    const color = normalized || '#3b82f6';
    used.add(color);
    return color === tag.color ? tag : { ...tag, color };
  });
}

/** Softens vivid tag colors and darkens them enough to remain legible on light surfaces. */
export function tagColorForMode(color: string | undefined, mode: 'light' | 'dark'): string {
  const fallback = mode === 'light' ? '#3f6382' : '#60a5fa';
  if (!color || !/^#[0-9a-f]{6}$/i.test(color)) return fallback;
  if (mode === 'dark') return color;

  const source = [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16));
  const neutral = [32, 40, 46];
  const amount = 0.3;
  return `#${source.map((channel, index) => Math.round(channel * (1 - amount) + neutral[index] * amount)
    .toString(16)
    .padStart(2, '0')).join('')}`;
}
