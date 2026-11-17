// Isolated browser check: every browser request is fulfilled or aborted locally.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { chromium } = require('playwright-core');

(async () => {
  const script = fs.readFileSync(path.join(__dirname, '..', 'chaoxing-autoplay-v3.js'), 'utf8');
  const oneChapterScript = fs.readFileSync(path.join(__dirname, '..', 'chaoxing-autoplay-v3-one-chapter.js'), 'utf8');
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-background-networking', '--no-first-run'],
  });
  const context = await browser.newContext();
  const requests = [];
  await context.route('**/*', async route => {
    const url = route.request().url();
    requests.push(url);
    if (route.request().isNavigationRequest() && url.startsWith('https://mooc1.chaoxing.com/mycourse/studentstudy')) {
      await route.fulfill({contentType:'text/html', body:`<!doctype html><html><body>
        <div id="mainid"><li id="dct0">任务一</li>
        <div id="prevNextFocusNext" onclick="PCount.next(1)">下一节</div></div>
      </body></html>`});
    } else {
      await route.abort();
    }
  });
  try {
    const page = await context.newPage();
    await page.goto('https://mooc1.chaoxing.com/mycourse/studentstudy?chapterId=local-test');
    await page.evaluate(() => {
      window.__docCalls = 0;
      window.AttachmentSetting = {
        attachments: [{jobid:'local-doc-1', type:'document', job:true, isPassed:false, jtoken:'local-token'}],
        defaults: {knowledgeid:'1', courseid:'2', clazzId:'3'},
      };
      window.fetch = async () => {
        window.__docCalls++;
        window.AttachmentSetting.attachments[0].job = false;
        window.AttachmentSetting.attachments[0].isPassed = true;
        return {ok:true, json:async () => ({status:true})};
      };
      window.__nextCalls = 0;
      window.PCount = {next: () => {
        window.__nextCalls++;
        const nextUrl = new URL(location.href);
        nextUrl.searchParams.set('chapterId', `local-${window.__nextCalls + 1}`);
        history.replaceState({}, '', nextUrl);
        document.getElementById('prevNextFocusNext').setAttribute('onclick', `PCount.next(${window.__nextCalls + 1})`);
        if (window.__nextCalls === 1) {
          document.body.insertAdjacentHTML('beforeend', '<div class="TiMu newTiMu"><div class="Zy_TItle">1【单选题】测试</div></div>');
          window.AttachmentSetting = {
            attachments:[{jobid:'local-quiz-2', type:'workid', job:true, isPassed:false}],
            defaults:{knowledgeid:'2', courseid:'2', clazzId:'3'},
          };
        } else {
          window.AttachmentSetting = {
            attachments:[{jobid:'local-unknown-3', type:'unknown', job:true}],
            defaults:{knowledgeid:'3', courseid:'2', clazzId:'3'},
          };
        }
      }};
    });
    await page.evaluate(script);
    await page.waitForFunction(() => window.__cxV3?.status === 'waiting-quiz', {timeout:15000});
    const result = await page.evaluate(() => ({
      status:window.__cxV3.status,
      completed:window.__cxV3.completed,
      log:window.__cxV3.log,
      docCalls:window.__docCalls,
    }));
    assert.strictEqual(result.docCalls, 1);
    assert.strictEqual(result.completed.length, 1);
    assert(result.log.some(line => line.includes('文档已确认完成')));
    assert(result.log.some(line => line.includes('已生成控制端报告')));
    assert(requests.every(url => url.startsWith('https://mooc1.chaoxing.com/mycourse/studentstudy')));
    console.log(JSON.stringify({status:result.status, docCalls:result.docCalls,
      completedChapters:result.completed.length, lastLog:result.log.at(-1), browserRequests:requests.length}));
    await page.evaluate(() => {
      window.AttachmentSetting.attachments[0].job = false;
      document.body.insertAdjacentHTML('beforeend',
        '<div class="ans-attach-ct ans-job-finished"><iframe jobid="local-quiz-2"></iframe></div>');
    });
    await page.waitForFunction(() => window.__cxV3?.status === 'needs-review', {timeout:15000});
    const continued = await page.evaluate(() => ({completed:window.__cxV3.completed.length,
      nextCalls:window.__nextCalls, reportPresent:!!document.getElementById('cx-v3-quiz-report')}));
    assert.deepStrictEqual(continued, {completed:2, nextCalls:2, reportPresent:false});
    console.log(JSON.stringify({multiChapterResumeCase:continued}));

    const failedPage = await context.newPage();
    await failedPage.goto('https://mooc1.chaoxing.com/mycourse/studentstudy?chapterId=local-failure');
    await failedPage.evaluate(() => {
      window.__docCalls = 0;
      window.__nextCalls = 0;
      window.AttachmentSetting = {
        attachments:[{jobid:'local-doc-fail', type:'document', job:true, isPassed:false, jtoken:'local-token'}],
        defaults:{knowledgeid:'1', courseid:'2', clazzId:'3'},
      };
      window.fetch = async () => { window.__docCalls++; return {ok:true, json:async () => ({status:false})}; };
      window.PCount = {next: () => { window.__nextCalls++; }};
    });
    await failedPage.evaluate(script);
    await failedPage.evaluate(script); // second start must not create a second worker
    await failedPage.waitForFunction(() => window.__cxV3?.status === 'needs-review');
    const failed = await failedPage.evaluate(() => ({status:window.__cxV3.status,
      docCalls:window.__docCalls, nextCalls:window.__nextCalls, completed:window.__cxV3.completed.length}));
    assert.deepStrictEqual(failed, {status:'needs-review', docCalls:1, nextCalls:0, completed:0});
    const failedCheckpoint = await failedPage.evaluate(() => JSON.parse(sessionStorage.getItem('cx-v3-runtime')));
    assert.strictEqual(failedCheckpoint.incident.message, '文档接口未确认成功');
    console.log(JSON.stringify({failureCase:failed}));

    const limitedPage = await context.newPage();
    await limitedPage.goto('https://mooc1.chaoxing.com/mycourse/studentstudy?chapterId=local-limit');
    await limitedPage.evaluate(() => {
      window.__nextCalls = 0;
      window.AttachmentSetting = {
        attachments:[{jobid:'local-doc-limit', type:'document', job:true, isPassed:false, jtoken:'local-token'}],
        defaults:{knowledgeid:'1', courseid:'2', clazzId:'3'},
      };
      window.fetch = async () => {
        window.AttachmentSetting.attachments[0].job = false;
        window.AttachmentSetting.attachments[0].isPassed = true;
        return {ok:true, json:async () => ({status:true})};
      };
      window.PCount = {next: () => { window.__nextCalls++; }};
    });
    await limitedPage.evaluate(oneChapterScript);
    await limitedPage.waitForFunction(() => window.__cxV3?.status === 'limit');
    const limited = await limitedPage.evaluate(() => ({status:window.__cxV3.status,
      nextCalls:window.__nextCalls, completed:window.__cxV3.completed.length}));
    assert.deepStrictEqual(limited, {status:'limit', nextCalls:0, completed:1});
    const checkpointBeforeReload = await limitedPage.evaluate(() => JSON.parse(sessionStorage.getItem('cx-v3-runtime')));
    assert.strictEqual(checkpointBeforeReload.status, 'limit');
    assert.strictEqual(checkpointBeforeReload.completed.length, 1);
    await limitedPage.reload();
    const checkpointAfterReload = await limitedPage.evaluate(() => JSON.parse(sessionStorage.getItem('cx-v3-runtime')));
    assert.strictEqual(checkpointAfterReload.runId, checkpointBeforeReload.runId);
    assert.strictEqual(checkpointAfterReload.completed.length, 1);
    console.log(JSON.stringify({oneChapterCase:limited}));

    const finishedPage = await context.newPage();
    await finishedPage.goto('https://mooc1.chaoxing.com/mycourse/studentstudy?chapterId=local-finished');
    await finishedPage.evaluate(() => {
      document.getElementById('mainid').insertAdjacentHTML('beforeend',
        '<div class="ans-attach-ct ans-job-finished"><iframe jobid="local-already-done"></iframe></div>');
      window.__docCalls = 0;
      window.__nextCalls = 0;
      window.AttachmentSetting = {
        attachments:[{jobid:'local-already-done', type:'document', isPassed:false}],
        defaults:{knowledgeid:'1', courseid:'2', clazzId:'3'},
      };
      window.fetch = async () => { window.__docCalls++; throw new Error('completed document requested again'); };
      window.PCount = {next: () => { window.__nextCalls++; }};
    });
    await finishedPage.evaluate(oneChapterScript);
    await finishedPage.waitForFunction(() => window.__cxV3?.status === 'limit');
    const finished = await finishedPage.evaluate(() => ({status:window.__cxV3.status,
      docCalls:window.__docCalls, nextCalls:window.__nextCalls, completed:window.__cxV3.completed.length}));
    assert.deepStrictEqual(finished, {status:'limit', docCalls:0, nextCalls:0, completed:1});
    console.log(JSON.stringify({alreadyFinishedCase:finished}));

    const quizPage = await context.newPage();
    await quizPage.goto('https://mooc1.chaoxing.com/mycourse/studentstudy?chapterId=local-quiz&courseId=local-course');
    await quizPage.evaluate(() => {
      document.querySelectorAll('li[id^="dct"]').forEach(node => node.remove());
      document.body.insertAdjacentHTML('beforeend', `<form action="/submit?token=never-export-this">
        <div class="singleQuesId" id="question123" data="123"><div class="TiMu newTiMu">
        <div class="Zy_TItle font-cxsecret">1【单选题】测试题干</div>
        <ul class="Zy_ulTop"><li qid="123"><span class="num_option" name="answer123" data="A">A</span>选项甲</li>
        <li qid="123"><span class="num_option" name="answer123" data="B">B</span>选项乙</li></ul>
        <input type="hidden" id="answer123" name="answer123" value="">
        <input type="hidden" id="answertype123" value="0"></div></div></form>`);
      window.AttachmentSetting = {attachments:[{jobid:'local-work', type:'workid', job:true}]};
    });
    await quizPage.evaluate(oneChapterScript);
    await quizPage.waitForFunction(() => window.__cxV3?.status === 'waiting-quiz');
    const quiz = await quizPage.evaluate(() => ({status:window.__cxV3.status,
      report:JSON.parse(document.getElementById('cx-v3-quiz-report').textContent),
      completed:window.__cxV3.completed.length}));
    assert.strictEqual(quiz.report.questionCount, 1);
    assert.strictEqual(quiz.report.questions[0].options.length, 2);
    assert.strictEqual(quiz.report.questions[0].questionId, '123');
    assert.strictEqual(quiz.report.questions[0].options[1].value, 'B');
    assert.deepStrictEqual(quiz.report.questions[0].control,
      {kind:'choice',answerType:'0',answerFieldId:'answer123',editors:[],blankCount:0});
    assert(quiz.report.questions[0].captureIssues.includes('font-unavailable'));
    assert(!JSON.stringify(quiz.report).includes('never-export-this'));
    assert.deepStrictEqual({status:quiz.status, completed:quiz.completed}, {status:'waiting-quiz', completed:0});
    console.log(JSON.stringify({quizCase:{status:quiz.status, questions:quiz.report.questionCount,
      options:quiz.report.questions[0].options.length}}));
    await quizPage.waitForTimeout(2200);
    assert.strictEqual(await quizPage.evaluate(() => window.__cxV3.status), 'waiting-quiz');
    await quizPage.evaluate(() => {
      window.AttachmentSetting.attachments[0].job = false;
      document.body.insertAdjacentHTML('beforeend',
        '<div class="ans-attach-ct ans-job-finished"><iframe jobid="local-work"></iframe></div>');
    });
    await quizPage.waitForFunction(() => window.__cxV3?.status === 'limit', {timeout:10000});
    const resumed = await quizPage.evaluate(() => ({status:window.__cxV3.status,
      completed:window.__cxV3.completed.length, reportPresent:!!document.getElementById('cx-v3-quiz-report')}));
    assert.deepStrictEqual(resumed, {status:'limit', completed:1, reportPresent:false});
    console.log(JSON.stringify({resumedQuizCase:resumed}));

    const controlsPage = await context.newPage();
    await controlsPage.goto('https://mooc1.chaoxing.com/mycourse/studentstudy?chapterId=quiz-controls');
    await controlsPage.evaluate(() => {
      document.querySelectorAll('li[id^="dct"]').forEach(node => node.remove());
      document.body.insertAdjacentHTML('beforeend', `<div class="singleQuesId" id="question456">
        <div class="TiMu newTiMu"><div class="Zy_TItle">1【简答题】说明原因</div>
        <textarea id="answer456" name="answer456"></textarea><input id="answertype456" value="4"></div></div>
        <div class="singleQuesId" id="question789"><div class="TiMu newTiMu">
        <div class="Zy_TItle">2【填空题】两个空</div>
        <textarea id="answerEditor7891" name="answerEditor7891"></textarea>
        <textarea id="answerEditor7892" name="answerEditor7892"></textarea>
        <input name="tiankongsize789" value="2"><input id="answertype789" value="2"></div></div>`);
      window.AttachmentSetting = {attachments:[{jobid:'controls-work', type:'workid', job:true}]};
    });
    await controlsPage.evaluate(oneChapterScript);
    await controlsPage.waitForFunction(() => window.__cxV3?.status === 'waiting-quiz');
    const controls = await controlsPage.evaluate(() =>
      JSON.parse(document.getElementById('cx-v3-quiz-report').textContent).questions.map(q => q.control));
    assert.equal(controls[0].kind, 'editor');
    assert.deepStrictEqual(controls[0].editors.map(editor => editor.id), ['answer456']);
    assert.equal(controls[1].kind, 'fill');
    assert.equal(controls[1].blankCount, 2);
    assert.deepStrictEqual(controls[1].editors.map(editor => editor.id),
      ['answerEditor7891', 'answerEditor7892']);
    await controlsPage.evaluate(() => window.__cxV3.stop());
    console.log(JSON.stringify({quizControlsCase:controls.map(control => control.kind)}));

    const reloadedQuizPage = await context.newPage();
    await reloadedQuizPage.goto('https://mooc1.chaoxing.com/mycourse/studentstudy?chapterId=local-quiz-reloaded');
    await reloadedQuizPage.evaluate(() => {
      document.querySelectorAll('li[id^="dct"]').forEach(node => node.remove());
      document.body.insertAdjacentHTML('beforeend',
        '<div class="ans-attach-ct ans-job-finished"><iframe jobid="completed-work"></iframe></div>');
      window.AttachmentSetting = {attachments:[{jobid:'completed-work',type:'workid',job:false}]};
      window.__nextCalls = 0;
      window.PCount = {next:() => { window.__nextCalls++; }};
    });
    await reloadedQuizPage.evaluate(oneChapterScript);
    await reloadedQuizPage.waitForFunction(() => window.__cxV3?.status === 'limit');
    const reloadedQuiz = await reloadedQuizPage.evaluate(() => ({status:window.__cxV3.status,
      completed:window.__cxV3.completed.length, nextCalls:window.__nextCalls,
      reportPresent:!!document.getElementById('cx-v3-quiz-report')}));
    assert.deepStrictEqual(reloadedQuiz, {status:'limit', completed:1, nextCalls:0, reportPresent:false});
    console.log(JSON.stringify({reloadedQuizCase:reloadedQuiz}));

    const hiddenPage = await context.newPage();
    await hiddenPage.goto('https://mooc1.chaoxing.com/mycourse/studentstudy?chapterId=hidden-complete');
    await hiddenPage.evaluate(() => {
      document.getElementById('dct0').style.display = 'none';
      document.body.insertAdjacentHTML('beforeend',
        '<div class="ans-attach-ct ans-job-finished"><iframe jobid="hidden-video"></iframe></div>');
      window.AttachmentSetting = {attachments:[{jobid:'hidden-video',type:'video',isPassed:true}]};
      window.__nextCalls = 0;
      window.PCount = {next:() => {window.__nextCalls++;}};
    });
    await hiddenPage.evaluate(oneChapterScript);
    await hiddenPage.waitForFunction(() => window.__cxV3?.status === 'limit');
    const hidden = await hiddenPage.evaluate(() => ({status:window.__cxV3.status,
      completed:window.__cxV3.completed.length, nextCalls:window.__nextCalls}));
    assert.deepStrictEqual(hidden, {status:'limit', completed:1, nextCalls:0});
    console.log(JSON.stringify({hiddenCompletedCase:hidden}));

    const hiddenPendingPage = await context.newPage();
    await hiddenPendingPage.goto('https://mooc1.chaoxing.com/mycourse/studentstudy?chapterId=hidden-pending');
    await hiddenPendingPage.evaluate(() => {
      document.getElementById('dct0').style.display = 'none';
      document.body.insertAdjacentHTML('beforeend',
        '<div class="ans-attach-ct"><iframe jobid="hidden-pending-video"></iframe></div><video style="width:200px;height:100px"></video>');
      const video = document.querySelector('video');
      let time = 0;
      Object.defineProperty(video, 'duration', {get:() => 5});
      Object.defineProperty(video, 'currentTime', {get:() => time});
      Object.defineProperty(video, 'paused', {get:() => false});
      Object.defineProperty(video, 'ended', {get:() => false});
      window.AttachmentSetting = {attachments:[{jobid:'hidden-pending-video',type:'video',job:true}]};
      window.__nextCalls = 0;
      window.PCount = {next:() => {window.__nextCalls++;}};
      setInterval(() => {
        time = Math.min(5,time+1);
        if (time >= 3) window.AttachmentSetting.attachments[0].job = false;
      }, 300);
    });
    await hiddenPendingPage.evaluate(oneChapterScript);
    await hiddenPendingPage.waitForFunction(() => window.__cxV3?.status === 'limit', {timeout:12000});
    const pendingHidden = await hiddenPendingPage.evaluate(() => ({status:window.__cxV3.status,
      completed:window.__cxV3.completed.length,nextCalls:window.__nextCalls}));
    assert.deepStrictEqual(pendingHidden, {status:'limit',completed:1,nextCalls:0});
    console.log(JSON.stringify({hiddenPendingCase:pendingHidden}));
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
