import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const ts = createRequire(new URL('../packages/pdfit/package.json', import.meta.url))('typescript');
const file = process.argv[2];
const original = fs.readFileSync(file, 'utf8');
const source = ts.createSourceFile(file, original, ts.ScriptTarget.Latest, true, file.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
const edits = [];
const components = new Set();
const componentFor = (node) => {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isFunctionDeclaration(parent) && /^[A-Z]/.test(parent.name?.text ?? '') && parent.body && node.pos >= parent.body.pos) return parent;
    if ((ts.isArrowFunction(parent) || ts.isFunctionExpression(parent)) && ts.isBlock(parent.body)) {
      let ancestor = parent.parent;
      for (let i = 0; i < 3 && ancestor; i++, ancestor = ancestor.parent) {
        if (ts.isVariableDeclaration(ancestor) && /^[A-Z]/.test(ancestor.name.getText(source))) return parent;
      }
    }
  }
  return null;
};
const replace = (node, value) => edits.push({ start: node.getStart(source), end: node.end, value });
const visit = (node) => {
  let key;
  let params = '';
  if (ts.isStringLiteralLike(node) && /[가-힣]/.test(node.text)) key = node.text;
  if (ts.isTemplateExpression(node) && /[가-힣]/.test(node.getText(source))) {
    key = node.head.text + node.templateSpans.map((s, i) => `{p${i}}${s.literal.text}`).join('');
    params = `, { ${node.templateSpans.map((s, i) => `p${i}: ${s.expression.getText(source)}`).join(', ')} }`;
  }
  if (ts.isJsxText(node) && /[가-힣]/.test(node.text)) key = node.text.trim().replace(/\s+/g, ' ');
  if (key) {
    // 비교·데이터 키·기본 매개변수는 원문을 유지한다.
    if (ts.isCallExpression(node.parent) && ts.isPropertyAccessExpression(node.parent.expression) && ['includes', 'indexOf', 'replace', 'split'].includes(node.parent.expression.name.text)) return;
    if (ts.isPropertyAssignment(node.parent) && node.parent.name === node) return;
    if (ts.isParameter(node.parent)) return;
    const component = componentFor(node);
    const name = component ? 'ui' : 'uiText';
    if (component) components.add(component);
    // 모듈 상수(주석 안내)는 표시 위치에서 번역한다.
    if (!component && file.endsWith('tsx')) return;
    const expression = `${name}(${JSON.stringify(key)}${params})`;
    replace(node, ts.isJsxText(node) || ts.isJsxAttribute(node.parent) ? `{${expression}}` : expression);
    return;
  }
  ts.forEachChild(node, visit);
};
visit(source);
for (const component of components) {
  const body = component.body;
  const declaration = body.statements.find((s) => ts.isVariableStatement(s) && s.declarationList.declarations.some((d) => ts.isCallExpression(d.initializer) && d.initializer.expression.getText(source) === 'usePdfitI18n'));
  if (declaration) {
    const binding = declaration.declarationList.declarations.find((d) => ts.isCallExpression(d.initializer) && d.initializer.expression.getText(source) === 'usePdfitI18n').name;
    if (ts.isObjectBindingPattern(binding) && !binding.elements.some((e) => e.name.getText(source) === 'ui')) replace(binding, `{ ${binding.elements.map((e) => e.getText(source)).join(', ')}, ui }`);
  } else edits.push({ start: body.getStart(source) + 1, end: body.getStart(source) + 1, value: '\n  const { ui } = usePdfitI18n();' });
}
if (!edits.length) { console.log(''); process.exit(0); }
if (components.size && !original.includes('import { usePdfitI18n')) {
  const relative = path.relative(path.dirname(file), 'packages/pdfit/src/front/i18n/usePdfitI18n.js').replaceAll('\\', '/');
  edits.push({ start: 0, end: 0, value: `import { usePdfitI18n } from '${relative.startsWith('.') ? relative : `./${relative}`}';\n` });
}
if (!file.endsWith('tsx')) {
  const relative = path.relative(path.dirname(file), 'packages/pdfit/src/front/i18n/uiText.js').replaceAll('\\', '/');
  edits.push({ start: 0, end: 0, value: `import { uiText } from '${relative.startsWith('.') ? relative : `./${relative}`}';\n` });
}
let updated = original;
for (const edit of edits.sort((a, b) => b.start - a.start)) updated = updated.slice(0, edit.start) + edit.value + updated.slice(edit.end);
// apply_patch 전용 출력. 직접 파일을 쓰지 않는다.
const before = original.trimEnd().split(/\r?\n/);
const after = updated.trimEnd().split(/\r?\n/);
const width = after.length + 1;
const dp = new Uint16Array((before.length + 1) * width);
for (let a = before.length - 1; a >= 0; a--) for (let b = after.length - 1; b >= 0; b--) dp[a * width + b] = before[a] === after[b] ? 1 + dp[(a + 1) * width + b + 1] : Math.max(dp[(a + 1) * width + b], dp[a * width + b + 1]);
const ops = [];
let a = 0, b = 0;
while (a < before.length || b < after.length) {
  if (a < before.length && b < after.length && before[a] === after[b]) { ops.push(` ${before[a++]}`); b++; }
  else if (b < after.length && (a === before.length || dp[a * width + b + 1] >= dp[(a + 1) * width + b])) ops.push(`+${after[b++]}`);
  else ops.push(`-${before[a++]}`);
}
const ranges = [];
for (let i = 0; i < ops.length; i++) if (ops[i][0] !== ' ') {
  const start = Math.max(0, i - 3), end = Math.min(ops.length, i + 4);
  if (ranges.length && start <= ranges.at(-1)[1]) ranges.at(-1)[1] = end;
  else ranges.push([start, end]);
}
console.log(`*** Begin Patch\n*** Update File: ${path.resolve(file).replaceAll('\\', '/')}\n${ranges.map(([start, end]) => `@@\n${ops.slice(start, end).join('\n')}`).join('\n')}\n*** End Patch`);
