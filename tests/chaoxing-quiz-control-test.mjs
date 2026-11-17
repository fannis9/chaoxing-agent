import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'cx-quiz-control-'));
const mock = join(dir, 'mock-page.mjs');
writeFileSync(mock, `import { existsSync, writeFileSync } from 'node:fs';
if (process.argv[2] === 'tabs')
  console.log('* [77] 学生学习页面  ' +
    (process.env.MOCK_TAB_URL || 'https://mooc1.chaoxing.com/mycourse/studentstudy?chapterId=1'));
else if (process.argv[2] === 'eval') {
  const code = process.argv[3] || '';
  if (code.includes('oldBox:')) console.log(JSON.stringify({oldBox:false,active:false,status:'',report:false,validPage:true}));
  else if (code.includes('v3Active:window.__cxV3')) console.log(JSON.stringify({chapterId:'chapter',
    v3Active:false,v3Status:'',work:{id:'job',complete:existsSync(process.env.MOCK_RELOADED || '')}}));
  else if (code.includes('location.reload()')) { writeFileSync(process.env.MOCK_RELOADED, 'yes'); console.log('reloading'); }
  else if (code.includes('学习通章节助手')) { writeFileSync(process.env.MOCK_INJECTED, 'yes', {flag:'a'}); console.log('null'); }
  else if (code.includes('cx-v3-status')) {
    if (process.env.MOCK_RUNTIME_ONCE) {
      if (existsSync(process.env.MOCK_RUNTIME_ONCE))
        console.log(JSON.stringify({live:'',stored:process.env.MOCK_RUNTIME || ''}));
      else {
        writeFileSync(process.env.MOCK_RUNTIME_ONCE, 'yes');
        console.log(JSON.stringify({live:process.env.MOCK_RUNTIME || '',stored:''}));
      }
    } else console.log(JSON.stringify({live:process.env.MOCK_RUNTIME || '', stored:''}));
  }
  else if (code.includes('cx-v3-logbox')) console.log('cleared');
  else {
    if (process.env.MOCK_REPORT_ONCE) {
      if (existsSync(process.env.MOCK_REPORT_ONCE)) console.log('');
      else { writeFileSync(process.env.MOCK_REPORT_ONCE, 'yes'); console.log(process.env.MOCK_REPORT); }
    } else console.log(process.env.MOCK_REPORT);
  }
}
`);
const report = {
  schemaVersion:1, kind:'quiz', id:'course:chapter:job', courseId:'course', chapterId:'chapter', jobId:'job',
  title:'章节测验', questionCount:1, fontDataUrl:'',
  questions:[{index:1,type:'单选题',heading:'测试题干',fontObfuscated:false,
    options:[{label:'A',text:'选项甲'},{label:'B',text:'选项乙'}],images:[]}],
};
const result = spawnSync(process.execPath,
  [new URL('../chaoxing-quiz-control.mjs', import.meta.url).pathname, '--once'],
  {encoding:'utf8', timeout:30000, env:{...process.env, CX_PAGE_BRIDGE:mock,
    CX_QUIZ_REPORT_DIR:join(dir,'reports'), MOCK_REPORT:JSON.stringify(report)}});
assert.equal(result.status, 0, result.stderr);
const event = JSON.parse(result.stdout.trim());
assert.equal(event.event, 'quiz');
assert.equal(event.questionCount, 1);
assert(existsSync(event.report));
assert(existsSync(event.html));
assert(existsSync(event.preview));
assert(readFileSync(event.html,'utf8').includes('测试题干'));
console.log(JSON.stringify({event:event.event, questions:event.questionCount,
  report:event.report, preview:event.preview}));

const incidentDir = join(dir, 'incident-reports');
const runtime = {schemaVersion:1,runId:'local-run',courseId:'course',chapterId:'chapter',
  status:'needs-review',active:false,completed:[{chapterId:'first',tasks:2}],
  incident:{message:'平台状态冲突',at:new Date().toISOString()},lastLog:['已停止']};
const persisted = spawnSync(process.execPath,
  [new URL('../chaoxing-quiz-control.mjs', import.meta.url).pathname, '--once'],
  {encoding:'utf8', timeout:30000, env:{...process.env, CX_PAGE_BRIDGE:mock,
    CX_QUIZ_REPORT_DIR:incidentDir, MOCK_REPORT:JSON.stringify(report), MOCK_RUNTIME:JSON.stringify(runtime)}});
assert.equal(persisted.status, 0, persisted.stderr);
const records = persisted.stdout.trim().split('\n').map(line => JSON.parse(line));
const incident = records.find(record => record.event === 'incident');
assert(incident?.path && existsSync(incident.path));
const runtimePath = join(incidentDir, 'runtime.json');
assert.equal(JSON.parse(readFileSync(runtimePath, 'utf8')).status, 'needs-review');
assert.equal(statSync(runtimePath).mode & 0o777, 0o600);
const status = spawnSync(process.execPath,
  [new URL('../chaoxing-quiz-control.mjs', import.meta.url).pathname, '--status'],
  {encoding:'utf8', env:{...process.env, CX_QUIZ_REPORT_DIR:incidentDir}});
assert.equal(JSON.parse(status.stdout).incident.message, '平台状态冲突');
console.log(JSON.stringify({durableStatus:true, incident:true}));

const navigationDir = join(dir, 'navigation-reports');
const navigation = spawnSync(process.execPath,
  [new URL('../chaoxing-quiz-control.mjs', import.meta.url).pathname, '--once', '--tab=77'],
  {encoding:'utf8', timeout:30000, env:{...process.env, CX_PAGE_BRIDGE:mock,
    CX_QUIZ_REPORT_DIR:navigationDir, MOCK_TAB_URL:'https://i.chaoxing.com/space/index'}});
assert.equal(navigation.status, 0, navigation.stderr);
const navigationEvent = JSON.parse(navigation.stdout.trim());
assert.equal(navigationEvent.event, 'incident');
assert.equal(navigationEvent.kind, 'navigation');
assert(existsSync(navigationEvent.path));
console.log(JSON.stringify({navigationIncident:true}));

const injected = join(dir, 'injected');
const child = spawn(process.execPath,
  [new URL('../chaoxing-quiz-control.mjs', import.meta.url).pathname, '--start'],
  {env:{...process.env, CX_PAGE_BRIDGE:mock, CX_QUIZ_REPORT_DIR:join(dir,'reports'),
    MOCK_REPORT:JSON.stringify(report), MOCK_INJECTED:injected}});
let output = '';
const gotReport = new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error(`watcher timeout: ${output}`)), 15000);
  child.stdout.on('data', chunk => {
    output += chunk.toString();
    if (output.includes('"event":"quiz"')) { clearTimeout(timeout); resolve(); }
  });
  child.on('error', reject);
  child.on('exit', code => {
    if (!output.includes('"event":"quiz"')) reject(new Error(`watcher exited ${code}: ${output}`));
  });
});
try {
  await gotReport;
  assert(output.includes('"event":"watching"'));
  assert(output.includes('"event":"started"'));
  assert(existsSync(injected));
  console.log(JSON.stringify({startAndWatch:true, events:output.trim().split('\n').length}));
} finally {
  child.kill('SIGTERM');
  if (child.exitCode === null) await new Promise(resolve => child.once('exit', resolve));
}

const resumeInjected = join(dir, 'resume-injected');
const reloaded = join(dir, 'reloaded');
const resume = spawnSync(process.execPath,
  [new URL('../chaoxing-quiz-control.mjs', import.meta.url).pathname, '--resume'],
  {encoding:'utf8', timeout:30000, env:{...process.env, CX_PAGE_BRIDGE:mock,
    CX_QUIZ_REPORT_DIR:join(dir,'reports'), MOCK_REPORT:JSON.stringify(report),
    MOCK_INJECTED:resumeInjected, MOCK_RELOADED:reloaded}});
assert.equal(resume.status, 0, resume.stderr);
assert(existsSync(reloaded));
assert(existsSync(resumeInjected));
assert(resume.stdout.includes('"event":"resumed"'));
assert(resume.stdout.includes('"verified":true'));
console.log(JSON.stringify({refreshAndResume:true}));

const autoDir = join(dir, 'auto-reports');
const autoInjected = join(dir, 'auto-injected');
const reportOnce = join(dir, 'report-read');
const auto = spawn(process.execPath,
  [new URL('../chaoxing-quiz-control.mjs', import.meta.url).pathname, '--start'],
  {env:{...process.env, CX_PAGE_BRIDGE:mock, CX_QUIZ_REPORT_DIR:autoDir,
    CX_QUIZ_POLL_MS:'100', MOCK_REPORT:JSON.stringify(report),
    MOCK_REPORT_ONCE:reportOnce, MOCK_INJECTED:autoInjected, MOCK_RELOADED:reloaded}});
let autoOutput = '';
const recovered = new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error(`recovery timeout: ${autoOutput}`)), 15000);
  auto.stdout.on('data', chunk => {
    autoOutput += chunk.toString();
    if (autoOutput.includes('"event":"recovered"')) { clearTimeout(timeout); resolve(); }
  });
  auto.on('error', reject);
  auto.on('exit', code => {
    if (!autoOutput.includes('"event":"recovered"')) reject(new Error(`auto watcher exited ${code}: ${autoOutput}`));
  });
});
try {
  await recovered;
  assert(autoOutput.includes('"event":"quiz"'));
  assert.equal(readFileSync(autoInjected, 'utf8'), 'yesyes');
  console.log(JSON.stringify({reloadRecovery:true}));
} finally {
  auto.kill('SIGTERM');
  if (auto.exitCode === null) await new Promise(resolve => auto.once('exit', resolve));
}

const runtimeDir = join(dir, 'running-reports');
const runtimeInjected = join(dir, 'running-injected');
const runtimeOnce = join(dir, 'runtime-read');
const running = spawn(process.execPath,
  [new URL('../chaoxing-quiz-control.mjs', import.meta.url).pathname, '--start'],
  {env:{...process.env, CX_PAGE_BRIDGE:mock, CX_QUIZ_REPORT_DIR:runtimeDir,
    CX_QUIZ_POLL_MS:'100', MOCK_REPORT:'', MOCK_RUNTIME:JSON.stringify({...runtime,
      status:'running',active:true,incident:null}), MOCK_RUNTIME_ONCE:runtimeOnce,
    MOCK_INJECTED:runtimeInjected}});
let runningOutput = '';
const runningRecovered = new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error(`running recovery timeout: ${runningOutput}`)), 15000);
  running.stdout.on('data', chunk => {
    runningOutput += chunk.toString();
    if (runningOutput.includes('"reason":"page-reload"')) { clearTimeout(timeout); resolve(); }
  });
  running.on('error', reject);
  running.on('exit', code => {
    if (!runningOutput.includes('"reason":"page-reload"'))
      reject(new Error(`running watcher exited ${code}: ${runningOutput}`));
  });
});
try {
  await runningRecovered;
  assert.equal(readFileSync(runtimeInjected, 'utf8'), 'yesyes');
  assert.equal(JSON.parse(readFileSync(join(runtimeDir, 'runtime.json'), 'utf8')).live, false);
  console.log(JSON.stringify({unexpectedReloadRecovered:true}));
} finally {
  running.kill('SIGTERM');
  if (running.exitCode === null) await new Promise(resolve => running.once('exit', resolve));
}

const stoppedDir = join(dir, 'stopped-reports');
const stoppedInjected = join(dir, 'stopped-injected');
const stoppedOnce = join(dir, 'stopped-read');
const stopped = spawn(process.execPath,
  [new URL('../chaoxing-quiz-control.mjs', import.meta.url).pathname, '--start'],
  {env:{...process.env, CX_PAGE_BRIDGE:mock, CX_QUIZ_REPORT_DIR:stoppedDir,
    CX_QUIZ_POLL_MS:'100', MOCK_REPORT:'', MOCK_RUNTIME:JSON.stringify({...runtime,
      status:'stopped',active:false,incident:null}), MOCK_RUNTIME_ONCE:stoppedOnce,
    MOCK_INJECTED:stoppedInjected}});
let stoppedOutput = '';
const observedStop = new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error(`stop timeout: ${stoppedOutput}`)), 15000);
  stopped.stdout.on('data', chunk => {
    stoppedOutput += chunk.toString();
    if (stoppedOutput.includes('"live":false')) { clearTimeout(timeout); resolve(); }
  });
  stopped.on('error', reject);
  stopped.on('exit', code => {
    if (!stoppedOutput.includes('"live":false')) reject(new Error(`stopped watcher exited ${code}`));
  });
});
try {
  await observedStop;
  assert.equal(readFileSync(stoppedInjected, 'utf8'), 'yes');
  assert(!stoppedOutput.includes('"reason":"page-reload"'));
  console.log(JSON.stringify({intentionalStopRespected:true}));
} finally {
  stopped.kill('SIGTERM');
  if (stopped.exitCode === null) await new Promise(resolve => stopped.once('exit', resolve));
}
