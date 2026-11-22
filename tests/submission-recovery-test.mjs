import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {QuizJournal} from '../lib/quiz-journal.mjs';
const report={schemaVersion:1,kind:'quiz',id:'11:44:job',courseId:'11',chapterId:'44',jobId:'job',title:'Local recovery',questionCount:1,
  questions:[{index:1,questionId:'123',type:'单选题',heading:'Local test',text:'Local test',options:[{label:'A',value:'A',text:'Yes'}],control:{kind:'choice',answerFieldId:'answer123'},captureIssues:[]}]};
for(const completed of [false,true]){
 const dir=mkdtempSync(join(tmpdir(),'cx-submission-recovery-')),mock=join(dir,'bridge.mjs'),actions=join(dir,'actions');
 new QuizJournal(dir).write(report.id,'submitting',{tab:'77'});
 writeFileSync(mock,`import {appendFileSync} from 'node:fs';
 const code=process.argv[3] || '';
 if(process.argv[2]==='tabs')console.log(JSON.stringify([{id:77,url:'https://mooc1.chaoxing.com/mycourse/studentstudy?courseId=11&chapterId=44'}]));
 else if(code.includes('oldBox:'))console.log(JSON.stringify({oldBox:false,active:true,status:'waiting-quiz',report:true,validPage:true,courseId:'11'}));
 else if(code.includes('function submitQuiz')){
   const phase=code.match(/"phase":"([^"]+)"/)?.[1];
   if(phase!=='status')appendFileSync(process.env.TEST_ACTIONS,phase+'\\n');
   console.log(JSON.stringify({ok:true,completed:process.env.TEST_COMPLETED==='true'}));
 }else if(code.includes('v3Active:'))console.log(JSON.stringify({chapterId:'44',v3Active:true,v3Status:'waiting-quiz',work:{id:'job',complete:false}}));
 else if(code.includes('cx-v3-status'))console.log(JSON.stringify({live:'',stored:''}));
 else if(code.includes('cx-v3-quiz-report'))console.log(process.env.TEST_REPORT);
 else console.log('true');`);
 const child=spawn(process.execPath,[fileURLToPath(new URL('../chaoxing-auto.mjs',import.meta.url)),'--tab=77'],{
   env:{...process.env,CX_PAGE_BRIDGE:mock,CX_QUIZ_REPORT_DIR:dir,CX_COURSE_CONFIG:join(dir,'absent.json'),CX_QUIZ_POLL_MS:'100',
     CX_ANSWER_API_KEY_ENV:'TEST_MODEL_KEY',TEST_MODEL_KEY:'test-only',TEST_REPORT:JSON.stringify(report),TEST_COMPLETED:String(completed),TEST_ACTIONS:actions},
   stdio:['ignore','pipe','pipe','ipc']});
 let output='',errors='';
 const closed=new Promise(resolve=>child.once('close',resolve));
 try{
   await new Promise((resolve,reject)=>{
     const timer=setTimeout(()=>reject(new Error(`recovery timeout: ${output} ${errors}`)),20000);
     child.stdout.on('data',chunk=>{output+=chunk;const expected=completed?'"event":"quiz-submitted"':'"event":"needs-review"';
       if(output.includes(expected)){clearTimeout(timer);resolve();}});
     child.stderr.on('data',chunk=>errors+=chunk);
     child.once('error',reject);
   });
   assert(!existsSync(actions) || !readFileSync(actions,'utf8').trim(),'recovery must never click open/confirm');
   assert.equal(new QuizJournal(dir).read(report.id).phase,completed?'submitted':'submitting');
 }finally{
   child.send({type:'cancel'},()=>{});const timer=setTimeout(()=>child.kill('SIGKILL'),7000);
   await closed;clearTimeout(timer);
 }
}
console.log('PASS: interrupted submission verifies platform evidence without repeating submission');
