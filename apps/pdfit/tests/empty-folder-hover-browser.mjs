import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const browser=await chromium.launch();
try {
 for(const mode of ['light','dark']) {
  const context=await browser.newContext();
  const origin='http://127.0.0.1:15201';
  await context.request.post(origin+'/api/auth/local-preview',{headers:{Origin:origin}});
  await context.addInitScript(mode=>localStorage.setItem('pdfit.color-mode',mode),mode);
  const page=await context.newPage();
  await page.route('**/api/folders/__empty_hover__/files', route => route.fulfill({ json: [] }));
  await page.route('**/api/tags/folder/__empty_hover__', route => route.fulfill({ json: {} }));
  await page.goto(origin+'/folder/__empty_hover__');
  await page.getByText('아직 문서가 없습니다.',{exact:true}).waitFor();
  assert.equal(await page.getByText('문서를 여기로 드래그하거나 업로드 버튼을 눌러 추가하세요.',{exact:true}).count(),1);
  assert.equal(await page.getByTestId('DescriptionOutlinedIcon').count(),1);
  const buttons = await Promise.all(['upload-pdf','refresh-folder'].map(id => page.getByTestId(id).evaluate(el => { const style=getComputedStyle(el); return [style.backgroundColor,style.color,style.borderColor,style.height]; })));
  assert.deepEqual(buttons[0],buttons[1]);
  const rows=page.getByTestId('lnb-folder-row');
  const counts=await rows.evaluateAll(items => items.map(el => el.querySelector('.MuiTypography-caption')?.getBoundingClientRect().right).filter(Boolean));
  assert.ok(Math.max(...counts)-Math.min(...counts)<1);
  for(const id of ['upload-pdf','refresh-folder']) {
   const button=page.getByTestId(id);
   await page.mouse.move(0,0);
   await new Promise(resolve=>setTimeout(resolve,200));
   const idle=await button.evaluate(el=>getComputedStyle(el).backgroundColor);
   await button.hover();
   await new Promise(resolve=>setTimeout(resolve,200));
   assert.notEqual(await button.evaluate(el=>getComputedStyle(el).backgroundColor),idle);
  }
  await context.close();
 }
 console.log('빈 문서 안내 및 라이트/다크 업로드·새로고침 호버 검증 통과');
} finally {await browser.close();}
