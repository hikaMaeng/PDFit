import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const browser=await chromium.launch();
try {
 const origin='http://127.0.0.1:15201';
 const context=await browser.newContext();
 await context.request.post(origin+'/api/auth/local-preview',{headers:{Origin:origin}});
 const page=await context.newPage();
 let removed = 0;
 await page.route('**/api/tags/book/**', route => { if(route.request().method()==='DELETE'){ removed++; return route.fulfill({json:{ok:true}}); } return route.continue(); });
 const files=await (await context.request.get(origin+'/api/folders/cvzxv/files')).json();
 await page.route('**/api/tags/folder/cvzxv',route=>route.fulfill({json:Object.fromEntries(files.map(file=>[file.name,[]]))}));
 let runs=0;
 await page.route('**/api/tags/folder/cvzxv/auto',route=>{
  const books=route.request().postDataJSON().books;
  assert.ok(books.length<=10);runs++;
  return route.fulfill({json:{processed:books.length,failed:0,addedTags:books.length,books:books.map(book=>({...book,assignedTag:'체험태그',addedTags:['체험태그'],removedTags:[]})),errors:[]}});
 });
 await page.goto(origin+'/folder/cvzxv?preview=trial');
 const button=page.getByTestId('ai-auto-tag-all');
 await button.waitFor();
 for(let run=0;run<2;run++){
  await button.click();const dialog=page.getByRole('dialog');
  await dialog.getByText('문서 2개에 AI 태그를 추천할까요?',{exact:true}).waitFor();
  await dialog.getByTestId('ai-auto-tag-upgrade-guide').getByText('무료 AI 태그 문서 최대 10개 · 유료 이용권은 더 많은 문서를 처리할 수 있습니다.',{exact:true}).waitFor();
  await dialog.getByRole('button').last().click();
  for(let i=0;i<80&&(runs<=run||await button.isDisabled());i++)await new Promise(resolve=>setTimeout(resolve,50));
  assert.equal(await button.isEnabled(),true);
 }
 await page.getByRole('dialog').waitFor({state:'hidden'});
 assert.equal(runs,2);
 assert.equal(await page.getByTestId('ai-auto-tag-upgrade-guide').count(),0);
 await page.getByRole('button',{name:'표지 보기',exact:true}).click();
 await page.getByTestId('pdf-cover-card').first().getByTestId('pdf-cover-info-toggle').click();
 const tag = page.getByTestId('pdf-cover-card').first().getByTestId('pdf-tag-chip').first();
 await tag.waitFor();
 assert.match(await tag.innerText(),/^#/);
 assert.equal(await tag.evaluate(el=>getComputedStyle(el).borderTopWidth),'0px');
 assert.equal(await page.getByTestId('lnb-tags-section').getByTestId('HashTagIcon').count(),1);
 const removedLabel = await tag.innerText();
 await tag.locator('.MuiChip-deleteIcon').click();
 for(let i=0;i<80 && removed===0;i++) await new Promise(resolve=>setTimeout(resolve,50));
 assert.equal(removed,1);
 await page.waitForTimeout(1000);
 assert.ok(!(await page.getByTestId('pdf-cover-card').first().getByTestId('pdf-tag-chip').allTextContents()).includes(removedLabel));
 console.log('무료 체험 실제 태그 부여 후 대상 소진 상태 재실행 통과 (API fixture)');
}finally{await browser.close();}
