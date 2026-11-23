// See docs/internals.md#태그-편집 for the storage and rendering contract.
export const TAG_ICON_GROUPS = [
  {
    id: 'ai',
    icons: [
      'robot', 'generative', 'model', 'neural', 'prompt', 'agent', 'rag', 'vision',
      'speech', 'training', 'evaluation', 'automation', 'ocr',
    ],
  },
  {
    id: 'data',
    icons: [
      'database', 'relational', 'query', 'schema', 'tables', 'index', 'vector', 'warehouse',
      'pipeline', 'cache', 'backup', 'chart',
    ],
  },
  {
    id: 'infra',
    icons: [
      'container', 'cluster', 'orchestration', 'server', 'cloud', 'network', 'virtualization', 'deployment',
      'monitoring', 'logs', 'loadbalancer', 'security', 'firewall', 'lock', 'key', 'chip',
      'gpu', 'devices', 'phone',
    ],
  },
  {
    id: 'development',
    icons: [
      'code', 'terminal', 'api', 'git', 'test', 'debug', 'cicd', 'package',
      'web', 'frontend', 'backend', 'ide', 'review', 'build',
    ],
  },
  {
    id: 'general',
    icons: [
      'tag', 'book', 'science', 'school', 'work', 'star', 'lightbulb', 'language',
      'palette', 'music', 'math', 'biotech', 'medicine', 'health', 'psychology', 'finance',
      'commerce', 'factory', 'architecture', 'travel', 'map', 'history', 'law', 'people',
      'chat', 'writing', 'image', 'video', 'audio', 'sports', 'nature', 'animals',
      'food', 'home', 'space',
    ],
  },
] as const;

export type TagIconGroup = typeof TAG_ICON_GROUPS[number]['id'];
export type TagIconName = typeof TAG_ICON_GROUPS[number]['icons'][number];
export const TAG_ICONS: readonly TagIconName[] = TAG_ICON_GROUPS.flatMap<TagIconName>(({ icons }) => icons);
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
