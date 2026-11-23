// See docs/internals.md#태그-편집 for the storage and rendering contract.
export const TAG_ICONS = [
  'tag', 'book', 'code', 'science', 'school', 'work', 'star', 'lightbulb', 'language', 'palette', 'music', 'build',
  'robot', 'terminal', 'database', 'cloud', 'network', 'security', 'lock', 'chip', 'devices', 'phone',
  'chart', 'math', 'biotech', 'medicine', 'health', 'psychology', 'finance', 'commerce', 'factory', 'architecture',
  'travel', 'map', 'history', 'law', 'people', 'chat', 'writing', 'image', 'video', 'audio',
  'sports', 'nature', 'animals', 'food', 'home', 'space',
] as const;

export type TagIconName = typeof TAG_ICONS[number];
export const DEFAULT_TAG_ICON: TagIconName = 'tag';
export const MAX_TAG_NAME_LENGTH = 200;

export function isTagIconName(value: unknown): value is TagIconName {
  return typeof value === 'string' && TAG_ICONS.some((icon) => icon === value);
}

export function isEditableTagName(name: string): boolean {
  return name.length > 0 && name.length <= MAX_TAG_NAME_LENGTH && !/[\u0000-\u001f\u007f\p{Surrogate}]/u.test(name)
    && name !== '.' && name !== '..';
}

export interface TagDetails {
  name: string;
  color: string;
  icon: TagIconName;
}

export interface TagDetailsPatch extends Partial<TagDetails> {
  previousName: string;
}

export type TagDetailsUpdateResult =
  | { status: 'updated'; tag: TagDetails }
  | { status: 'missing' | 'stale' | 'duplicate' };

export interface TagDetailsChange {
  previousName: string;
  name: string;
}
