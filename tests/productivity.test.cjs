const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'../apps/productivity-tracker.html'),'utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
const ctx=vm.createContext({Intl,Date,Math,crypto:require('node:crypto').webcrypto});
vm.runInContext(script.split('globalThis.TrackerCore=TrackerCore;')[0]+';globalThis.core=TrackerCore;',ctx);
const C=ctx.core;
const make=()=>C.create(new Date('2026-10-25T00:30:00.000Z'),'Asia/Kolkata');
const at=s=>new Date(s);
test('10 dates contain 200 blocks with daily max 100 and challenge max 1000',()=>{
 const c=make();assert.equal(c.startDate,'2026-10-25');assert.equal(c.version,'2');assert.equal(c.blocks.length,200);
 assert.equal(c.blocks[0].start,'06:00');assert.equal(c.blocks[199].date,'2026-11-03');assert.equal(c.blocks[199].start,'01:00');assert.equal(c.blocks[199].end,'02:00');
 c.blocks.forEach(b=>b.score=5);const t=C.totals(c);assert.equal(t.total,1000);assert.equal(t.rated,200);assert.ok(t.daily.every(x=>x===100));assert.equal(t.running[20],5);
});
test('day-two 9:15 queues 6–7, 7–8, 8–9; a zero resolves its hour',()=>{
 const c=make();c.blocks.slice(0,20).forEach(b=>b.score=4);const n=at('2026-10-26T03:45:00.000Z');assert.equal(Array.from(C.pending(c,n)).join(','),'20,21,22');
 c.blocks[20].score=5;c.blocks[21].score=0;assert.equal(C.pending(c,n)[0],22);assert.equal(C.totals(c).rated,22);c.blocks[22].score=3;assert.equal(C.pending(c,n).length,0);assert.equal(C.pending(c,at('2026-10-26T04:30:00.000Z'))[0],23);
});
test('first rating is due at exactly 7 AM',()=>{
 const c=make();assert.equal(C.pending(c,at('2026-10-25T01:29:59.999Z')).length,0);assert.equal(C.pending(c,at('2026-10-25T01:30:00.000Z')).length,1);
});
test('midnight and 1 AM blocks belong to the prior tracking date, not a new column',()=>{
 const c=make();assert.equal(c.blocks[17].date,'2026-10-25');assert.equal(c.blocks[17].start,'23:00');assert.equal(c.blocks[17].end,'00:00');
 assert.equal(C.bounds(c.blocks[17],c).endKey,'2026-10-26T00:00');assert.equal(C.bounds(c.blocks[18],c).startKey,'2026-10-26T00:00');assert.equal(C.bounds(c.blocks[19],c).endKey,'2026-10-26T02:00');
 assert.equal(C.pending(c,at('2026-10-25T18:29:59.999Z')).length,17);assert.equal(C.pending(c,at('2026-10-25T18:30:00.000Z')).length,18);assert.equal(C.pending(c,at('2026-10-25T19:30:00.000Z')).length,19);assert.equal(C.pending(c,at('2026-10-25T20:30:00.000Z')).length,20);
 assert.equal(C.trackingDate(c,at('2026-10-25T19:45:00.000Z')),'2026-10-25');assert.equal(C.trackingDate(c,at('2026-10-26T00:30:00.000Z')),'2026-10-26');
});
test('last challenge block ends at 2 AM after the tenth date; 2–6 AM adds no blocks',()=>{
 const c=make();assert.equal(C.bounds(c.blocks[199],c).endKey,'2026-11-04T02:00');assert.equal(C.pending(c,at('2026-11-03T20:29:59.999Z')).length,199);assert.equal(C.pending(c,at('2026-11-03T20:30:00.000Z')).length,200);
 assert.equal(C.pending(c,at('2026-10-25T23:30:00.000Z')).length,20);assert.equal(C.pending(c,at('2026-10-26T00:30:00.000Z')).length,20);
});
test('Max is the best recorded running total per row, never the theoretical limit',()=>{
 const c=make();assert.ok(C.totals(c).rowMax.every(x=>x===0));c.blocks[0].score=2;c.blocks[1].score=4;c.blocks[20].score=5;c.blocks[21].score=0;
 let t=C.totals(c);assert.equal(t.rowMax[0],5);assert.equal(t.rowMax[1],6);assert.equal(t.maxDaily,6);c.blocks[21].score=5;t=C.totals(c);assert.equal(t.rowMax[1],10);assert.equal(t.maxDaily,10);
 // Corrections recompute the actual maximum across the dates.
 c.blocks[21].score=0;assert.equal(C.totals(c).rowMax[1],6);
});
test('reminder slots are every five minutes and stop when pending hours are rated',()=>{
 const c=make();assert.equal(C.alarmSlot(c,at('2026-10-25T01:29:59.999Z')),null);
 assert.equal(C.alarmSlot(c,at('2026-10-25T01:30:00.000Z')),'2026-10-25T07:00');assert.equal(C.alarmSlot(c,at('2026-10-25T01:34:59.000Z')),'2026-10-25T07:00');assert.equal(C.alarmSlot(c,at('2026-10-25T01:35:00.000Z')),'2026-10-25T07:05');assert.equal(C.alarmSlot(c,at('2026-10-25T01:40:00.000Z')),'2026-10-25T07:10');
 c.blocks[0].score=0;assert.equal(C.alarmSlot(c,at('2026-10-25T01:45:00.000Z')),null);assert.equal(C.alarmSlot(c,at('2026-10-25T02:30:00.000Z')),'2026-10-25T08:00');c.status='ended';assert.equal(C.alarmSlot(c,at('2026-10-25T02:35:00.000Z')),null);
});
test('timezone boundaries remain correct across a daylight-saving change',()=>{
 const c=C.create(at('2026-10-31T10:00:00.000Z'),'America/New_York');assert.equal(C.pending(c,at('2026-11-01T06:30:00.000Z')).length,19);assert.equal(C.pending(c,at('2026-11-01T07:00:00.000Z')).length,20);
});
test('CSV round trip preserves 0 versus blanks and after-midnight blocks',()=>{
 const c=make();c.blocks[0].score=0;c.blocks[0].ratedAt='2026-10-25T01:30:01.000Z';c.blocks[19].score=5;c.revision=3;const text=C.serialize(c);const parsed=C.parse(text);
 assert.equal(C.serialize(parsed),text);assert.equal(parsed.blocks[0].score,0);assert.equal(parsed.blocks[1].score,null);assert.equal(C.serialize(C.parse('\uFEFF'+text)),text);const rows=C.csvRows('a,"b,b","c""d"\r\n');assert.equal(rows[0][1],'b,b');assert.equal(rows[0][2],'c"d');
});
test('CSV importer rejects bad scores, duplicate and missing blocks, invalid times and metadata',()=>{
 const c=make(),text=C.serialize(c),lines=text.trim().split('\r\n');const score=lines.slice(),r=score[1].split(',');r[11]='6';score[1]=r.join(',');assert.throws(()=>C.parse(score.join('\r\n')),/Scores/);
 const dupe=lines.slice();dupe[2]=dupe[1];assert.throws(()=>C.parse(dupe.join('\r\n')),/duplicate/);assert.throws(()=>C.parse(lines.slice(0,-1).join('\r\n')),/200/);assert.throws(()=>C.parse(text.replace('Asia/Kolkata','Not/AZone')),/timezone/);assert.throws(()=>C.parse(text.replace('2026-10-25T00:30:00.000Z','2026-02-30T00:30:00.000Z')),/dates/);assert.throws(()=>C.parse(text.replace(',23:00,00:00,',',23:00,24:00,')),/hour blocks/);
});
test('original version-one 15-day CSVs keep their dates, schedule and scores',()=>{
 const c=make();c.version='1';c.blocks=Array.from({length:240},(_,i)=>({date:C.addDays(c.startDate,Math.floor(i/16)),start:`${String(7+i%16).padStart(2,'0')}:00`,end:`${String(8+i%16).padStart(2,'0')}:00`,score:i===0?4:null,ratedAt:''}));const text=C.serialize(c),old=C.parse(text);
 assert.equal(C.serialize(old),text);assert.equal(C.schedule(old).days,15);assert.equal(C.schedule(old).hours,16);assert.equal(C.schedule(old).totalMax,1200);assert.equal(old.blocks[0].score,4);assert.equal(C.pending(old,at('2026-10-25T02:30:00.000Z')).length,0);assert.equal(C.pending(old,at('2026-10-25T03:30:00.000Z'))[0],1);
});
test('latest challenge uses creation time and new files have distinct names',()=>{
 const a={challenge:make(),modified:100},b={challenge:C.create(at('2026-10-25T00:30:01.000Z'),'Asia/Kolkata'),modified:1};assert.equal(C.latest([a,b])[0],b);assert.notEqual(C.filename(a.challenge),C.filename(b.challenge));
});
test('running daily average excludes incomplete days and floors decimal results',()=>{
 const c=make();
 function fill(day,total){for(let h=0;h<20;h++){const score=Math.min(5,total);c.blocks[day*20+h].score=score;total-=score;}}
 [50,60,70,80].forEach((total,day)=>fill(day,total));
 const afternoon=at('2026-10-29T08:00:00.000Z');
 assert.equal(C.dailyAverage(c,afternoon).value,65);assert.equal(C.dailyAverage(c,afternoon).completedDays,4);
 fill(4,73);c.blocks[99].score=null;
 assert.equal(C.dailyAverage(c,at('2026-10-29T20:30:00.000Z')).value,65);
 c.blocks[99].score=0;
 assert.equal(C.dailyAverage(c,at('2026-10-29T20:29:59.999Z')).completedDays,4);
 assert.equal(C.dailyAverage(c,at('2026-10-29T20:30:00.000Z')).value,66);
 assert.equal(C.dailyAverage(c,at('2026-10-29T20:30:00.000Z')).completedDays,5);
 c.blocks[0].score=null;
 assert.equal(C.dailyAverage(c,at('2026-10-30T08:00:00.000Z')).completedDays,4);
});
test('average distinguishes no complete days from a completed zero-point day',()=>{
 const c=make();assert.equal(C.dailyAverage(c,at('2026-10-26T04:00:00.000Z')).value,null);
 c.blocks.slice(0,20).forEach(b=>b.score=0);
 assert.equal(C.dailyAverage(c,at('2026-10-26T04:00:00.000Z')).value,0);
 assert.equal(C.dailyAverage(c,at('2026-10-26T04:00:00.000Z')).completedDays,1);
});
