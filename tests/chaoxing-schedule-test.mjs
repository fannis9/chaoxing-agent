import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'cx-schedule-'));
const urlFile = join(dir, 'url');
const out = join(dir, 'reports');
const config = join(dir, 'courses.json');
writeFileSync(config, JSON.stringify({schemaVersion:1,cpi:'9',courses:[
  {key:'first',name:'Fixture A',courseId:'111111',clazzId:'11',firstChapterId:'1001',finalChapterId:'1002',expectedTasks:2},
  {key:'second',name:'Fixture B',courseId:'222222',clazzId:'22',firstChapterId:'2001',finalChapterId:'2002',expectedTasks:3},
]}));
const mock = join(dir, 'page.mjs');
writeFileSync(urlFile, 'https://mooc1.chaoxing.com/mycourse/studentstudy?chapterId=1002&courseId=111111');
mkdirSync(out);
writeFileSync(join(out,'schedule.json'),JSON.stringify({schemaVersion:1,tab:'old-tab',
  index:0,status:'running',completed:[]}));
writeFileSync(mock, `import {readFileSync,writeFileSync} from 'node:fs';
const file = process.env.MOCK_URL_FILE;
const url = () => readFileSync(file,'utf8');
const [command,arg] = process.argv.slice(2);
if (command === 'tabs') console.log('* [77] test  '+url());
if (command === 'navigate') {
  let next=arg;
  if (next.includes('/visit/stucoursemiddle')) {
    const p=new URL(next).searchParams;
    next='https://mooc2-ans.chaoxing.com/mooc2-ans/mycourse/stu?courseid='+p.get('courseid')+'&enc=abc123';
  }
  writeFileSync(file,next); console.log('ok');
}
if (command === 'eval') {
  const u=new URL(url());
  if (arg.includes('oldBox:')) console.log(JSON.stringify({oldBox:false,active:u.searchParams.get('courseId')==='111111',status:'course-boundary',report:false,courseId:u.searchParams.get('courseId'),validPage:true}));
  else if (arg.includes('cx-v3-status')) console.log(JSON.stringify({live:u.searchParams.get('courseId')==='111111' ? JSON.stringify({schemaVersion:1,runId:'test',courseId:'111111',chapterId:'1002',status:'course-boundary',active:false,completed:[{chapterId:'1002',tasks:1}]}) : '',stored:''}));
  else if (arg.includes('matches =')) {
    const cid=u.searchParams.get('courseid');
    console.log(JSON.stringify({courseId:cid,path:u.pathname,progress:[{done:cid==='111111'?2:0,total:cid==='111111'?2:3}],enc:'abc123',firstExists:true,finalExists:true}));
  } else if (arg.includes('cx-v3-quiz-report')) console.log('');
  else console.log('null');
}
`);
const child = spawn(process.execPath, [new URL('../chaoxing-quiz-control.mjs', import.meta.url).pathname,
  '--start','--schedule','--tab=77'], {env:{...process.env,CX_PAGE_BRIDGE:mock,
    CX_QUIZ_REPORT_DIR:out,CX_COURSE_CONFIG:config,CX_QUIZ_POLL_MS:'100',MOCK_URL_FILE:urlFile}});
let output = '';
const result = await new Promise((resolve, reject) => {
  const timer=setTimeout(()=>reject(new Error(`schedule timeout: ${output}`)),10000);
  child.stdout.on('data',chunk=>{
    output+=chunk;
    if (output.includes('"event":"course-switched"')) {clearTimeout(timer);resolve(output);}
  });
  child.stderr.on('data',chunk=>{output+=chunk;});
  child.on('close',code=>{clearTimeout(timer);reject(new Error(`exited ${code}: ${output}`));});
}).finally(()=>child.kill());
const state=JSON.parse(readFileSync(join(out,'schedule.json'),'utf8'));
assert.equal(state.index,1);
assert.equal(state.status,'running');
assert.deepEqual(state.completed.map(item=>item.courseId),['111111']);
assert(readFileSync(urlFile,'utf8').includes('courseId=222222'));
assert(result.includes('"event":"course-switched"'));
console.log('schedule transition verified');
