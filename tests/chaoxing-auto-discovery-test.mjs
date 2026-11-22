import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'cx-auto-discovery-'));
const urlFile = join(dir, 'url');
const navigationFile = join(dir, 'navigation');
writeFileSync(urlFile, 'https://mooc2-ans.chaoxing.com/mooc2-ans/mycourse/stu?courseid=111&clazzid=222&cpi=333&enc=abc123');
const config = join(dir,'courses.json');
writeFileSync(config, JSON.stringify({schemaVersion:1,cpi:'333',courses:[{courseId:'111',clazzId:'222',
  firstChapterId:'444',finalChapterId:'444',expectedTasks:1}]}));
const mock = join(dir,'mock-page.mjs');
writeFileSync(mock, `import {readFileSync,writeFileSync,appendFileSync} from 'node:fs';
const command=process.argv[2], url=readFileSync(process.env.MOCK_URL,'utf8');
if(command==='tabs') console.log(JSON.stringify([{id:66,title:'个人空间',url:'https://i.chaoxing.com/base'},{id:77,title:'学习通',url}]));
else if(command==='navigate') {
  const target=process.argv[3];
  appendFileSync(process.env.MOCK_NAV,target+'\\n');
  if(target.includes('/visit/stucoursemiddle'))
    writeFileSync(process.env.MOCK_URL,'https://mooc2-ans.chaoxing.com/mooc2-ans/mycourse/stu?courseid=111&clazzid=222&cpi=333&enc=abc123');
  else writeFileSync(process.env.MOCK_URL,target);
  console.log('navigated');
} else if(command==='eval') {
  const code=process.argv[3] || '';
  if(code.includes('firstExists:')) console.log(JSON.stringify({courseId:'111',enc:'def456',firstExists:true}));
  else if(code.includes('oldBox:')) console.log(JSON.stringify({oldBox:false,active:false,report:false,validPage:true,courseId:'111'}));
  else if(code.includes('cx-v3-status')) console.log(JSON.stringify({live:'',stored:''}));
  else if(code.includes('cx-v3-quiz-report')) console.log('');
  else console.log('null');
}`);
const child = spawn(process.execPath,[fileURLToPath(new URL('../chaoxing-auto.mjs',import.meta.url))],
  {env:{...process.env,CX_PAGE_BRIDGE:mock,CX_COURSE_CONFIG:config,CX_QUIZ_REPORT_DIR:join(dir,'reports'),
    CX_ANSWER_API_KEY_ENV:'FAKE_KEY',FAKE_KEY:'fake-only',MOCK_URL:urlFile,MOCK_NAV:navigationFile}});
let output='',errors='';
child.stdout.on('data',chunk => output+=chunk);
child.stderr.on('data',chunk => errors+=chunk);
try {
  await new Promise((resolve,reject) => {
    const timeout=setTimeout(() => {clearInterval(interval);
      reject(new Error(`startup timeout: ${output} ${errors}`));},15000);
    const interval=setInterval(() => {
      if(output.includes('"event":"started"')) {clearInterval(interval);clearTimeout(timeout);resolve();}
      if(errors) {clearInterval(interval);clearTimeout(timeout);reject(new Error(errors));}
    },100);
  });
  const navigation=readFileSync(navigationFile,'utf8');
  assert(navigation.includes('/mycourse/studentcourse'));
  assert(navigation.includes('/mycourse/studentstudy'));
  assert(navigation.includes('enc=def456'));
  console.log(JSON.stringify({autoDiscovery:'verified',controllerStarted:true}));
} finally {
  child.kill('SIGTERM');
  await new Promise(resolve => child.on('close',resolve));
}
import {fileURLToPath} from 'node:url';
