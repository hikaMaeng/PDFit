export const BOOKSTORE_TAG_GROUPS = [
  { id: 'technology', tags: ['소프트웨어', '프로그래밍', '웹 개발', '운영체제', '인공지능', '데이터베이스', 'UI·UX'] },
  { id: 'business', tags: ['경제·경영', '마케팅', '창업', '투자·재테크'] },
  { id: 'creative', tags: ['디자인', '예술', '글쓰기', '만화'] },
  { id: 'humanities', tags: ['심리학', '역사', '문화', '사회과학', '정치', '종교', '철학'] },
  { id: 'literature', tags: ['소설', '고전', '시·에세이'] },
  { id: 'scienceWellness', tags: ['과학', '건강', '스포츠'] },
  { id: 'lifestyle', tags: ['요리', '여행'] },
  { id: 'education', tags: ['자기계발', '육아', '자녀교육', '어린이', '청소년', '유아', '외국어', '수험서·자격증'] },
] as const;

export const DOCUMENT_TAG_TAXONOMY = [
  '제안서', '보고서', '기획서', '논문', '매뉴얼', '발표자료', '교육자료',
  '회의록', '계약서', '백서', '사양서', '안내문', '자료집',
] as const;

export type BookstoreTagGroupId = typeof BOOKSTORE_TAG_GROUPS[number]['id'] | 'documents' | 'other';

export const BOOKSTORE_TAG_TAXONOMY = BOOKSTORE_TAG_GROUPS.flatMap((group) => group.tags);

const TAG_GROUP_BY_NAME = new Map<string, BookstoreTagGroupId>(
  [
    ...BOOKSTORE_TAG_GROUPS.flatMap((group) => group.tags.map((tag) => [tag, group.id] as const)),
    ...DOCUMENT_TAG_TAXONOMY.map((tag) => [tag, 'documents'] as const),
  ],
);

/** Maps controlled book and document tags to stable visual groups. */
export function bookstoreTagGroupFor(tag: string): BookstoreTagGroupId {
  return TAG_GROUP_BY_NAME.get(tag.normalize('NFKC').trim()) ?? 'other';
}

/** Classifies only explicit document-format suffixes, leaving ambiguous titles to book lookup. */
export function documentTagFromTitle(title: string): typeof DOCUMENT_TAG_TAXONOMY[number] | null {
  const normalized = title.normalize('NFKC').trim();
  const rules: ReadonlyArray<readonly [RegExp, typeof DOCUMENT_TAG_TAXONOMY[number]]> = [
    [/(?:제안서|proposal)$/i, '제안서'],
    [/(?:보고서|report)$/i, '보고서'],
    [/(?:기획서|plan)$/i, '기획서'],
    [/(?:논문|학위논문|thesis)$/i, '논문'],
    [/(?:매뉴얼|사용설명서|manual)$/i, '매뉴얼'],
    [/(?:발표자료|프레젠테이션|slides)$/i, '발표자료'],
    [/(?:교육자료|강의자료|training materials)$/i, '교육자료'],
    [/회의록$/i, '회의록'],
    [/계약서$/i, '계약서'],
    [/백서$/i, '백서'],
    [/(?:사양서|명세서)$/i, '사양서'],
    [/안내문$/i, '안내문'],
    [/자료집$/i, '자료집'],
  ];
  return rules.find(([pattern]) => pattern.test(normalized))?.[1] ?? null;
}
