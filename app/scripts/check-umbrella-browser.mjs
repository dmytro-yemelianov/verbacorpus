import {execFileSync} from 'node:child_process';
import {writeFile,mkdir} from 'node:fs/promises';
const [workspace, pane] = process.argv.slice(2);
if (!workspace || !pane) throw new Error('Usage: node scripts/check-umbrella-browser.mjs <workspace> <pane>');
const connection=JSON.parse(execFileSync('superset',['browser','cdp','--workspace',workspace,'--pane',pane,'--json'],{encoding:'utf8'}));
const ws=new WebSocket(connection.url);
await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true})});
let id=0;const pending=new Map(),exceptions=[];
ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.exceptionThrown')exceptions.push(m.params.exceptionDetails.text);if(m.id&&pending.has(m.id)){const [resolve,reject]=pending.get(m.id);pending.delete(m.id);m.error?reject(new Error(m.error.message)):resolve(m.result)}});
function send(method,params={}){return new Promise((resolve,reject)=>{const n=++id;pending.set(n,[resolve,reject]);ws.send(JSON.stringify({id:n,method,params}))})}
async function evaluate(expression){const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.text);return r.result.value}
async function ready(expression){return evaluate(`new Promise((resolve,reject)=>{const start=Date.now();const timer=setInterval(()=>{if(${expression}){clearInterval(timer);resolve(true)}else if(Date.now()-start>20000){clearInterval(timer);reject(new Error('Page readiness timed out'))}},100)})`)}
const output=new URL('../../docs/previews/umbrella/',import.meta.url).pathname;await mkdir(output,{recursive:true});
const report={checkedAt:new Date().toISOString(),pages:[],interactions:[],exceptions};
try{
 await send('Page.enable');await send('Runtime.enable');
 for(const width of [1280,390]){
  await send('Emulation.setDeviceMetricsOverride',{width,height:720,deviceScaleFactor:1,mobile:false});
  for(const path of ['/','/pro/','/contra/','/re/','/para/','/non/']){
   await send('Page.navigate',{url:'http://localhost:8791'+path});
   await ready(`location.pathname===${JSON.stringify(path)}&&document.readyState==='complete'&&document.querySelector('h1')`);
   if(path==='/para/')await ready(`document.querySelector('#font-canvas')?.width>300`);
   if(path==='/contra/')await ready(`document.querySelector('#tabu-status')?.textContent.includes('2000')`);
   const state=await evaluate(`({path:location.pathname,width:innerWidth,scrollWidth:document.documentElement.scrollWidth,title:document.title,h1:document.querySelector('h1')?.textContent,cards:document.querySelectorAll('.corpus-card').length,icons:document.querySelectorAll('.pixel-card').length,status:document.querySelector('#font-status,#tabu-status')?.textContent,brokenImages:[...document.images].filter(i=>!i.complete||i.naturalWidth===0).map(i=>i.src)})`);
   report.pages.push(state);
   if(width===390||path==='/'){
    const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:0,y:0,width,height:720,scale:1}});
    await writeFile(`${output}/${path==='/'?'home':path.replaceAll('/','')}-${width}.png`,Buffer.from(shot.data,'base64'));
   }
   if(path==='/para/'&&width===390){
    await evaluate(`(()=>{const i=document.querySelector('#font-text');i.value='Ґґ Єє Іі Її ʼ ₴';i.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    report.interactions.push({fontUkrainian:await evaluate(`document.querySelector('#font-status').textContent`)});
    await evaluate(`(()=>{const i=document.querySelector('#font-text');i.value='🙂';i.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    report.interactions.push({fontMissing:await evaluate(`document.querySelector('#font-status').textContent`)});
    await evaluate(`document.querySelector('#umbrella-theme').click()`);
    report.interactions.push({themeAfterToggle:await evaluate(`document.documentElement.dataset.theme`)});
   }
   if(path==='/para/'&&width===390){await evaluate(`(()=>{const i=document.querySelector('#font-text');i.value='Ґґ Єє Іі Її ʼ ₴';i.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.font-lab').scrollIntoView()})()`);await evaluate(`new Promise(resolve=>setTimeout(resolve,350))`);const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:0,y:await evaluate('scrollY'),width:390,height:720,scale:1}});await writeFile(`${output}/font-390.png`,Buffer.from(shot.data,'base64'));}
   if(path==='/non/'&&width===390){await evaluate(`document.querySelector('.pixel-grid').scrollIntoView()`);const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:0,y:await evaluate('scrollY'),width:390,height:720,scale:1}});await writeFile(`${output}/icons-390.png`,Buffer.from(shot.data,'base64'));}
   if(path==='/contra/'&&width===390){
    await evaluate(`(()=>{const i=document.querySelector('#tabu-q');i.value='біда';i.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    await ready(`document.querySelector('#tabu-status').textContent!=='Знайдено 2000 · показано 60'`);
    report.interactions.push({dictionarySearch:await evaluate(`({status:document.querySelector('#tabu-status').textContent,url:location.search})`)});
    await evaluate(`document.querySelector('#view-graph').click()`);
    report.interactions.push({dictionaryGraph:await evaluate(`!document.querySelector('#graph-panel').hidden`)});
   }
  }
 }
 await send('Page.navigate',{url:'http://localhost:8791/pro/'});
 await ready(`location.pathname==='/pro/'&&document.readyState==='complete'&&document.querySelector('#q')`);
 await evaluate(`navigator.serviceWorker.ready.then(()=>true)`);
 await ready(`navigator.serviceWorker.controller!==null`);
 await send('Network.enable');
 await send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
 await send('Page.navigate',{url:'http://localhost:8791/pro/?q=%D1%85%D0%B0%D1%82%D0%B0'});
 await ready(`location.search.includes('q=')&&document.readyState==='complete'&&document.querySelector('#q')?.value==='хата'`);
 report.interactions.push({offlineApiProbe:await evaluate(`fetch('/api/v1/meta?probe='+Date.now(),{cache:'no-store'}).then(r=>({blocked:false,status:r.status})).catch(()=>({blocked:true}))`)});
 report.interactions.push({offlineProverbs:await evaluate(`({query:document.querySelector('#q').value,heading:document.querySelector('h1').textContent,online:navigator.onLine})`)});
 await send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
 await writeFile(new URL('../../docs/umbrella-browser.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
 if(report.pages.some(p=>p.scrollWidth>p.width)||report.exceptions.length||!report.interactions.some(i=>i.offlineApiProbe?.blocked))throw new Error('Browser verification failed');
 console.log(JSON.stringify({pages:report.pages.length,exceptions:report.exceptions,overflow:report.pages.filter(p=>p.scrollWidth>p.width),offlineApiBlocked:true}));
}finally{await send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});ws.close()}
