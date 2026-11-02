const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {spawn}=require('node:child_process');
const {once}=require('node:events');
const {chromium}=require('playwright');
const appPath=path.resolve(__dirname,'../apps/productivity-tracker.html');
const launcherPath=path.resolve(__dirname,'../apps/hourly-launcher.py');
const vm=require('node:vm');
const script=fs.readFileSync(appPath,'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
const scope=vm.createContext({Intl,Date,Math,crypto:require('node:crypto').webcrypto});
vm.runInContext(script.split('globalThis.TrackerCore=TrackerCore;')[0]+';globalThis.core=TrackerCore;',scope);
const C=scope.core;
async function startServer(app){
 const code="import sys, importlib.util; sys.dont_write_bytecode=True; s=importlib.util.spec_from_file_location('hourly',sys.argv[1]); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); server=m.HourlyServer(sys.argv[2],port=0); print(server.origin,flush=True); server.serve_forever()";
 const child=spawn('python3',['-u','-c',code,launcherPath,app],{stdio:['ignore','pipe','pipe']});
 let stderr='';child.stderr.on('data',b=>stderr+=b);
 const url=await new Promise((resolve,reject)=>{child.stdout.once('data',b=>resolve(b.toString().trim()));child.once('error',reject);child.once('exit',c=>reject(Error(`Launcher exited ${c}: ${stderr}`)));});
 return {child,url};
}
async function stopServer(server){server.child.kill();await once(server.child,'exit');}
(async()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'hourly-browser-'));
 const app=path.join(tmp,'productivity-tracker.html');fs.copyFileSync(appPath,app);
 const c=C.create(new Date('2026-10-29T00:30:00.000Z'),'Asia/Kolkata');
 function fillDay(day,total){for(let i=0;i<20;i++){const score=Math.min(5,total);c.blocks[day*20+i].score=score;total-=score;}}
 [50,60,70,80].forEach((score,day)=>fillDay(day,score));c.blocks.slice(80,86).forEach(b=>b.score=3);
 const name=C.filename(c),csvPath=path.join(tmp,name);fs.writeFileSync(csvPath,C.serialize(c));
 const old=C.create(new Date('2026-10-20T00:30:00.000Z'),'Asia/Kolkata');old.status='ended';old.endedAt='2026-10-28T00:30:00.000Z';const oldPath=path.join(tmp,C.filename(old));fs.writeFileSync(oldPath,C.serialize(old));fs.utimesSync(oldPath,new Date('2030-01-01'),new Date('2030-01-01'));
 const server=await startServer(app);
 const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:1440,height:900},timezoneId:'Asia/Kolkata'});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.clock.install({time:new Date('2026-11-02T08:00:00.000Z')});
  await page.addInitScript(()=>{window.pickerCalls=0;window.showDirectoryPicker=async()=>{pickerCalls++;throw Error('Automatic startup must not open a picker.');};});
  await page.goto(server.url);await page.waitForFunction(()=>document.querySelector('#totalScore').textContent==='278'&&!document.querySelector('#newBtn').disabled);
  assert.equal(await page.title(),'Hourly · Productivity tracker');assert.equal(await page.locator('h1').textContent(),'Hourly');
  assert.equal(await page.evaluate(()=>pickerCalls),0);assert.equal(await page.locator('#dailyAverage').textContent(),'65');assert.ok((await page.locator('#averageDetail').textContent()).startsWith('4 completed days'));
  assert.ok((await page.locator('#folderLabel').textContent()).includes(name));assert.equal(fs.readdirSync(tmp).filter(x=>x.endsWith('.csv')).length,2);
  assert.equal(await page.locator('#boardBody tr:nth-child(7) th.row-selected').count(),1);assert.equal(await page.locator('#boardBody tr:nth-child(7) td.max.row-selected').count(),1);
  assert.equal(await page.locator('#boardBody tr:nth-child(8) th.row-current').count(),1);assert.equal(await page.locator('#boardBody tr:nth-child(8) td.max.row-current').count(),1);
  await page.screenshot({path:path.join(__dirname,'artifacts/hourly-preview.png'),fullPage:true});
  console.log('PASS: automatic adjacent-folder startup chooses latest stored challenge, with no picker');
  console.log('PASS: Hourly branding, four-card summary, completed-day average and matched row highlights');
  for(const [width,height] of [[1440,900],[1366,768],[1280,720],[1024,768],[390,844]]){
   await page.setViewportSize({width,height});const layout=await page.evaluate(()=>({doc:document.documentElement.scrollWidth,width:innerWidth,bottom:document.querySelector('.footer').getBoundingClientRect().bottom,height:innerHeight}));assert.equal(layout.doc,width);assert.ok(layout.bottom<height,JSON.stringify(layout));
  }
  await page.setViewportSize({width:1440,height:900});
  await page.locator('[data-score="0"]').click();await page.waitForFunction(()=>document.querySelector('#ratedCount').textContent==='87'&&document.querySelector('#saveText').textContent==='Saved to CSV');
  assert.equal(C.parse(fs.readFileSync(csvPath,'utf8')).blocks[86].score,0);assert.equal(await page.locator('#dailyAverage').textContent(),'65');
  await page.reload();await page.waitForFunction(()=>document.querySelector('#ratedCount').textContent==='87'&&!document.querySelector('#newBtn').disabled);assert.equal(await page.locator('#dailyAverage').textContent(),'65');assert.equal(await page.evaluate(()=>pickerCalls),0);
  console.log('PASS: automatic folder CSV saves persist to disk and survive reload');
  await page.evaluate(async()=>{const dir=await(await navigator.storage.getDirectory()).getDirectoryHandle('alternative',{create:true});window.showDirectoryPicker=async()=>{pickerCalls++;return dir;};});
  await page.locator('#folderBtn').click();await page.waitForFunction(()=>document.querySelector('#totalScore').textContent==='0'&&!document.querySelector('#newBtn').disabled);assert.equal(await page.locator('#dailyAverage').textContent(),'—');assert.equal(await page.locator('#defaultFolderBtn').isVisible(),true);
  await page.locator('#defaultFolderBtn').click();await page.waitForFunction(()=>document.querySelector('#totalScore').textContent==='278'&&!document.querySelector('#newBtn').disabled);assert.equal(await page.locator('#dailyAverage').textContent(),'65');
  console.log('PASS: Select folder overrides the default and Use app folder returns to adjacent CSVs');
  // Complete day five in the fixture except its final 1–2 AM cell, then test that final input.
  fillDay(4,69);c.blocks[99].score=null;fs.writeFileSync(csvPath,C.serialize(c));
  await page.clock.fastForward(12.5*60*60*1000);await page.reload();await page.waitForFunction(()=>document.querySelector('#ratingTitle').textContent==='2-Nov · 1AM – 2AM'&&!document.querySelector('[data-score="4"]').disabled);
  assert.equal(await page.locator('#dailyAverage').textContent(),'65');assert.equal(await page.locator('#boardBody tr:last-child th.row-selected').count(),1);assert.equal(await page.locator('#boardBody tr:last-child td.max.row-selected').count(),1);
  await page.locator('[data-score="4"]').click();await page.waitForFunction(()=>document.querySelector('#dailyAverage').textContent==='66');assert.ok((await page.locator('#averageDetail').textContent()).startsWith('5 completed days'));assert.equal(await page.locator('#todayScore').textContent(),'73');
  console.log('PASS: final after-midnight score adds day five to the average, floored to an integer');
  assert.deepEqual(errors,[]);
  // Independently verify empty default-folder creation; this never touches real app CSVs.
  const empty=path.join(tmp,'empty');fs.mkdirSync(empty);const emptyApp=path.join(empty,'productivity-tracker.html');fs.copyFileSync(appPath,emptyApp);const emptyServer=await startServer(emptyApp);
  try{
   const p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));await p.goto(emptyServer.url);await p.waitForFunction(()=>document.querySelector('#welcome').hidden&&!document.querySelector('#newBtn').disabled);
   const csvs=fs.readdirSync(empty).filter(n=>n.endsWith('.csv'));assert.equal(csvs.length,1);const blank=C.parse(fs.readFileSync(path.join(empty,csvs[0]),'utf8'));assert.equal(blank.blocks.length,200);assert.ok(blank.blocks.every(b=>b.score===null));assert.equal(await p.locator('#dailyAverage').textContent(),'—');await p.close();
   console.log('PASS: first open in an empty adjacent folder creates a blank 200-hour challenge');
  }finally{await stopServer(emptyServer);}
  assert.deepEqual(errors,[]);console.log('PASS: no browser JavaScript errors');
 }finally{await context.close();await browser.close();await stopServer(server);fs.rmSync(tmp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
