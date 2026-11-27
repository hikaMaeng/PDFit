export const viewerBackgroundPalette = [
  ['darkGray', '#3a3a3a'],
  ['nearBlack', '#18181b'],
  ['charcoal', '#27272a'],
  ['gray', '#6b7280'],
  ['silver', '#a3a3a3'],
  ['white', '#ffffff'],
  ['warmGray', '#57534e'],
  ['taupe', '#82766b'],
  ['sand', '#c7ae8a'],
  ['parchment', '#eee2c9'],
  ['slate', '#334155'],
  ['navy', '#1e293b'],
  ['steelBlue', '#486581'],
  ['mistBlue', '#b5cadb'],
  ['teal', '#285759'],
  ['forest', '#344e41'],
  ['sage', '#a3b18a'],
  ['aubergine', '#4c354f'],
  ['dustyRose', '#ab7882'],
  ['lavender', '#c9bedc'],
] as const;

export type ViewerBackgroundName = typeof viewerBackgroundPalette[number][0];
type ViewerBackgroundColor = typeof viewerBackgroundPalette[number][1];

const storageKey = 'pdfit.viewer.background';
const defaultColor = viewerBackgroundPalette[0][1];

function paletteColor(stored: string | null): ViewerBackgroundColor {
  return viewerBackgroundPalette.find(([, color]) => color === stored)?.[1] ?? defaultColor;
}

function readColor(): ViewerBackgroundColor {
  try { return paletteColor(window.localStorage.getItem(storageKey)); }
  catch { return defaultColor; }
}

class ViewerBackgroundPreference {
  private color = readColor();
  private readonly listeners = new Set<() => void>();

  constructor() {
    if (typeof window === 'undefined') return;
    window.addEventListener('storage', (event) => {
      if (event.key === storageKey) this.apply(paletteColor(event.newValue));
      if (event.key === null) this.apply(readColor());
    });
  }

  getColor = () => this.color;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  select(color: ViewerBackgroundColor): void {
    try { window.localStorage.setItem(storageKey, color); } catch { /* Storage is optional. */ }
    this.apply(color);
  }

  private apply(color: ViewerBackgroundColor): void {
    if (color === this.color) return;
    this.color = color;
    for (const listener of this.listeners) listener();
  }
}

export const viewerBackgroundPreference = new ViewerBackgroundPreference();
