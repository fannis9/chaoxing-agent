// Isolated page and PageBridge fixture. No request reaches Chaoxing.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {createHash} = require('node:crypto');
const {chromium} = require('playwright-core');

(async () => {
  const code = fs.readFileSync(path.join(__dirname, '..', 'chaoxing-fill-page.js'), 'utf8').trim();
  const report = {schemaVersion:1, kind:'quiz', id:'course:chapter:job',
    courseId:'course', chapterId:'chapter', jobId:'job',
    questions:[
      {index:1,questionId:'123',heading:'1【单选题】测试',
        options:[{label:'A',value:'A',text:'甲'},{label:'B',value:'B',text:'乙'}],
        control:{kind:'choice'},captureIssues:[]},
      {index:2,questionId:'456',heading:'2【简答题】测试',options:[],
        control:{kind:'editor',editors:[{id:'answer456'}]},captureIssues:[]},
      {index:3,questionId:'789',heading:'3【填空题】测试',options:[],
        control:{kind:'fill',editors:[{id:'answerEditor7891'}],blankCount:1},captureIssues:[]},
    ]};
  const browser = await chromium.launch({executablePath:process.env.CHROME_PATH || '/usr/bin/google-chrome',
    headless:true, args:['--no-sandbox','--disable-background-networking','--no-first-run']});
  const context = await browser.newContext();
  await context.route('**/*', route => route.request().isNavigationRequest()
    ? route.fulfill({contentType:'text/html',body:'<!doctype html><html><body></body></html>'}) : route.abort());
  try {
    const page = await context.newPage();
    await page.goto('https://mooc1.chaoxing.com/mycourse/studentstudy?courseId=course&chapterId=chapter');
    await page.evaluate(report => {
      window.__cxV3 = {status:'waiting-quiz'};
      window.AttachmentSetting = {attachments:[{type:'workid',jobid:'job',job:true}]};
      document.body.innerHTML = `<script type="application/json" id="cx-v3-quiz-report"></script>
        <div class="singleQuesId" id="question123"><div class="Zy_TItle">1【单选题】测试</div>
        <ul><li><span class="num_option" data="A">A</span>甲</li>
        <li><span class="num_option" data="B">B</span>乙</li></ul></div>
        <div class="singleQuesId" id="question456"><div class="Zy_TItle">2【简答题】测试</div>
        <textarea id="answer456"></textarea></div>
        <div class="singleQuesId" id="question789"><div class="Zy_TItle">3【填空题】测试</div>
        <textarea id="answerEditor7891" style="display:none"></textarea>
        <button id="save_789">保存</button></div>`;
      document.getElementById('cx-v3-quiz-report').textContent = JSON.stringify(report);
      window.clicks = 0;
      document.querySelectorAll('#question123 li').forEach(li => li.addEventListener('click', () => {
        window.clicks++;
        if (window.multi) { li.querySelector('.num_option').classList.toggle('check_answer'); return; }
        document.querySelectorAll('#question123 .num_option').forEach(span => span.classList.remove('check_answer'));
        li.querySelector('.num_option').classList.add('check_answer');
      }));
      window.UE = {getEditor: id => id === 'answerEditor7891' ? {
        isReady:true, setContent: html => window.editorHtml = html,
        sync: () => document.getElementById(id).value = window.editorHtml,
      } : null};
      document.getElementById('save_789').addEventListener('click', () => window.saved = true);
    }, report);
    const evaluate = payload => page.evaluate(`${code}(${JSON.stringify(payload)})`);
    const before = await evaluate({mode:'preflight', report});
    assert.deepEqual(before, {ok:true,checked:3,issues:[]});
    const changed = structuredClone(report);
    changed.questions[0].heading = '另一道题';
    const stale = await evaluate({mode:'preflight', report:changed});
    assert.equal(stale.ok, false);
    assert.equal(await page.evaluate(() => window.clicks), 0);
    const values = [['B'],['简答 <T>'],['填空 <T>']];
    for (let i=0; i<3; i++) {
      const answer = {answerValues:values[i]};
      const result = await evaluate({mode:'fill',report,question:report.questions[i],answer});
      assert.equal(result.ok, true, JSON.stringify(result));
      const verified = await evaluate({mode:'verify',report,question:report.questions[i],answer});
      assert.equal(verified.ok, true, JSON.stringify(verified));
    }
    const repeat = await evaluate({mode:'fill',report,question:report.questions[0],
      answer:{answerValues:['B']}});
    assert.equal(repeat.clicks, 0);
    await page.evaluate(() => window.multi = true);
    const multiAnswer = {answerValues:['A','B']};
    const multiStep = await evaluate({mode:'fill',report,question:report.questions[0],answer:multiAnswer});
    assert.equal(multiStep.clickedLabel, 'A');
    assert.equal((await evaluate({mode:'verify-step',report,question:report.questions[0],
      answer:multiAnswer,clickedLabel:'A'})).ok, true);
    assert.equal((await evaluate({mode:'fill',report,question:report.questions[0],answer:multiAnswer})).clicks, 0);
    assert.equal((await evaluate({mode:'verify',report,question:report.questions[0],answer:multiAnswer})).ok, true);
    const state = await page.evaluate(() => ({clicks:window.clicks,
      selected:[...document.querySelectorAll('#question123 .check_answer')].map(node => node.getAttribute('data')),
      short:document.getElementById('answer456').value,
      rich:document.getElementById('answerEditor7891').value,
      saved:window.saved}));
    assert.equal(state.clicks, 2);
    assert.deepEqual(state.selected, ['A','B']);
    assert.equal(state.short, '简答 <T>');
    assert(state.rich.includes('&lt;T&gt;'));
    assert.equal(state.saved, true);
  } finally { await browser.close(); }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-filler-'));
  const reportPath = path.join(dir, 'quiz-0123456789abcdef.json');
  const answerPath = path.join(dir, 'answer-0123456789abcdef.json');
  const raw = JSON.stringify(report);
  fs.writeFileSync(reportPath, raw);
  const answer = {schemaVersion:1,kind:'answer-proposal',reportId:report.id,
    sourceHash:createHash('sha256').update(raw).digest('hex'),status:'ready',model:'test',
    answers:report.questions.map((q,i) => ({index:q.index,questionId:q.questionId,
      answerValues:[['B','简答','填空'][i]],needsReview:false}))};
  fs.writeFileSync(answerPath, JSON.stringify(answer));
  const mock = path.join(dir,'mock-page.mjs');
  fs.writeFileSync(mock, `if(process.argv[2]==='tabs') console.log('* [77] https://mooc1.chaoxing.com/mycourse/studentstudy?courseId=course&chapterId=chapter');
else if(process.argv[2]==='eval') console.log(JSON.stringify({ok:true,checked:3,issues:[]}));`);
  const command = (args=[]) => spawnSync(process.execPath,
    [path.join(__dirname,'..','chaoxing-page-filler.mjs'),`--answer=${answerPath}`,...args],
    {encoding:'utf8',env:{...process.env,CX_QUIZ_REPORT_DIR:dir,CX_PAGE_BRIDGE:mock}});
  const preview = command();
  assert.equal(preview.status,0,preview.stderr);
  assert.equal(JSON.parse(preview.stdout).event,'fill-preview');
  const applied = command(['--apply']);
  assert.equal(applied.status,0,applied.stderr);
  const result = JSON.parse(applied.stdout);
  assert.equal(result.event,'fill-result');
  assert.equal(result.filled.length,3);
  assert.equal(result.submitted,false);
  assert.equal(fs.statSync(result.audit).mode & 0o777,0o600);
  answer.sourceHash = 'wrong';
  fs.writeFileSync(answerPath,JSON.stringify(answer));
  const rejected = command();
  assert.notEqual(rejected.status,0);
  assert.match(rejected.stderr,/不匹配或已过期/);
  console.log(JSON.stringify({filler:'verified', staleRejected:true, noSubmit:true}));
})().catch(error => { console.error(error); process.exitCode=1; });
