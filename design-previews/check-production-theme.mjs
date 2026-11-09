const body=await (await fetch('https://pdfit.io/assets/service-8vQYXePf.js')).text();
const shared=await (await fetch('https://pdfit.io/assets/usePdfitI18n-CHVS6wyW.js')).text();
for(const color of ['#e5f3ff','#fff1d9','#bfdcf0','#f8f8f8','#ffffff']) console.log(color,body.includes(color)||shared.includes(color));
