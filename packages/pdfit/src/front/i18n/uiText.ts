import type { PdfitLanguage } from '../model/languagePreference.js';
import { pdfitLanguagePreferenceModel } from '../model/languagePreference.js';
import enRu from './catalog/en-ru.json';
import enMs from './catalog/en-ms.json';
import enBn from './catalog/en-bn.json';
import enJa from './catalog/en-ja.json';
import koEn from './catalog/ko-en.json';
import koJa from './catalog/ko-ja.json';
import koZh from './catalog/ko-zh.json';
import koEs from './catalog/ko-es.json';
import koHi from './catalog/ko-hi.json';
import koAr from './catalog/ko-ar.json';
import koFr from './catalog/ko-fr.json';
import koPt from './catalog/ko-pt.json';
import koRu from './catalog/ko-ru.json';
import koMs from './catalog/ko-ms.json';
import koBn from './catalog/ko-bn.json';

export type EstablishedPdfitLanguage = Exclude<PdfitLanguage, 'ru' | 'ms' | 'bn'>;

const english: Partial<Record<PdfitLanguage, Record<string, string>>> = { ru: enRu, ms: enMs, bn: enBn, ja: enJa };
const additionalEnglishCopy: Partial<Record<PdfitLanguage, Record<string, string>>> = {
  ru: {
    'Select an important part of a document to save it here.': 'Выберите важный фрагмент документа и сохраните его здесь.',
    'This document is no longer available. It or its folder may be in the trash. The library list is being updated.': 'Документ недоступен. Возможно, он или его папка находятся в корзине. Список библиотеки обновляется.',
  },
  ms: {
    'Select an important part of a document to save it here.': 'Pilih bahagian penting dokumen untuk disimpan di sini.',
    'This document is no longer available. It or its folder may be in the trash. The library list is being updated.': 'Dokumen ini tidak tersedia. Dokumen atau foldernya mungkin berada dalam tong sampah. Senarai pustaka sedang dikemas kini.',
  },
  bn: {
    'Select an important part of a document to save it here.': 'এখানে সংরক্ষণ করতে নথির একটি গুরুত্বপূর্ণ অংশ নির্বাচন করুন।',
    'This document is no longer available. It or its folder may be in the trash. The library list is being updated.': 'এই নথিটি উপলব্ধ নেই। এটি বা এর ফোল্ডার ট্র্যাশে থাকতে পারে। লাইব্রেরির তালিকা হালনাগাদ হচ্ছে।',
  },
};
const korean: Partial<Record<PdfitLanguage, Record<string, string>>> = {
  en: koEn, ja: koJa, zh: koZh, es: koEs, hi: koHi, ar: koAr,
  fr: koFr, pt: koPt, ru: koRu, ms: koMs, bn: koBn,
};
const previousUiText = new Map<string, string>();
const koreanTerminologyCopy: Record<string, string> = {
  '북마크를 불러오지 못했습니다.': '보관함을 불러오지 못했습니다.',
  '북마크를 삭제하지 못했습니다.': '보관함에서 삭제하지 못했습니다.',
  '북마크를 수정하지 못했습니다.': '보관한 항목을 수정하지 못했습니다.',
  '북마크를 저장하지 못했습니다 ({p0}).': '보관함에 저장하지 못했습니다 ({p0}).',
  '북마크를 저장하지 못했습니다: {p0}': '보관함에 저장하지 못했습니다: {p0}',
  '북마크 삭제': '보관함에서 삭제',
  '북마크 페이지로 이동': '보관한 페이지로 이동',
  '북마크를 저장하는 중입니다…': '보관함에 저장하는 중입니다…',
  '북마크 영역을 조금 더 크게 드래그하세요.': '보관할 영역을 조금 더 크게 드래그하세요.',
  '북마크가 저장되었습니다.': '보관함에 저장되었습니다.',
  '북마크를 저장하지 못했습니다. {p0}': '보관함에 저장하지 못했습니다. {p0}',
  '한 페이지 안에서 북마크 영역을 드래그하세요.': '한 페이지 안에서 보관할 영역을 드래그하세요.',
  '북마크를 저장하지 못했습니다.': '보관함에 저장하지 못했습니다.',
  '도서 정보 찾기': '문서 정보 찾기',
  '도서 항목 직접 입력': '문서 항목 직접 입력',
  '12,000원 결제 후 도서 정보 찾기': '12,000원 결제 후 문서 정보 찾기',
  '도서 정보 찾기를 중단했습니다.': '문서 정보 찾기를 중단했습니다.',
  '도서 정보 조회 시간이 지났습니다.': '문서 정보 조회 시간이 지났습니다.',
  '도서 정보 조회 시간이 지났습니다. 다시 시도하거나 직접 입력해 주세요.': '문서 정보 조회 시간이 지났습니다. 다시 시도하거나 직접 입력해 주세요.',
  '도서 정보를 불러왔습니다. 내용을 확인한 뒤 변경사항을 저장하세요.': '문서 정보를 불러왔습니다. 내용을 확인한 뒤 변경사항을 저장하세요.',
  '도서 정보와 표지를 자동으로 연결했습니다. 내용을 확인한 뒤 저장하세요.': '문서 정보와 표지를 자동으로 연결했습니다. 내용을 확인한 뒤 저장하세요.',
};
const previousUiTemplates: Array<{ source: string; expression: RegExp; fields: string[] }> = [];
for (const catalog of Object.values(korean)) {
  if (!catalog) continue;
  for (const [source, translated] of Object.entries(catalog)) {
    if (!translated.includes('{')) previousUiText.set(translated, source);
    else {
      const fields: string[] = [];
      const escaped = translated.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\{([^{}]+)\\\}/g, (_match, field: string) => {
        fields.push(field);
        return '([\\s\\S]*?)';
      });
      previousUiTemplates.push({ source, expression: new RegExp(`^${escaped}$`), fields });
    }
  }
}

/** Static UI copy only; document names and user-authored data are never translated here. */
export function translateEnglishUi(language: PdfitLanguage, source: string): string {
  if (language === 'en') return source;
  return additionalEnglishCopy[language]?.[source] ?? english[language]?.[source] ?? source;
}

function interpolate(template: string, params: Record<string, string | number>): string {
  let result = template;
  for (const [name, value] of Object.entries(params)) result = result.split(`{${name}}`).join(String(value));
  return result;
}

/** Resolves previously hard-coded Korean UI copy from a complete static catalog. */
export function translateUiText(language: PdfitLanguage, source: string, params: Record<string, string | number> = {}): string {
  let canonical = previousUiText.get(source) ?? source;
  if (canonical === source && !Object.keys(params).length && !korean[language]?.[source]) {
    for (const template of previousUiTemplates) {
      const match = source.match(template.expression);
      if (!match) continue;
      canonical = template.source;
      params = Object.fromEntries(template.fields.map((field, index) => [field, match[index + 1]]));
      break;
    }
  }
  return interpolate(language === 'ko' ? koreanTerminologyCopy[canonical] ?? canonical : korean[language]?.[canonical] ?? canonical, params);
}

/** For async notices and API errors which use the shared language preference directly. */
export function uiText(source: string, params?: Record<string, string | number>): string {
  return translateUiText(pdfitLanguagePreferenceModel.language, source, params);
}

/** Applies new-language copy to the existing nine-language structured resources. */
export function selectLocalizedCopy<T>(copy: Record<EstablishedPdfitLanguage, T>, language: PdfitLanguage): T {
  if (language !== 'ru' && language !== 'ms' && language !== 'bn') return copy[language];
  const transform = (value: unknown): unknown => {
    if (typeof value === 'string') return translateEnglishUi(language, value);
    if (Array.isArray(value)) return value.map(transform);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, transform(item)]));
    return value;
  };
  return transform(copy.en) as T;
}
