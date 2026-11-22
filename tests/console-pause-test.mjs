import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync,existsSync,unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const dir=mkdtempSync(join(tmpdir(),'cx-pause-'));
const mock=join(dir,'bridge.mjs'), marker=join(dir,'started'), mutation=join(dir,'mutation'), failStop=join(dir,'fail-stop');
writeFileSync(mock,`import {writeFileSync,existsSync} from 'node:fs';
const code=process.argv[3] || '';
if(process.argv[2]==='tabs') console.log(JSON.stringify([{id:77,url:'https://mooc1.chaoxing.com/mycourse/studentstudy?chapterId=1'}]));
else if(code.includes('oldBox:')) {
  if(existsSync(process.env.TEST_INCIDENT)){console.log(JSON.stringify({oldBox:false,active:true,status:'running',validPage:true}));process.exit(0);}
  writeFileSync(process.env.TEST_STARTED,'1');
  process.on('message',message=>{if(message.type==='cancel')process.exit(0)});
  setTimeout(()=>{writeFileSync(process.env.TEST_MUTATION,'unsafe');console.log('{}');process.disconnect();},15000);
} else if(code.includes('stop()')) {
  if(existsSync(process.env.TEST_FAIL_STOP)){console.error('browser disconnected');process.exitCode=1;}
  else console.log('true');
} else if(code.includes('cx-v3-status') && existsSync(process.env.TEST_INCIDENT))console.log(JSON.stringify({live:JSON.stringify({schemaVersion:1,courseId:'1',chapterId:'1',active:false,status:'needs-review',incident:{message:'local incident',at:'2026-01-01'},lastLog:[]}),stored:''}));
else if(code==='!window.__cxV3?.active')console.log('true');
else console.log('null');`);
const child=spawn(process.execPath,[fileURLToPath(new URL('../chaoxing-console.mjs',import.meta.url))],
 {env:{...process.env,CX_CONSOLE_PORT:'0',CX_QUIZ_REPORT_DIR:dir,CX_PAGE_BRIDGE:mock,
   OPENAI_API_KEY:'test-only',TEST_INCIDENT:join(dir,'incident'),TEST_STARTED:marker,TEST_MUTATION:mutation,TEST_FAIL_STOP:failStop},stdio:['ignore','pipe','pipe']});
const exited=new Promise(resolve=>child.once('exit',resolve));
let stdout='';
try {
 const port=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('startup timeout')),10000);
   child.stdout.on('data',chunk=>{stdout+=chunk;const match=stdout.match(/127\.0\.0\.1:(\d+)/);if(match){clearTimeout(timer);resolve(match[1]);}});});
 const headers={'X-CX-Console':'1',Authorization:`Bearer ${readFileSync(join(dir,'console-token'),'utf8')}`,'Content-Type':'application/json'};
 const call=async(action,tab)=>{const result=await fetch(`http://127.0.0.1:${port}/control`,{method:'POST',headers,body:JSON.stringify({action,tab})});return {status:result.status,...await result.json()};};
 assert.equal((await call('start',77)).status,200);
 const deadline=Date.now()+10000;
 while(!existsSync(marker) && Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,50));
 assert(existsSync(marker),'controller must have an active child before pause');
 const result=await call('pause');
 assert.equal(result.mode,'paused');
 const status=await (await fetch(`http://127.0.0.1:${port}/status`,{headers})).json();
 assert.equal(status.pid,null);
 assert.equal(String(status.targetTab),'77');
 assert(!existsSync(mutation),'cancelled operation must not mutate');
 writeFileSync(failStop,'1');
 assert.equal((await call('stop')).mode,'needs-review','unconfirmed browser stop must not report stopped');
 unlinkSync(failStop);writeFileSync(join(dir,'incident'),'1');
 assert.equal((await call('start',77)).status,200);
 let incidentStatus;const incidentDeadline=Date.now()+12000;
 do {await new Promise(resolve=>setTimeout(resolve,100));incidentStatus=await(await fetch(`http://127.0.0.1:${port}/status`,{headers})).json();}
 while((incidentStatus.mode!=='needs-review' || incidentStatus.pid!==null) && Date.now()<incidentDeadline);
 assert.equal(incidentStatus.mode,'needs-review','page incident must stop being shown as running');
 assert.equal(incidentStatus.pid,null,'page incident must stop the scheduler');
 console.log('PASS: pause cancels active controller work, retains target and reports stop failure');
} finally {child.kill();await exited;}
