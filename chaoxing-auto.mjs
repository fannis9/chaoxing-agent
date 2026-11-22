#!/usr/bin/env node
// One long-running process: discover the logged-in tab, run the study controller,
// solve reported quizzes, fill the page, submit complete answers, and monitor recovery.
import {spawn, execFile} from 'node:child_process';
import {existsSync, readFileSync, appendFileSync, mkdirSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {RunScope,bindCancellation} from './lib/run-scope.mjs';
import {BridgeClient} from './lib/bridge-client.mjs';
import {QuizJournal} from './lib/quiz-journal.mjs';
import {appendRotating} from './lib/maintenance.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = process.env.CX_QUIZ_REPORT_DIR || join(HERE, 'quiz-reports');
const COURSE_FILE = process.env.CX_COURSE_CONFIG || join(HERE, 'chaoxing-courses.json');
const SUBMIT = readFileSync(join(HERE, 'chaoxing-submit-page.js'), 'utf8').trim();
const scope = new RunScope();
bindCancellation(scope);
const exec = (...args) => scope.exec(...args);
const bridge = new BridgeClient(exec);
const tabArg = process.argv.find(arg => arg.startsWith('--tab='))?.slice(6);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const busy = new Set();
const handled = new Set();
const retryCount = new Map();
const quizEvents = new Map();
const journal = new QuizJournal(OUT);
let stopped = false;

function emit(event) {
  const line = JSON.stringify({at:new Date().toISOString(), ...event});
  process.stdout.write(`${line}\n`);
  mkdirSync(OUT, {recursive:true, mode:0o700});
  appendRotating(join(OUT, 'auto-events.jsonl'), `${line}\n`);
  if (event.tab && ['started','progress','quiz','quiz-retry','quiz-submitted','needs-review','schedule-complete'].includes(event.event)) {
    const state = JSON.stringify({at:new Date().toISOString(), event:event.event,
      status:event.status || '', reason:event.reason || '', chapterId:event.chapterId || ''});
    const code = `(() => {const id='cx-auto-console-state';let node=document.getElementById(id);`
      + `if(!node){node=document.createElement('script');node.id=id;node.type='application/json';document.body.appendChild(node);}`
      + `const next=${JSON.stringify(state)};const prev=JSON.parse(node.textContent||'null');`
      + `if(!prev||prev.at<=JSON.parse(next).at)node.textContent=next;return true})()`;
    void page('eval', code, '--world', 'MAIN', '--tab', String(event.tab)).catch(() => {});
  }
}

async function page(...args) {
  return bridge.command(...args);
}

async function findTab() {
  while (!scope.aborted) {
    const rows = await bridge.tabs();
    const candidates = rows.filter(row => /^https:\/\/(?:i|mooc1(?:-[a-z0-9]+)?|mooc2-ans)\.chaoxing\.com\//.test(row.url));
    const studies = candidates.filter(row => row.url.includes('/mycourse/studentstudy'));
    if (!tabArg && studies.length > 1) throw new Error('发现多个学习章节，请使用 --tab 明确选择目标标签');
    const study = studies[0];
    const directories = candidates.filter(row => /\/mycourse\/(stu|studentcourse)/.test(row.url));
    const selected = tabArg ? candidates.find(row => row.id === tabArg) :
      study || (directories.length === 1 ? directories[0] : null) ||
      (candidates.length === 1 ? candidates[0] : null);
    if (selected) return selected;
    await sleep(5000);
  }
  throw new Error('已停止');
}

async function prepareStudyTab(tab) {
  const isStudy=/^https:\/\/mooc1(?:-[a-z0-9]+)?\.chaoxing\.com\/mycourse\/studentstudy/.test(tab.url);
  if(isStudy && !existsSync(COURSE_FILE))return tab.id;
  if (!existsSync(COURSE_FILE)) throw new Error('自动发现章节需要 chaoxing-courses.json 一次性课程配置');
  const config = JSON.parse(readFileSync(COURSE_FILE, 'utf8'));
  if (config.schemaVersion !== 1 || !Array.isArray(config.courses) || !config.courses.length)
    throw new Error('课程配置无效');
  let index = 0;
  try {
    const checkpoint = JSON.parse(readFileSync(process.env.CX_SCHEDULE_PATH || join(OUT, 'schedule.json'), 'utf8'));
    if (checkpoint.schemaVersion === 1 && Number.isInteger(checkpoint.index)) index = checkpoint.index;
  } catch { /* first run */ }
  const course = config.courses[index];
  if (!course) throw new Error('课程队列已到末尾');
  if(isStudy && (!config.autoDiscovered || new URL(tab.url).searchParams.get('courseId')===course.courseId))return tab.id;
  const visit = new URL('https://mooc1.chaoxing.com/visit/stucoursemiddle');
  visit.search = new URLSearchParams({courseid:course.courseId, clazzid:course.clazzId,
    cpi:config.cpi, ismooc2:'1', v:'2'}).toString();
  await page('navigate', String(visit), '--tab', tab.id);
  let enc = '';
  for (let i = 0; i < 30; i++) {
    const url = await bridge.url(tab.id);
    if (url.includes('/mycourse/stu')) { enc = new URL(url).searchParams.get('enc') || ''; break; }
    await sleep(1000);
  }
  if (!/^[a-f0-9]+$/i.test(enc)) throw new Error('课程目录未提供有效入口参数');
  const directory = new URL('https://mooc2-ans.chaoxing.com/mooc2-ans/mycourse/studentcourse');
  directory.search = new URLSearchParams({courseid:course.courseId, clazzid:course.clazzId,
    enc, cpi:config.cpi, v:'2'}).toString();
  await page('navigate', String(directory), '--tab', tab.id);
  for (let i = 0; i < 30; i++) {
    if ((await bridge.url(tab.id)).includes('/mycourse/studentcourse')) break;
    await sleep(1000);
  }
  const details = JSON.parse(await page('eval', `(() => {
    const old = String(window.toOld || '');
    return {courseId:new URL(location.href).searchParams.get('courseid'),
      enc:old.match(/var\\s+enc\\s*=\\s*["']([a-f0-9]+)["']/i)?.[1] || '',
      firstExists:!!document.getElementById('cur${course.firstChapterId}')};
  })()`, '--world', 'MAIN', '--tab', tab.id));
  if (details.courseId !== course.courseId || !details.firstExists
      || !/^[a-f0-9]+$/i.test(details.enc))
    throw new Error('课程目录与配置不一致，无法自动打开首章');
  const study = new URL('https://mooc1.chaoxing.com/mycourse/studentstudy');
  let resumeChapter=course.firstChapterId;
  try{const runtime=JSON.parse(readFileSync(join(OUT,'runtime.json'),'utf8'));
    if(runtime.courseId===course.courseId && /^\d+$/.test(runtime.chapterId))resumeChapter=runtime.chapterId;
  }catch{}
  study.search = new URLSearchParams({chapterId:resumeChapter, courseId:course.courseId,
    clazzid:course.clazzId, cpi:config.cpi, enc:details.enc, mooc2:'1'}).toString();
  await page('navigate', String(study), '--tab', tab.id);
  emit({event:'course-opened', courseId:course.courseId, tab:tab.id});
  return tab.id;
}

async function child(script, args) {
  const {stdout} = await exec(process.execPath, [join(HERE, script), ...args],
    {timeout:600000, maxBuffer:4 * 1024 * 1024});
  const lines = stdout.trim().split('\n').filter(Boolean);
  return lines.length ? JSON.parse(lines.at(-1)) : null;
}

async function submit(tab, report, verifyOnly=false) {
  const runPhase = async phase => {
    const raw = await page('eval', `${SUBMIT}(${JSON.stringify({phase, reportId:report.id,
      jobId:report.jobId, chapterId:report.chapterId})})`,
      '--world', 'MAIN', '--tab', tab);
    return JSON.parse(raw);
  };
  if(verifyOnly) return Boolean((await runPhase('status')).completed);
  journal.write(report.id,'submitting',{tab,chapterId:report.chapterId});
  const opened = await runPhase('open');
  if (!opened.ok) throw new Error(`打开提交确认失败：${opened.reason}`);
  let confirmed = false;
  for (let i = 0; i < 10; i++) {
    await sleep(500);
    const result = await runPhase('confirm');
    if (result.ok) { confirmed = true; break; }
  }
  if (!confirmed) throw new Error('未找到可用的提交确认按钮');
  for (let i = 0; i < 60; i++) {
    await sleep(1000);
    scope.assertActive();
    try { if ((await runPhase('status')).completed) return; } catch { /* page changing */ }
  }
  throw new Error('提交后平台未确认测验完成');
}

async function handleQuiz(event) {
  if(process.env.CX_AUTO_ANSWER==='0'){
    emit({event:'answer-disabled',tab:event.tab,id:event.id,reason:'自动答题已关闭，等待手动作答'});
    return;
  }
  if (scope.aborted) return;
  const key = `${event.tab}:${event.id}`;
  if (handled.has(key) || busy.has(key)) return;
  busy.add(key);
  let report;
  try {
    report = JSON.parse(readFileSync(event.report, 'utf8'));
    const previous=journal.read(report.id);
    if(previous && ['submitting','submitted'].includes(previous.phase)) {
      if(await submit(event.tab,report,true)) {
        journal.write(report.id,'submitted',{tab:event.tab,recovered:true});
        handled.add(key);
        emit({event:'quiz-submitted',tab:event.tab,id:event.id,recovered:true});
        return;
      }
      throw new Error('此前可能已提交该测验，平台尚未确认；请人工核验，系统不会重复提交');
    }
    journal.write(report.id,'solving',{tab:event.tab});
    await child('chaoxing-answer-worker.mjs', ['--once', `--report=${event.report}`,...(event.forceModel?['--force']:[])]);
    const answer = join(dirname(event.report), `answer-${event.report.match(/quiz-([a-f0-9]{16})\.json$/)?.[1]}.json`);
    const proposal = JSON.parse(readFileSync(answer, 'utf8'));
    emit({event:'answer-proposal', report:event.report, answer,
      model:proposal.model, status:proposal.status, count:proposal.answers?.length || 0});
    if (proposal.status !== 'ready') {
      if(process.env.CX_SKIP_QUIZ_ERRORS!=='1' && proposal.answers.some(answer=>answer.needsReview===false && answer.answerValues?.length)) {
        journal.write(report.id,'filling',{tab:event.tab,partial:true});
        const partial=await child('chaoxing-page-filler.mjs',[`--answer=${answer}`,`--tab=${event.tab}`,'--apply']);
        emit({event:'quiz-partially-filled',tab:event.tab,id:event.id,filled:partial.filled?.length || 0,
          skipped:partial.skipped?.length || 0,failed:partial.failed?.length || 0,submitted:false});
        journal.write(report.id,'needs-review',{tab:event.tab,partial:true});
      }
      const pending = proposal.answers.filter(answer => answer.needsReview)
        .map(answer => `第 ${answer.index} 题：${answer.explanation.slice(0, 120)}`);
      throw new Error(`模型答案需复核；${pending.join('；')}`);
    }
    journal.write(report.id,'ready',{tab:event.tab,sourceHash:proposal.sourceHash});
    journal.write(report.id,'filling',{tab:event.tab,sourceHash:proposal.sourceHash});
    const filled = await child('chaoxing-page-filler.mjs', [`--answer=${answer}`, `--tab=${event.tab}`, '--apply']);
    if (filled?.event !== 'fill-result' || filled.failed?.length || filled.skipped?.length
        || filled.filled?.length !== report.questions.length) throw new Error('页面填写未全部确认');
    journal.write(report.id,'filled',{tab:event.tab,sourceHash:proposal.sourceHash});
    await submit(event.tab, report);
    journal.write(report.id,'submitted',{tab:event.tab,sourceHash:proposal.sourceHash});
    handled.add(key);
    emit({event:'quiz-submitted', tab:event.tab, id:event.id, questions:report.questions.length});
  } catch (error) {
    if (scope.aborted) return;
    const reason = String(error.message || error);
    const retries = retryCount.get(key) || 0;
    if (!stopped && retries < 1 && /timeout|timed out|HTTP (429|500|502|503|504)/i.test(reason)) {
      retryCount.set(key, retries + 1);
      emit({event:'quiz-retry', tab:event.tab, id:event.id, reason:'模型请求暂时失败，30 秒后重试'});
      setTimeout(() => { if (!scope.aborted) void handleQuiz(event); }, 30000).unref();
    } else {
      handled.add(key);
      emit({event:'needs-review', tab:event.tab, id:event.id,
        chapterId:report?.chapterId || '', reason:reason.slice(0,500)});
    }
  } finally { busy.delete(key); }
}

async function main() {
  if (process.argv.includes('--help')) {
    process.stdout.write('用法: node chaoxing-auto.mjs [--tab=标签ID]\n先配置课程文件及模型环境变量；进程会等待登录。\n');
    return;
  }
  const keyName = process.env.CX_ANSWER_API_KEY_ENV || 'OPENAI_API_KEY';
  if (!process.env[keyName]) throw new Error(`缺少模型密钥环境变量 ${keyName}`);
  emit({event:'waiting-for-login'});
  const tab = await prepareStudyTab(await findTab());
  const args = ['--start', `--tab=${tab}`];
  if(process.argv.includes('--restart-page'))args.push('--restart-page');
  if (existsSync(COURSE_FILE)) args.push('--schedule');
  scope.assertActive();
  const controller = scope.track(spawn(process.execPath, [join(HERE, 'chaoxing-quiz-control.mjs'), ...args],
    {env:process.env, windowsHide:true, stdio:['ignore','pipe','pipe','ipc']}));
  let buffer = '';
  controller.stdout.on('data', chunk => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      let event;
      try { event = JSON.parse(line); } catch { continue; }
      emit(event);
      if (event.event === 'quiz') {quizEvents.set(event.id,event);void handleQuiz(event);}
    }
  });
  controller.stderr.on('data', chunk => process.stderr.write(chunk));
  const stop = () => { stopped = true; scope.cancel(); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  process.on('message', message => {if(message?.type === 'cancel') stop();});
  process.on('message',message=>{
    if(message?.type!=='retry-quiz' || scope.aborted)return;
    const event=quizEvents.get(message.reportId);if(!event)return;
    const key=`${event.tab}:${event.id}`;if(busy.has(key))return;
    handled.delete(key);retryCount.delete(key);
    void handleQuiz({...event,forceModel:Boolean(message.forceModel)});
  });
  const code = await new Promise(resolve => controller.on('close', resolve));
  if (!scope.aborted) { scope.cancel(); throw new Error(`控制端退出：${code}`); }
}

main().catch(error => { scope.cancel(); process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; })
  .finally(async () => {await scope.drain();if(process.connected)process.disconnect();});
