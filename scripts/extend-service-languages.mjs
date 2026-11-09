import fs from 'node:fs';
import path from 'node:path';
const file = process.argv[2];
const original = fs.readFileSync(file, 'utf8');
let updated = original;
updated = updated.replaceAll('Record<PdfitLanguage,', 'Record<EstablishedPdfitLanguage,');
updated = updated.replace(/\b([A-Z_]+)\[language\]/g, (whole, name) => name === 'LANGUAGE_LABELS' ? whole : `selectLocalizedCopy(${name}, language)`);
if (file.endsWith('AuthGate.tsx')) updated = updated.replace(/const LANGUAGE_LABELS: Record<EstablishedPdfitLanguage, RSC> = \{[\s\S]*?\r?\n\};/, 'const LANGUAGE_LABELS = PDFIT_LANGUAGE_LABELS;').replaceAll('translate(LANGUAGE_LABELS[option])', 'LANGUAGE_LABELS[option]').replace('t(LANGUAGE_LABELS[option], language)', 'LANGUAGE_LABELS[option]');
if (!updated.includes('selectLocalizedCopy') && !updated.includes('EstablishedPdfitLanguage')) { console.log(''); process.exit(0); }
if (!original.includes('selectLocalizedCopy')) {
  updated = "import { selectLocalizedCopy, type EstablishedPdfitLanguage } from '@pdfit/pdfit/front/i18n/uiText';\n" + updated;
} else if (!updated.includes('EstablishedPdfitLanguage')) updated = updated.replace('selectLocalizedCopy, type EstablishedPdfitLanguage', 'selectLocalizedCopy');
// Imports added only when needed; otherwise TypeScript's unused-import check will catch them.
const before = original.trimEnd().split(/\r?\n/), after = updated.trimEnd().split(/\r?\n/);
const width = after.length + 1, dp = new Uint16Array((before.length + 1) * width);
for (let a = before.length - 1; a >= 0; a--) for (let b = after.length - 1; b >= 0; b--) dp[a * width + b] = before[a] === after[b] ? 1 + dp[(a + 1) * width + b + 1] : Math.max(dp[(a + 1) * width + b], dp[a * width + b + 1]);
const ops = [];let a = 0,b = 0;
while(a < before.length || b < after.length){if(a<before.length&&b<after.length&&before[a]===after[b]){ops.push(` ${before[a++]}`);b++;}else if(b<after.length&&(a===before.length||dp[a*width+b+1]>=dp[(a+1)*width+b]))ops.push(`+${after[b++]}`);else ops.push(`-${before[a++]}`);}
const ranges=[];for(let i=0;i<ops.length;i++)if(ops[i][0]!==' '){const start=Math.max(0,i-3),end=Math.min(ops.length,i+4);if(ranges.length&&start<=ranges.at(-1)[1])ranges.at(-1)[1]=end;else ranges.push([start,end]);}
console.log(`*** Begin Patch\n*** Update File: ${path.resolve(file).replaceAll('\\','/')}\n${ranges.map(([start,end])=>`@@\n${ops.slice(start,end).join('\n')}`).join('\n')}\n*** End Patch`);
