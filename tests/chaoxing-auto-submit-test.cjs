const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright-core');

(async () => {
  const code = fs.readFileSync(path.join(__dirname,'..','chaoxing-submit-page.js'),'utf8').trim();
  const browser = await chromium.launch({executablePath:process.env.CHROME_PATH || '/usr/bin/google-chrome',
    headless:true,args:['--no-sandbox','--disable-background-networking','--no-first-run']});
  const context = await browser.newContext();
  await context.route('**/*', route => route.request().isNavigationRequest()
    ? route.fulfill({contentType:'text/html',body:'<!doctype html><html><body></body></html>'}) : route.abort());
  try {
    const page = await context.newPage();
    await page.goto('https://mooc1.chaoxing.com/mycourse/studentstudy?chapterId=chapter');
    await page.evaluate(() => {
      window.__cxV3 = {status:'waiting-quiz'};
      window.AttachmentSetting = {attachments:[{type:'workid',jobid:'job',job:true}]};
      document.body.innerHTML = '<script id="cx-v3-quiz-report" type="application/json"></script>';
      document.getElementById('cx-v3-quiz-report').textContent = JSON.stringify({id:'course:chapter:job',jobId:'job'});
      window.opened = 0;
      window.btnBlueSubmit = () => {
        window.opened++;
        const button = document.createElement('button');
        button.id = 'popok';
        button.textContent = '确认提交';
        button.onclick = () => { window.AttachmentSetting.attachments[0].job = false; window.confirmed = true; };
        document.body.appendChild(button);
      };
    });
    const run = payload => page.evaluate(`${code}(${JSON.stringify(payload)})`);
    const base = {reportId:'course:chapter:job',jobId:'job',chapterId:'chapter'};
    assert.equal((await run({...base,reportId:'wrong',phase:'open'})).ok,false);
    assert.equal(await page.evaluate(() => window.opened),0);
    assert.equal((await run({...base,phase:'open'})).ok,true);
    assert.equal((await run({...base,phase:'confirm'})).ok,true);
    assert.equal((await run({...base,phase:'status'})).completed,true);
    assert.equal(await page.evaluate(() => window.confirmed),true);
    console.log(JSON.stringify({autoSubmit:'verified',wrongReportRejected:true}));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode=1; });
