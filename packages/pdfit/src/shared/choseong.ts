const HANGUL_SYLLABLE_START = 0xac00;
const HANGUL_SYLLABLE_END = 0xd7a3;
const SYLLABLES_PER_INITIAL = 21 * 28;
const INITIALS = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'] as const;

/**
 * 검색용 문자열 정규화: NFC, 소문자, 모든 공백 제거. 공백을 없애 "ㅇㄱㅇ ㅈㅂㄷ"과 "ㅇㄱㅇㅈㅂㄷ"을 같게 다룬다.
 */
export function compactSearchText(value: string): string {
  return value.normalize('NFC').toLowerCase().replace(/\s+/gu, '');
}

/**
 * 책 제목의 초성 검색 필드(`books.title_choseong`)를 만든다.
 * 확장자 `.pdf`를 뺀 제목을 compactSearchText로 정규화한 뒤 한글 완성형 음절을 초성(ㄱ~ㅎ)으로 바꾸고,
 * 그 밖의 문자(영문·숫자·기호·이미 자모인 글자)는 그대로 둔다. 예: "이것이 자바다.pdf" → "ㅇㄱㅇㅈㅂㄷ".
 * 서버(PostgreSQL 쓰기)와 호스팅 런타임(IndexedDB 검색)이 같은 함수를 쓴다.
 */
export function titleChoseong(filename: string): string {
  let result = '';
  for (const char of compactSearchText(filename.replace(/\.pdf$/iu, ''))) {
    const code = char.codePointAt(0)!;
    result += code >= HANGUL_SYLLABLE_START && code <= HANGUL_SYLLABLE_END
      ? INITIALS[Math.floor((code - HANGUL_SYLLABLE_START) / SYLLABLES_PER_INITIAL)]
      : char;
  }
  return result;
}
