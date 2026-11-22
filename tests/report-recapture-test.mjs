import assert from 'node:assert/strict';
import {spawnSync,spawn} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
const dir=mkdtempSync(join(tmpdir(),'cx-recapture-')),mock=join(dir,'bridge.mjs'),marker=join(dir,'injected');
const script=fileURLToPath(new URL('../chaoxing-quiz-control.mjs',import.meta.url));
writeFileSync(mock,`import {writeFileSync} from 'node:fs';const code=process.argv[3] || '';
if(process.argv[2]==='tabs')console.log(JSON.stringify([{id:77,url:'https://mooc1.chaoxing.com/mycourse/studentstudy?courseId=11&chapterId=44'}]));
else if(code.includes('oldBox:'))console.log(JSON.stringify({oldBox:false,active:false,status:'stopped',report:true,validPage:true,courseId:'11'}));
else if(code.includes('学习通章节助手')){writeFileSync(process.env.TEST_MARKER,'yes');console.log('true');}
else if(code.includes('cx-v3-status'))console.log(JSON.stringify({live:'',stored:''}));
else if(code.includes('v3Active:'))console.log(JSON.stringify({chapterId:'44',v3Active:false,v3Status:'stopped'}));
else if(code.includes('try {const report=JSON.parse'))console.log('false');
else if(code.includes('cx-v3-quiz-report'))console.log(process.env.TEST_REPORT);
else console.log('true');`);
const report={schemaVersion:1,kind:'quiz',createdAt:'2026-01-01T00:00:00Z',id:'11:44:job',courseId:'11',chapterId:'44',jobId:'job',title:'Local',questions:[{index:1,type:'单选题',heading:'Local question',options:[]}],questionCount:1};
const env={...process.env,CX_PAGE_BRIDGE:mock,CX_QUIZ_REPORT_DIR:join(dir,'reports'),CX_QUIZ_POLL_MS:'100',TEST_MARKER:marker,TEST_REPORT:JSON.stringify(report)};
const run=()=>spawnSync(process.execPath,[script,'--once'],{env,encoding:'utf8',timeout:20000});
let result=run();assert.equal(result.status,0,result.stderr);const path=JSON.parse(result.stdout).report,original=readFileSync(path,'utf8');
report.createdAt='2026-02-01T00:00:00Z';env.TEST_REPORT=JSON.stringify(report);
result=run();assert.equal(result.status,0,result.stderr);assert.equal(readFileSync(path,'utf8'),original,'timestamp-only recapture must preserve approved answer hash');
const child=spawn(process.execPath,[script,'--start','--restart-page','--tab=77'],{env,stdio:['ignore','pipe','pipe','ipc']});
const closed=new Promise(resolve=>child.once('close',resolve));let output='';
try{
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error(output)),15000);child.stdout.on('data',chunk=>{output+=chunk;if(output.includes('"event":"started"')){clearTimeout(timer);resolve();}});});
 assert(existsSync(marker),'explicit resume must restart an inactive page script');
}finally{child.send({type:'cancel'},()=>{});const timer=setTimeout(()=>child.kill('SIGKILL'),7000);await closed;clearTimeout(timer);}
console.log('PASS: explicit resume restarts the page and unchanged recapture preserves human approval');
