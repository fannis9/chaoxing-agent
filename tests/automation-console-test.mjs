import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const dir=mkdtempSync(join(tmpdir(),'cx-automation-console-')),mock=join(dir,'bridge.mjs'),online=join(dir,'online');
const course={courseId:'1',clazzId:'11',cpi:'99',name:'Fixture',status:'pending',firstChapterId:'101',finalChapterId:'102',expectedTasks:2};
writeFileSync(join(dir,'automation-queue.json'),JSON.stringify({schemaVersion:1,status:'ready',cpi:'99',courses:[course]}));
writeFileSync(join(dir,'automation-courses.json'),JSON.stringify({schemaVersion:1,autoDiscovered:true,cpi:'99',courses:[course]}));
writeFileSync(join(dir,'console-state.json'),JSON.stringify({mode:'stopped',model:{name:'Mock',id:'mock',baseUrl:'https://example.invalid',keyEnv:'TEST_KEY',protocol:'responses'},automation:{enabled:true,userPaused:false}}));
writeFileSync(mock,`import {existsSync} from 'node:fs';const code=process.argv[3] || '';
if(process.argv[2]==='tabs')console.log(JSON.stringify(existsSync(process.env.TEST_ONLINE)?[{id:77,url:'https://mooc1.chaoxing.com/mycourse/studentstudy?courseId=1&chapterId=101&cpi=99'}]:[]));
else if(code.includes('inspectAutomationReadiness'))console.log(JSON.stringify({requiresUser:false,courseId:'1'}));
else if(code.includes('oldBox:'))console.log(JSON.stringify({oldBox:false,active:true,status:'running',report:false,validPage:true,courseId:'1'}));
else if(code.includes('cx-v3-status'))console.log(JSON.stringify({live:JSON.stringify({schemaVersion:1,courseId:'1',chapterId:'101',active:true,status:'running',completed:[]}),stored:''}));
else if(code.includes('stop()') || code==='!window.__cxV3?.active')console.log('true');
else if(code.includes('cx-v3-quiz-report'))console.log('');
else console.log('null');`);
let child,closed,url,headers;
async function start(){
 child=spawn(process.execPath,[fileURLToPath(new URL('../chaoxing-console.mjs',import.meta.url))],{env:{...process.env,CX_CONSOLE_PORT:'0',CX_QUIZ_REPORT_DIR:dir,CX_PAGE_BRIDGE:mock,CX_AUTOMATION:'1',TEST_KEY:'test-only',TEST_ONLINE:online},stdio:['ignore','pipe','pipe']});
 closed=new Promise(r=>child.once('close',r));let text='';
 const port=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error(text)),10000);child.stdout.on('data',chunk=>{text+=chunk;const m=text.match(/127\.0\.0\.1:(\d+)/);if(m){clearTimeout(timer);resolve(m[1]);}});child.stderr.on('data',chunk=>text+=chunk);});
 url=`http://127.0.0.1:${port}`;headers={'X-CX-Console':'1',Authorization:'Bearer '+readFileSync(join(dir,'console-token'),'utf8'),'Content-Type':'application/json'};
}
const status=async()=>await(await fetch(url+'/status',{headers})).json();
async function until(predicate,timeout=15000){const deadline=Date.now()+timeout;let s;do{s=await status();if(predicate(s))return s;await new Promise(r=>setTimeout(r,100));}while(Date.now()<deadline);throw new Error(JSON.stringify({mode:s.mode,automation:s.automation,error:s.error}));}
async function control(action){const r=await fetch(url+'/control',{method:'POST',headers,body:JSON.stringify({action,tab:77})});assert.equal(r.status,200);return r.json();}
try{
 await start();await until(s=>s.automation.status==='waiting-login');
 writeFileSync(online,'1');await until(s=>s.mode==='running' && s.event?.event==='progress',20000);
 await control('pause');const paused=await status();assert.equal(paused.automation.userPaused,true);assert.equal(paused.pid,null);
 const toggle=await fetch(url+'/auto-answer',{method:'POST',headers,body:JSON.stringify({enabled:false})});assert.equal(toggle.status,200);
 assert.equal((await status()).autoAnswer,false);assert.equal((await status()).pid,null);
 child.kill();await closed;
 await start();await new Promise(r=>setTimeout(r,500));const restored=await status();assert.equal(restored.automation.userPaused,true);assert.equal(restored.pid,null);
 assert.equal(restored.autoAnswer,false);
 await control('resume');await until(s=>s.mode==='running' && s.pid);await control('pause');
 console.log('PASS: real console waits for login, launches queue automatically, persists pause across restart, resumes explicitly');
}finally{if(child){child.kill();await closed;}}
