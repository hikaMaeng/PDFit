import { readFileSync } from 'node:fs';
const r = await fetch('https://pdfit.io/');
const html = await r.text();
const files = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map(x => x[1]);
console.log(JSON.stringify({status:r.status,assets:files,cache:r.headers.get('cache-control')}));
for (const path of files.filter(x=>x.endsWith('.js'))) {
 const res=await fetch('https://pdfit.io'+path); const body=await res.text();
 let match=false; try{match=body===readFileSync('apps/service/dist'+path,'utf8')}catch{}
 console.log(JSON.stringify({path,status:res.status,latestLocalMatch:match,hasGrayCanvas:body.includes('#f8f8f8'),hasCream:body.includes('#fff6e8')}));
}
