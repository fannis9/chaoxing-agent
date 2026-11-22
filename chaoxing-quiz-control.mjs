#!/usr/bin/env node
// Run this from the conversation that controls the study session.
// It prints one JSON event per newly reported quiz and writes private local artifacts.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import {browserPath} from './lib/config.mjs';
import {BridgeClient} from './lib/bridge-client.mjs';
import {RunScope,bindCancellation} from './lib/run-scope.mjs';
import {appendRotating} from './lib/maintenance.mjs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';

const exec = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = process.env.CX_QUIZ_REPORT_DIR || join(HERE, 'quiz-reports');
const daemonLog = process.argv.includes('--daemon-log') ? join(OUT, 'controller.log') : null;
function writeOutput(text) { if(daemonLog)appendRotating(daemonLog,text);else process.stdout.write(text); }
function writeError(text) { if(daemonLog)appendRotating(daemonLog,text);else process.stderr.write(text); }
const ONCE = process.argv.includes('--once');
const START = process.argv.includes('--start');
let restartRequested = process.argv.includes('--restart-page');
const RESUME = process.argv.includes('--resume');
const STATUS = process.argv.includes('--status');
const SCHEDULE = process.argv.includes('--schedule');
const SCHEDULE_STATUS = process.argv.includes('--schedule-status');
let ownedTab = process.argv.find(arg => arg.startsWith('--tab='))?.slice(6) || '';
const POLL_MS = Math.max(100, Number(process.env.CX_QUIZ_POLL_MS) || 5000);
const seen = new Set();
const seenAnswers = new Set();
const pending = new Map();
const monitorErrors = new Set();
const runtimeErrors = new Set();
const runtimeFailureCounts = new Map();
const runtimes = new Map();
const visibleRequests = new Map();
const missingSince = new Map();
const navigationErrors = new Map();
const require = createRequire(import.meta.url);
const controller = process.env.CODEX_THREAD_ID || process.env.DSH_SESSION_ID || 'current-terminal';
let courseConfig = null;
const schedulePath = process.env.CX_SCHEDULE_PATH || join(OUT, 'schedule.json');
let scheduleState = null;

function atomicJson(path, value) {
  mkdirSync(dirname(path), {recursive:true, mode:0o700});
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(value, null, 2), {mode:0o600});
  renameSync(temp, path);
}

function saveSchedule() {
  scheduleState.updatedAt = new Date().toISOString();
  atomicJson(schedulePath, scheduleState);
}

async function loadSchedule(courseId) {
  if (!SCHEDULE) return;
  if (courseConfig?.schemaVersion !== 1 || !Array.isArray(courseConfig.courses)
      || courseConfig.courses.length < 1) throw new Error('课程配置无效');
  try { scheduleState = JSON.parse(readFileSync(schedulePath, 'utf8')); } catch { /* first run */ }
  if (!scheduleState) {
    const index = courseConfig.courses.findIndex(course => course.courseId === courseId);
    if (index < 0) throw new Error('当前课程不在调度列表，拒绝开始');
    scheduleState = {schemaVersion:1, tab:ownedTab, index, status:'running', completed:[]};
    saveSchedule();
  }
  if (scheduleState.schemaVersion !== 1 || !Number.isInteger(scheduleState.index)
      || !courseConfig.courses[scheduleState.index]) throw new Error('调度检查点与当前标签不符');
  if (courseConfig.autoDiscovered && ['switching','auditing','needs-review'].includes(scheduleState.status))scheduleState.status='running';
  if (scheduleState.status !== 'running')
    throw new Error(`调度状态为 ${scheduleState.status}，需检查 schedule.json 后再恢复`);
  const current = courseConfig.courses[scheduleState.index];
  if (current.courseId !== courseId) throw new Error('当前课程与调度检查点不符，需人工检查');
  if (scheduleState.tab !== ownedTab) {
    const previousUrl=await tabUrl(scheduleState.tab);
    if(previousUrl && /\/mycourse\/studentstudy(?:\?|$)/.test(previousUrl))
      throw new Error('原调度学习标签仍存在，拒绝同时控制另一学习标签');
    if(courseConfig.autoDiscovered){
      const replacement=new URL(await tabUrl(ownedTab));
      if(replacement.searchParams.get('courseId')!==current.courseId || replacement.searchParams.get('cpi')!==courseConfig.cpi)
        throw new Error('新标签账号或课程与调度检查点不符');
    }
    scheduleState.tab = ownedTab;
    saveSchedule();
  }
}

function currentCourse() { return courseConfig?.courses[scheduleState?.index]; }

async function tabUrl(tab) {
  return bridge.url(tab);
}

async function waitForUrl(tab, predicate, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const url = await tabUrl(tab);
    if (predicate(url)) return url;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error('课程切换页面超时');
}

async function courseDirectory(tab, course) {
  const url = new URL('https://mooc1.chaoxing.com/visit/stucoursemiddle');
  url.search = new URLSearchParams({courseid:course.courseId, clazzid:course.clazzId,
    cpi:courseConfig.cpi, ismooc2:'1', v:'2'}).toString();
  await pageCommand('navigate', String(url), '--tab', tab);
  const landing = await waitForUrl(tab, value =>
    /^https:\/\/mooc2-ans\.chaoxing\.com\/mooc2-ans\/mycourse\/(stu|studentcourse)/.test(value));
  const parsed = new URL(landing);
  if (parsed.pathname.endsWith('/stu')) {
    const enc = parsed.searchParams.get('enc');
    if (!enc || !/^[a-f0-9]+$/i.test(enc)) throw new Error('课程目录缺少有效入口参数');
    const dir = new URL('https://mooc2-ans.chaoxing.com/mooc2-ans/mycourse/studentcourse');
    dir.search = new URLSearchParams({courseid:course.courseId, clazzid:course.clazzId,
      enc, cpi:courseConfig.cpi, v:'2'}).toString();
    await pageCommand('navigate', String(dir), '--tab', tab);
    await waitForUrl(tab, value => value.includes('/mycourse/studentcourse'));
  }
  const details = JSON.parse(await pageCommand('eval', `(() => {
    const text = document.body?.innerText || '';
    const matches = [...text.matchAll(/已完成任务点\\s*[:：]?\\s*(\\d+)\\s*\\/\\s*(\\d+)/g)];
    const progress = matches.map(m => ({done:Number(m[1]), total:Number(m[2])}));
    const old = String(window.toOld || '');
    const enc = old.match(/var\\s+enc\\s*=\\s*["']([a-f0-9]+)["']/i)?.[1] || '';
    return {courseId:new URL(location.href).searchParams.get('courseid'),
      path:location.pathname, progress, enc,
      firstExists:!!document.getElementById('cur${course.firstChapterId}'),
      finalExists:!!document.getElementById('cur${course.finalChapterId}')};
  })()`, '--world', 'MAIN', '--tab', tab));
  if (details.courseId !== course.courseId || !details.path.endsWith('/studentcourse')
      || !details.firstExists || !details.finalExists || !/^[a-f0-9]+$/i.test(details.enc))
    throw new Error('课程目录与配置不一致，已停止切换');
  return details;
}

async function advanceCourse(tab, snapshot) {
  if (!SCHEDULE || scheduleState?.status !== 'running' || snapshot.status !== 'course-boundary') return;
  const course = currentCourse();
  if (snapshot.courseId !== course.courseId || snapshot.chapterId !== course.finalChapterId
      || (!snapshot.completed?.some(item => item.chapterId === course.finalChapterId) && !wasDeferred(course.courseId,course.finalChapterId)))
    throw new Error('末章核验记录与调度配置不符');
  scheduleState.status = 'auditing';
  saveSchedule();
  try {
    const directory = await courseDirectory(tab, course);
    const progress = course.expectedTasks===null && directory.progress.length===1 ? directory.progress[0] : directory.progress.find(item => item.total === course.expectedTasks);
    if ((!progress || progress.done !== progress.total) && !courseConfig.autoDiscovered)
      throw new Error(`课程总进度未确认完成：${JSON.stringify(directory.progress)}，预期 ${course.expectedTasks}`);
    scheduleState.completed.push({courseId:course.courseId,name:course.name,at:new Date().toISOString(),
      status:progress && progress.done===progress.total?'complete':'processed-with-unresolved',
      tasks:progress?.total ?? null,done:progress?.done ?? null});
    scheduleState.index += 1;
    if (scheduleState.index >= courseConfig.courses.length) {
      scheduleState.status = 'complete';
      saveSchedule();
      writeOutput(`${JSON.stringify({event:'schedule-complete', completed:scheduleState.completed.length,summary:scheduleState.completed})}\n`);
      return;
    }
    scheduleState.status = 'switching';
    saveSchedule();
    const next = currentCourse();
    const target = await courseDirectory(tab, next);
    const study = new URL('https://mooc1.chaoxing.com/mycourse/studentstudy');
    study.search = new URLSearchParams({chapterId:next.firstChapterId, courseId:next.courseId,
      clazzid:next.clazzId, cpi:courseConfig.cpi, enc:target.enc, mooc2:'1'}).toString();
    await pageCommand('navigate', String(study), '--tab', tab);
    await waitForUrl(tab, value => value.includes('/mycourse/studentstudy')
      && new URL(value).searchParams.get('courseId') === next.courseId);
    scheduleState.status = 'running';
    saveSchedule();
    await startStudy();
    writeOutput(`${JSON.stringify({event:'course-switched', tab,
      courseId:next.courseId, name:next.name})}\n`);
  } catch (error) {
    scheduleState.status = 'needs-review';
    scheduleState.incident = {at:new Date().toISOString(), message:String(error.message || error)};
    saveSchedule();
    throw error;
  }
}

function wasDeferred(courseId,chapterId){
  try{return readFileSync(join(OUT,'skipped-quizzes.jsonl'),'utf8').split('\n').filter(Boolean).some(line=>{
    const row=JSON.parse(line);return row.status==='deferred' && row.courseId===courseId && row.chapterId===chapterId;
  });}catch{return false;}
}

function claimController() {
  mkdirSync(OUT, {recursive:true, mode:0o700});
  const lock = join(OUT, '.controller.lock');
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(lock, JSON.stringify({pid:process.pid, controller}), {flag:'wx', mode:0o600});
      process.on('exit', () => {
        try {
          const owner = JSON.parse(readFileSync(lock, 'utf8'));
          if (owner.pid === process.pid) unlinkSync(lock);
        } catch { /* already removed */ }
      });
      return;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let owner;
      try { owner = JSON.parse(readFileSync(lock, 'utf8')); } catch { owner = null; }
      if (!owner?.pid) { unlinkSync(lock); continue; }
      try {
        process.kill(owner.pid, 0);
      } catch (check) {
        if (check.code !== 'ESRCH') throw check;
        unlinkSync(lock);
        continue;
      }
      throw new Error(`已有控制对话在监听（pid ${owner.pid}）`);
    }
  }
  throw new Error('无法取得测验监听锁');
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[char]));
}

async function pageCommand(...args) {
  return bridge.command(...args);
}

async function candidateTabs() {
  if (ownedTab) return [ownedTab];
  return (await bridge.tabs())
    .filter(tab => /^https:\/\/mooc1(?:-[a-z0-9]+)?\.chaoxing\.com\/mycourse\/studentstudy/i.test(tab.url))
    .map(tab=>tab.id);
}

async function startStudy() {
  const tabs = await candidateTabs();
  if (tabs.length !== 1) throw new Error(`需要恰好一个学习通标签；当前找到 ${tabs.length} 个，可用 --tab=<ID> 指定`);
  const tab = tabs[0];
  ownedTab = tab;
  const status = JSON.parse(await pageCommand('eval',
    '({oldBox:!!document.getElementById("cxlogbox"), active:window.__cxV3?.active || false, status:window.__cxV3?.status || "", report:!!document.getElementById("cx-v3-quiz-report"), courseId:new URL(location.href).searchParams.get("courseId") || "", validPage:/^mooc1(?:-[a-z0-9]+)?\\.chaoxing\\.com$/i.test(location.hostname) && /^\\/mycourse\\/studentstudy\\/?$/.test(location.pathname)})',
    '--world', 'MAIN', '--tab', tab));
  if (!status.validPage) throw new Error('当前标签不是学习通章节页，拒绝注入');
  if (SCHEDULE) await loadSchedule(status.courseId);
  if(SCHEDULE && courseConfig.autoDiscovered && wasDeferred(status.courseId,currentCourse().finalChapterId)){
    const url=await tabUrl(tab);
    if(new URL(url).searchParams.get('chapterId')===currentCourse().finalChapterId){
      await advanceCourse(tab,{status:'course-boundary',courseId:status.courseId,chapterId:currentCourse().finalChapterId,completed:[]});return;
    }
  }
  if (status.report && !status.active) {
    const stale = JSON.parse(await pageCommand('eval',
      '(() => {const node=document.getElementById("cx-v3-quiz-report");try {const report=JSON.parse(node?.textContent||"null");if(report?.chapterId!==new URL(location.href).searchParams.get("chapterId")){node?.remove();return true}} catch {} return false})()',
      '--world', 'MAIN', '--tab', tab));
    if (stale) status.report = false;
  }
  if (status.oldBox) throw new Error('检测到旧版脚本日志框；请先停止旧脚本并刷新页面');
  if(restartRequested && !status.active){status.report=false;restartRequested=false;}
  if (status.active || status.report) {
    writeOutput(`${JSON.stringify({event:'attached', tab, status:status.status})}\n`);
    return;
  }
  await pageCommand('eval', 'document.getElementById("cx-v3-logbox")?.remove(); "cleared"',
    '--world', 'MAIN', '--tab', tab);
  if (SCHEDULE) {
    const course = currentCourse();
    await pageCommand('eval', `window.__cxV3Schedule = ${JSON.stringify({
      courseId:course.courseId, finalChapterId:course.finalChapterId})}; "configured"`,
    '--world', 'MAIN', '--tab', tab);
  }
  const script = readFileSync(join(HERE, 'chaoxing-autoplay-v3.js'), 'utf8');
  await pageCommand('eval',`window.__cxRecoverySettings=${JSON.stringify(JSON.parse(process.env.CX_RECOVERY_SETTINGS || '{}'))}`,'--world','MAIN','--tab',ownedTab);
  // Windows caps a process command line at ~32K characters, and the page script
  // outgrew that. Ship it in chunks, then evaluate the assembled source.
  await pageCommand('eval', 'window.__cxV3Source=[]; "ready"', '--world', 'MAIN', '--tab', tab);
  for (let offset = 0; offset < script.length; offset += 6000) {
    const chunk = script.slice(offset, offset + 6000);
    await pageCommand('eval', `window.__cxV3Source.push(${JSON.stringify(chunk)}); window.__cxV3Source.length`,
      '--world', 'MAIN', '--tab', tab);
  }
  await pageCommand('eval',
    '(() => {const source=window.__cxV3Source.join("");window.__cxV3Source=null;(0,eval)(source);return "started"})()',
    '--world', 'MAIN', '--tab', tab);
  writeOutput(`${JSON.stringify({event:'started', tab})}\n`);
}

async function validStudyLocation(tab) {
  const url = await bridge.url(tab);
  if (/^https:\/\/mooc1(?:-[a-z0-9]+)?\.chaoxing\.com\/mycourse\/studentstudy(?:\?|$)/i.test(url)) {
    navigationErrors.delete(tab);
    return true;
  }
  if (navigationErrors.get(tab) !== url) {
    navigationErrors.set(tab, url);
    mkdirSync(OUT, {recursive:true, mode:0o700});
    const path = join(OUT, `incident-${Date.now()}-${tab}.json`);
    const incident = {at:new Date().toISOString(), tab, kind:'navigation',
      reason:url ? '学习通标签离开章节页，需要人工检查' : '学习通标签已关闭或不可见',
      page:url ? new URL(url).origin + new URL(url).pathname : ''};
    writeFileSync(path, JSON.stringify(incident, null, 2), {mode:0o600});
    writeOutput(`${JSON.stringify({event:'incident', ...incident, path})}\n`);
  }
  return false;
}

async function platformQuizStatus(tab) {
  const code = `(() => {
    let work = null;
    function walk(view, depth) {
      let doc;
      try { doc = view.document; } catch { return; }
      try {
        const item = view.AttachmentSetting?.attachments?.find(x => x?.type === 'workid');
        if (item) {
          const id = String(item.jobid || '');
          const node = [...doc.querySelectorAll('[jobid]')]
            .find(x => x.getAttribute('jobid') === id)?.closest('.ans-attach-ct');
          const finished = node?.classList.contains('ans-job-finished');
          work = {id, complete:item.job === false ||
            (item.job !== true && (finished === true ||
              (item.isPassed === true && finished !== false)))};
        }
      } catch {}
      if (depth >= 5) return;
      for (const frame of doc.querySelectorAll('iframe'))
        try { if (frame.contentWindow) walk(frame.contentWindow, depth + 1); } catch {}
    }
    walk(window, 0);
    return {chapterId:new URL(location.href).searchParams.get('chapterId') || '',
      v3Active:window.__cxV3?.active || false, v3Status:window.__cxV3?.status || '', work};
  })()`;
  return JSON.parse(await pageCommand('eval', code, '--world', 'MAIN', '--tab', tab));
}

async function resumeStudy() {
  const tabs = await candidateTabs();
  if (tabs.length !== 1) throw new Error(`恢复需要恰好一个学习通标签；当前找到 ${tabs.length} 个`);
  const tab = tabs[0];
  const before = await platformQuizStatus(tab);
  if (!before.work?.id) throw new Error('当前页没有可核验的测验任务');
  if (before.v3Active && before.v3Status === 'running') {
    writeOutput(`${JSON.stringify({event:'already-running', tab})}\n`);
    return;
  }
  if (before.work.complete && before.v3Active && before.v3Status === 'waiting-quiz') {
    writeOutput(`${JSON.stringify({event:'auto-resuming', tab})}\n`);
    return;
  }
  let checked = before;
  if (!before.work.complete) {
    // --resume means the controller has submitted the quiz; refresh once to obtain fresh platform state.
    await pageCommand('eval', 'location.reload(); "reloading"', '--world', 'MAIN', '--tab', tab);
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      try { checked = await platformQuizStatus(tab); } catch { continue; }
      if (checked.chapterId !== before.chapterId) throw new Error('刷新后章节已变化，拒绝自动恢复');
      if (checked.work?.id === before.work.id) break;
    }
  }
  if (checked.work?.id !== before.work.id) throw new Error('刷新后未找到原测验任务，需人工检查');
  await startStudy();
  writeOutput(`${JSON.stringify({event:checked.work.complete ? 'resumed' : 'pending',
    tab, chapterId:checked.chapterId, verified:checked.work.complete})}\n`);
}

function reportHtml(report) {
  const font = /^data:application\/font-[^\s"']+;base64,[A-Za-z0-9+/=]+$/.test(report.fontDataUrl || '')
    ? `@font-face{font-family:cxsecret;src:url("${report.fontDataUrl}") format("truetype")}` : '';
  const questions = (report.questions || []).map(question => {
    const options = (question.options || []).map(option =>
      `<li><b>${escapeHtml(option.label)}</b> ${escapeHtml(option.text)}</li>`).join('');
    const images = (question.images || []).map(img => {
      const embedded = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(img.dataUrl || '')
        && img.dataUrl.length <= 2_000_000;
      return `<li>图片：${escapeHtml(img.path)} ${escapeHtml(img.alt)}` +
        (embedded ? `<br><img src="${img.dataUrl}" alt="${escapeHtml(img.alt)}">` : '') + '</li>';
    }).join('');
    return `<section><h2>第 ${Number(question.index) || '?'} 题 · ${escapeHtml(question.type)}</h2>` +
      `<div class="${question.fontObfuscated ? 'secret' : ''}"><p>${escapeHtml(question.heading)}</p>` +
      `<ol>${options}</ol></div>${images ? `<ul>${images}</ul>` : ''}</section>`;
  }).join('');
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>${escapeHtml(report.title)}</title>` +
    `<style>${font}body{font:18px/1.65 sans-serif;max-width:1000px;margin:24px auto;padding:0 24px;color:#17212b}` +
    `h1{font-size:26px}section{border:1px solid #d6dde3;border-radius:8px;padding:18px;margin:18px 0;break-inside:avoid}` +
    `h2{font:600 17px/1.3 sans-serif;margin:0 0 12px}.secret{font-family:cxsecret,sans-serif}` +
    `p,li{white-space:pre-wrap}ol{list-style:none;padding:0}ol li{margin:7px 0}b{margin-right:12px}` +
    `img{max-width:100%;height:auto}` +
    `small{color:#52616d}</style><h1>${escapeHtml(report.title)}</h1>` +
    `<small>课程 ${escapeHtml(report.courseId)} · 章节 ${escapeHtml(report.chapterId)} · ${report.questionCount} 题</small>` +
    (questions || `<p>${escapeHtml(report.captureNote || '题目未加载，请查看原页面')}</p>`) + '</html>';
}

async function renderPreview(html, target, report) {
  const {chromium} = require('playwright-core');
  const executablePath = browserPath();
  if (!executablePath) throw new Error('未找到浏览器，请设置 CHROME_PATH');
  const browser = await chromium.launch({executablePath, headless:true,
    args:['--no-sandbox', '--disable-background-networking', '--no-first-run']});
  try {
    const context = await browser.newContext({viewport:{width:1100,height:900}, deviceScaleFactor:1});
    await context.route('**/*', route => route.abort());
    const page = await context.newPage();
    await page.setContent(html, {waitUntil:'load'});
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({path:target, fullPage:true});
    chmodSync(target, 0o600);
    const previewDir = join(dirname(target), `${basename(target, '.png')}-questions`);
    const items = [];
    for (const [index, question] of (report.questions || []).entries()) {
      if (!question.fontObfuscated && !question.images?.length) continue;
      mkdirSync(previewDir, {recursive:true, mode:0o700});
      const path = join(previewDir, `q${String(index + 1).padStart(3, '0')}.png`);
      try {
        await page.locator('section').nth(index).screenshot({path});
        chmodSync(path, 0o600);
        items.push({index:index + 1, path, status:'rendered',
          captureIssues:question.captureIssues || []});
      } catch (error) {
        items.push({index:index + 1, status:'failed', reason:String(error.message || error).slice(0, 160)});
      }
    }
    if (!items.length) return {manifest:'', count:0};
    const manifest = join(previewDir, 'manifest.json');
    atomicJson(manifest, {schemaVersion:1, reportId:report.id, items});
    return {manifest, count:items.filter(item => item.status === 'rendered').length};
  } finally { await browser.close(); }
}

async function runtimeSnapshot(tab) {
  const raw = await pageCommand('eval',
    '({live:document.getElementById("cx-v3-status")?.textContent || "", stored:sessionStorage.getItem("cx-v3-runtime") || ""})',
    '--tab', tab);
  const data = JSON.parse(raw);
  const record = JSON.parse(data.live || data.stored || 'null');
  if (!record || record.schemaVersion !== 1) return null;
  return {...record, tab, live:Boolean(data.live), observedAt:new Date().toISOString()};
}

function saveRuntime(tab, snapshot) {
  if (!snapshot) return;
  mkdirSync(OUT, {recursive:true, mode:0o700});
  const target = join(OUT, 'runtime.json');
  const temp = join(OUT, `.runtime-${process.pid}.tmp`);
  writeFileSync(temp, JSON.stringify(snapshot, null, 2), {mode:0o600});
  renameSync(temp, target);
  const previous = runtimes.get(tab);
  if (!previous || previous.status !== snapshot.status || previous.chapterId !== snapshot.chapterId
      || previous.live !== snapshot.live || previous.completed?.length !== snapshot.completed?.length) {
    const event = {at:snapshot.observedAt, tab, runId:snapshot.runId,
      chapterId:snapshot.chapterId, status:snapshot.status, live:snapshot.live,
      completed:snapshot.completed?.length || 0};
    appendRotating(join(OUT, 'events.jsonl'), `${JSON.stringify(event)}\n`);
    writeOutput(`${JSON.stringify({event:'progress', ...event})}\n`);
  }
  if (snapshot.live && snapshot.status === 'needs-review' && previous?.status !== 'needs-review') {
    const name = `incident-${Date.now()}-${tab}.json`;
    const path = join(OUT, name);
    writeFileSync(path, JSON.stringify({at:snapshot.observedAt, tab,
      chapterId:snapshot.chapterId, incident:snapshot.incident,
      lastLog:snapshot.lastLog}, null, 2), {mode:0o600});
    writeOutput(`${JSON.stringify({event:'incident', tab,
      chapterId:snapshot.chapterId, reason:snapshot.incident?.message || '需人工检查', path})}\n`);
  }
  runtimes.set(tab, snapshot);
}

async function monitorRuntime(tab) {
  const previous = runtimes.get(tab);
  const snapshot = await runtimeSnapshot(tab);
  if (!snapshot) return;
  saveRuntime(tab, snapshot);
  // The page can navigate away mid-run, which destroys the injected script; the
  // record then only survives in sessionStorage (live:false). Re-inject once the
  // absence persists, otherwise a single navigation stalls the queue forever.
  if (!snapshot.live) {
    const since = missingSince.get(tab) || Date.now();
    missingSince.set(tab, since);
    if (START && !pending.has(tab) && Date.now() - since > 20000) {
      missingSince.delete(tab);
      await startStudy();
      writeOutput(`${JSON.stringify({event:'recovered', tab,
        chapterId:snapshot.chapterId, reason:'script-lost'})}\n`);
      return;
    }
  } else {
    missingSince.delete(tab);
  }
  if (START && SCHEDULE && snapshot.live && snapshot.status === 'course-boundary') {
    await advanceCourse(tab, snapshot);
    return;
  }
  if (!START || snapshot.live || !previous?.live || previous.status !== 'running'
      || previous.courseId !== snapshot.courseId || pending.has(tab)) return;
  await startStudy();
  writeOutput(`${JSON.stringify({event:'recovered', tab,
    chapterId:snapshot.chapterId, reason:'page-reload'})}\n`);
}

async function monitorPending(tab) {
  const quiz = pending.get(tab);
  if (!quiz) return;
  const status = await platformQuizStatus(tab);
  if (status.chapterId !== quiz.chapterId) {
    const resumed = status.v3Active && status.v3Status === 'running';
    writeOutput(`${JSON.stringify({event:resumed ? 'resumed' : 'chapter-changed', tab,
      from:quiz.chapterId, to:status.chapterId, verified:resumed})}\n`);
    pending.delete(tab);
    if (START && !status.v3Active && status.chapterId) {
      await pageCommand('eval', 'document.getElementById("cx-v3-quiz-report")?.remove(); true',
        '--world', 'MAIN', '--tab', tab);
      await startStudy();
      writeOutput(`${JSON.stringify({event:'recovered', tab,
        chapterId:status.chapterId, reason:'chapter-changed'})}\n`);
    }
    return;
  }
  if (status.v3Active && status.v3Status === 'waiting-quiz') return;
  if (status.v3Active && status.v3Status === 'running') {
    writeOutput(`${JSON.stringify({event:'resumed', tab,
      chapterId:quiz.chapterId, verified:true})}\n`);
    pending.delete(tab);
    return;
  }
  if (['stopped', 'needs-review', 'limit'].includes(status.v3Status)) {
    writeOutput(`${JSON.stringify({event:status.v3Status, tab,
      chapterId:quiz.chapterId})}\n`);
    pending.delete(tab);
    return;
  }
  if (status.v3Active || status.v3Status || status.work?.id !== quiz.jobId) return;
  if (!START) {
    if (!quiz.recoveryNotified) {
      writeOutput(`${JSON.stringify({event:'recovery-needed', tab,
        chapterId:quiz.chapterId})}\n`);
      quiz.recoveryNotified = true;
    }
    return;
  }
  await startStudy();
  writeOutput(`${JSON.stringify({event:'recovered', tab,
    chapterId:quiz.chapterId, verified:status.work.complete})}\n`);
}

async function check() {
  for (const tab of await candidateTabs()) {
    if (!await validStudyLocation(tab)) continue;
    try { await monitorRuntime(tab); runtimeErrors.delete(tab);runtimeFailureCounts.delete(tab); }
    catch (error) {
      const failures=(runtimeFailureCounts.get(tab) || 0)+1;runtimeFailureCounts.set(tab,failures);
      if(failures>=3)throw new Error(`页面状态连续读取失败，需要重新连接：${error.message}`);
      if (!runtimeErrors.has(tab)) {
        writeError(`runtime monitor unavailable on tab ${tab}: ${error.message}\n`);
        runtimeErrors.add(tab);
      }
    }
    try { await monitorPending(tab); monitorErrors.delete(tab); }
    catch (error) {
      if (!monitorErrors.has(tab)) {
        writeError(`resume monitor unavailable on tab ${tab}: ${error.message}\n`);
        monitorErrors.add(tab);
      }
    }
    // A hidden tab never starts loading video; bring it forward when asked.
    const wanted = runtimes.get(tab)?.needsVisible;
    if (wanted && visibleRequests.get(tab) !== wanted) {
      visibleRequests.set(tab, wanted);
      try {
        await pageCommand('activate', tab);
        writeOutput(`${JSON.stringify({event:'activated', tab, reason:'video-needs-visible'})}\n`);
      } catch (error) { writeError(`activate failed: ${error.message}\n`); }
    }
    const raw = await pageCommand('eval', 'document.getElementById("cx-v3-quiz-report")?.textContent || ""',
      '--tab', tab);
    if (!raw) continue;
    let report;
    try { report = JSON.parse(raw); } catch { continue; }
    if (report?.schemaVersion !== 1 || report.kind !== 'quiz' || !report.id) continue;
    const key = `${tab}:${report.id}`;
    if (!pending.has(tab)) pending.set(tab, {id:report.id, jobId:report.jobId,
      chapterId:report.chapterId, recoveryNotified:false});
    if (seen.has(key)) continue;
    seen.add(key);
    mkdirSync(OUT, {recursive:true, mode:0o700});
    const name = `quiz-${createHash('sha256').update(key).digest('hex').slice(0, 16)}`;
    const jsonPath = join(OUT, `${name}.json`);
    const htmlPath = join(OUT, `${name}.html`);
    const pngPath = join(OUT, `${name}.png`);
    let reportRaw=JSON.stringify(report,null,2);
    try {
      const previousRaw=readFileSync(jsonPath,'utf8'),previous=JSON.parse(previousRaw);
      const withoutTimestamp=value=>JSON.stringify({...value,createdAt:undefined});
      if(withoutTimestamp(previous)===withoutTimestamp(report)){report=previous;reportRaw=previousRaw;}
    }catch(error){if(error.code!=='ENOENT' && !(error instanceof SyntaxError))throw error;}
    writeFileSync(jsonPath, reportRaw, {mode:0o600});
    const html = reportHtml(report);
    writeFileSync(htmlPath, html, {mode:0o600});
    let preview = '';
    let questionPreviews = '';
    let previewCount = 0;
    try {
      const rendered = await renderPreview(html, pngPath, report);
      preview = pngPath;
      questionPreviews = rendered.manifest;
      previewCount = rendered.count;
    }
    catch (error) { writeError(`preview failed: ${error.message}\n`); }
    writeOutput(`${JSON.stringify({event:'quiz', tab, id:report.id,
      questionCount:report.questionCount, report:jsonPath, html:htmlPath, preview,
      questionPreviews, previewCount})}\n`);
    return true;
  }
  return false;
}

function reportAnswers() {
  if (!existsSync(OUT)) return;
  for (const name of readdirSync(OUT).filter(value => /^answer-[a-f0-9]{16}\.json$/.test(value))) {
    const path = join(OUT, name);
    let answer;
    try { answer = JSON.parse(readFileSync(path, 'utf8')); } catch { continue; }
    if (answer?.schemaVersion !== 1 || answer.kind !== 'answer-proposal'
        || !['ready', 'needs-review'].includes(answer.status) || !Array.isArray(answer.answers)) continue;
    const report = join(OUT, `quiz-${name.slice(7)}`);
    if (!existsSync(report)) continue;
    const reportRaw = readFileSync(report);
    // During automation only announce answers for the currently observed quiz.
    // Archived proposals must not replace the live task in the side panel.
    if (START) {
      let reportId;
      try { reportId = JSON.parse(reportRaw).id; } catch { continue; }
      if (![...pending.values()].some(quiz => quiz.id === reportId)) continue;
    }
    const sourceHash = createHash('sha256').update(reportRaw).digest('hex');
    if (answer.sourceHash !== sourceHash) continue;
    const key = `${path}:${sourceHash}`;
    if (seenAnswers.has(key)) continue;
    seenAnswers.add(key);
    writeOutput(`${JSON.stringify({event:'answer-proposal', answer:path, report,
      model:answer.model || '', status:answer.status, count:answer.answers.length})}\n`);
  }
}

async function main() {
  if(SCHEDULE)courseConfig=JSON.parse(readFileSync(process.env.CX_COURSE_CONFIG || join(HERE, 'chaoxing-courses.json'), 'utf8'));
  if (SCHEDULE_STATUS) {
    try { writeOutput(`${readFileSync(schedulePath, 'utf8')}\n`); }
    catch { writeOutput('{"status":"no-schedule"}\n'); }
    return;
  }
  if (STATUS) {
    try { writeOutput(`${readFileSync(join(OUT, 'runtime.json'), 'utf8')}\n`); }
    catch { writeOutput('{"status":"no-checkpoint"}\n'); }
    return;
  }
  if (ONCE) { await check(); reportAnswers(); return; }
  if (RESUME) { await resumeStudy(); return; }
  claimController();
  writeOutput(`${JSON.stringify({event:'watching', controller})}\n`);
  if (START) await startStudy();
  let lastWatchError = '';
  while (!scope.aborted) {
    try { await check(); reportAnswers(); lastWatchError = ''; }
    catch (error) {
      if (scope.aborted) break;
      const message = String(error.message || error).slice(0, 500);
      if (message !== lastWatchError) {
        mkdirSync(OUT, {recursive:true, mode:0o700});
        const path = join(OUT, `incident-${Date.now()}-controller.json`);
        writeFileSync(path, JSON.stringify({at:new Date().toISOString(),
          kind:'controller', reason:message}, null, 2), {mode:0o600});
        writeOutput(`${JSON.stringify({event:'incident', kind:'controller',
          reason:message, path})}\n`);
        lastWatchError = message;
      }
    }
    await new Promise(resolve => setTimeout(resolve, POLL_MS));
  }
}

const scope = new RunScope();
bindCancellation(scope);
const bridge = new BridgeClient((...args)=>scope.exec(...args));
main().catch(error => {if(!scope.aborted){writeError(`${error.stack || error}\n`); process.exitCode = 1;}})
  .finally(async () => {await scope.drain();if(process.connected)process.disconnect();});
