import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const ts = createRequire(new URL('../packages/pdfit/package.json', import.meta.url))('typescript');

// 개발 시 정적 UI 문구만 처리한다. 사용자 파일·태그·환경 설정은 읽지 않는다.
const root = process.cwd();
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
const parse = (file) => ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, file.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
const strings = (node) => {
  if (ts.isStringLiteralLike(node)) return [node.text];
  const result = [];
  ts.forEachChild(node, (child) => { result.push(...strings(child)); });
  return result;
};
const english = new Set();
const korean = new Set();
['Saving {count} changes…', '{count} changes failed', 'Drag to move annotation tools', 'Annotation color', 'Annotation fill color'].forEach((s) => english.add(s));
for (const file of walk(path.join(root, 'apps/service/src/front')).filter((f) => /\.tsx?$/.test(f))) {
  const source = parse(file);
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && node.type?.getText(source).includes('Record<PdfitLanguage') && node.initializer && ts.isObjectLiteralExpression(node.initializer)) {
      const en = node.initializer.properties.find((p) => p.name?.getText(source) === 'en');
      if (en && ts.isPropertyAssignment(en)) strings(en.initializer).forEach((s) => english.add(s));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}
Object.values(JSON.parse(fs.readFileSync('apps/service/assets/i18n/en.json', 'utf8'))).forEach((s) => english.add(s));
const messageSource = parse('packages/pdfit/src/front/i18n/messages.ts');
const visitMessages = (node) => {
  if (ts.isPropertyAssignment(node) && ts.isArrayLiteralExpression(node.initializer)) {
    const first = node.initializer.elements[0];
    if (first && ts.isStringLiteralLike(first)) english.add(first.text);
  }
  ts.forEachChild(node, visitMessages);
};
visitMessages(messageSource);
for (const file of walk('packages/pdfit/src/front').filter((f) => /\.tsx?$/.test(f) && !f.includes(`${path.sep}i18n${path.sep}`))) {
  const visit = (node) => {
    if (ts.isStringLiteralLike(node) && /[가-힣]/.test(node.text)) korean.add(node.text);
    if (ts.isTemplateExpression(node) && /[가-힣]/.test(node.getText())) korean.add(node.head.text + node.templateSpans.map((s, i) => `{p${i}}${s.literal.text}`).join(''));
    if (ts.isJsxText(node) && /[가-힣]/.test(node.text)) korean.add(node.text.trim().replace(/\s+/g, ' '));
    ts.forEachChild(node, visit);
  };
  visit(parse(file));
}
const language = process.argv[2];
const group = process.argv[3] ?? 'en';
const all = [...(group === 'ko' ? korean : english)].filter(Boolean).sort();
if (!language) { console.log(JSON.stringify({ en: all.length, ko: korean.size, english: [...english], korean: [...korean] })); process.exit(0); }
const sources = group === 'ko' ? [...korean].filter(Boolean).sort() : all;
const translated = {};
const translate = async (items) => {
  const tokens = items.map((s) => s.match(/\{[^{}]+\}/g) ?? []);
  const originals = items.map((s, i) => { let ordinal = 0; return s.replace(/\{[^{}]+\}/g, () => `__P${ordinal++}__`); });
  const text = originals.map((s, i) => `[[${i}]] ${s.replace(/\n/g, ' ZXLBRXZ ')}`).join('\n');
  const url = new URL('https://translate.googleapis.com/translate_a/single');
  Object.entries({ client: 'gtx', sl: group, tl: language, dt: 't', q: text }).forEach(([key, value]) => url.searchParams.set(key, value));
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`번역 응답 ${response.status}`);
  const data = await response.json();
  const output = data[0].map((s) => s[0]).join('');
  const parts = [...output.matchAll(/\[\[\s*(\d+)\s*\]\]\s*([\s\S]*?)(?=\[\[\s*\d+\s*\]\]|$)/g)];
  if (parts.length !== items.length) throw new Error(`번역 항목 불일치 ${parts.length}/${items.length}`);
  return parts.map((part, i) => {
    if (Number(part[1]) !== i) throw new Error('번역 순서 불일치');
    const value = part[2].trim().replace(/__\s*P\s*(\d+)\s*__/gi, (_, ordinal) => tokens[i][Number(ordinal)]).replace(/\s*ZXLBRXZ\s*/gi, '\n');
    const expected = items[i].match(/\{[^{}]+\}/g) ?? [];
    for (const token of expected) if (!value.includes(token)) throw new Error(`번역 변수 누락: ${token}`);
    return value;
  });
};
for (let offset = 0; offset < sources.length;) {
  const batch = [];
  let length = 0;
  while (offset + batch.length < sources.length && (length < 2200 || batch.length === 0)) {
    const value = sources[offset + batch.length]; batch.push(value); length += value.length + 20;
  }
  let result;
  for (let attempt = 0; attempt < 3; attempt++) {
    try { result = await translate(batch); break; }
    catch (error) {
      if (attempt === 2) {
        result = [];
        for (const item of batch) result.push(...await translate([item]));
        break;
      }
    }
  }
  batch.forEach((value, i) => { translated[value] = result[i]; });
  offset += batch.length;
}
console.log(JSON.stringify(translated));
