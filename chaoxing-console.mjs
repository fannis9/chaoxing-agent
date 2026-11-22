#!/usr/bin/env node
import {createServer} from 'node:http';
import {spawn, execFile} from 'node:child_process';
import {readFileSync, writeFileSync, renameSync, existsSync, mkdirSync,readdirSync} from 'node:fs';
import {basename, dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {consoleAuth} from './lib/console-auth.mjs';
import {createHub} from './lib/agent-hub.mjs';
import {browserPath} from './lib/config.mjs';
import {BridgeClient} from './lib/bridge-client.mjs';
import {inspectCoursePage,inspectAutomationReadiness} from './platforms/chaoxing.mjs';
import {validateCourses} from './lib/course-config.mjs';
import {requestModel,probeModel,validateModel} from './lib/model-client.mjs';
import {ReviewStore} from './lib/review-store.mjs';
import {archivePlan,archiveReports,diagnostics} from './lib/maintenance.mjs';
import {inspectUnavailableQuiz,eligibleForSkip,eligibleVideoFailure,judgeUnavailableQuiz,advanceUnavailableQuiz} from './lib/quiz-skip.mjs';
import {appendRotating} from './lib/maintenance.mjs';
import {Autopilot,initialAutomation} from './lib/autopilot.mjs';
import {AutomaticQueue} from './lib/automatic-queue.mjs';
import {operationHistory} from './lib/operation-history.mjs';
import {recoverySettings} from './lib/recovery-settings.mjs';
import {decideRecovery,recoveryActions} from './lib/incident-recovery.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const dataDir = resolve(process.env.CX_QUIZ_REPORT_DIR || join(root, 'quiz-reports'));
const statePath = join(dataDir, 'console-state.json');
const port = Number(process.env.CX_CONSOLE_PORT || 8788);
const courseFile=process.env.CX_COURSE_CONFIG || join(root,'chaoxing-courses.json');
const auth = consoleAuth(dataDir);
const hub = createHub({token: auth.token});
const reviews = new ReviewStore(dataDir);
const allowedOrigin = /^chrome-extension:\/\/[a-z]{32}$/;
let sawExtensionRequest = false;
let extensionClient = null;
const initial = {mode:'stopped', model:{name:'默认模型', id:process.env.CX_ANSWER_MODEL || '',
  baseUrl:process.env.CX_OPENAI_BASE_URL || '', keyEnv:process.env.CX_ANSWER_API_KEY_ENV || 'OPENAI_API_KEY',protocol:process.env.CX_MODEL_PROTOCOL || 'responses'},
  messages:[], modelActivity:[], updatedAt:new Date().toISOString()};
let state = initial;
try { state = {...initial, ...JSON.parse(readFileSync(statePath, 'utf8'))}; } catch {}
state.automation=initialAutomation(state.automation,process.env.CX_AUTOMATION==='1');
state.autoAnswer=state.autoAnswer!==false;
state.recoverySettings=recoverySettings(state.recoverySettings);
if (state.mode === 'running' || state.mode === 'pausing') state.mode = 'stopped';
try {
  const submitted = new Set(readFileSync(join(dataDir, 'auto-events.jsonl'), 'utf8')
    .split('\n').filter(Boolean).map(line => JSON.parse(line))
    .filter(event => event.event === 'quiz-submitted').map(event => event.id));
  for (const activity of state.modelActivity || []) {
    if ([...submitted].some(id => activity.key?.startsWith(`${id}:`))) activity.status = 'submitted';
  }
} catch { /* no event history yet */ }
let child = null;
let stopping = false;
let outputBuffer = '';
let errorBuffer = '';
let controlRevision=0;
let incidentBusy=false;
const exec = promisify(execFile);
const bridge = new BridgeClient();
const automaticQueue=new AutomaticQueue(bridge,dataDir);
const automaticSchedule=join(dataDir,'automation-schedule.json');

function save() {
  mkdirSync(dataDir, {recursive:true, mode:0o700});
  state.updatedAt = new Date().toISOString();
  const temporary = `${statePath}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(state, null, 2), {mode:0o600});
  renameSync(temporary, statePath);
}
function recordModelActivity(event) {
  const answerPath = resolve(String(event.answer || ''));
  const reportPath = resolve(String(event.report || ''));
  if (dirname(answerPath) !== dataDir || dirname(reportPath) !== dataDir ||
      !/^answer-[a-f0-9]{16}\.json$/.test(basename(answerPath)) ||
      !/^quiz-[a-f0-9]{16}\.json$/.test(basename(reportPath))) return;
  try {
    const answer = JSON.parse(readFileSync(answerPath, 'utf8'));
    const report = JSON.parse(readFileSync(reportPath, 'utf8'));
    if (answer.reportId !== report.id || !Array.isArray(report.questions) ||
        !Array.isArray(answer.answers)) return;
    const keyPrefix = `${answer.reportId}:${answer.sourceHash}:${answer.model}`;
    const key = `${keyPrefix}:${answer.answerPolicyVersion || 0}`;
    const activity = {key, at:answer.createdAt, model:answer.model,
      fontDataUrl:report.fontDataUrl || '',
      title:report.title || '章节测验', chapterId:report.chapterId,
      status:answer.status, questions:report.questions.map(question => {
        const proposal = answer.answers.find(item => item.index === question.index);
        return {index:question.index, text:String(question.text || '').slice(0,600),fontObfuscated:Boolean(question.fontObfuscated),
          answer:proposal?.answerValues?.join('、') || '',
          explanation:String(proposal?.explanation || '').slice(0,600),
          needsReview:Boolean(proposal?.needsReview)};
      })};
    const prior = state.modelActivity.findIndex(item => item.key?.startsWith(keyPrefix));
    if (prior >= 0) {
      if (state.modelActivity[prior].status === 'submitted') activity.status = 'submitted';
      state.modelActivity[prior] = activity;
    }
    else state.modelActivity.push(activity);
    state.modelActivity = state.modelActivity
      .sort((left,right) => String(left.at).localeCompare(String(right.at))).slice(-12);
    save();
  } catch { /* report may be replaced during write */ }
}
function launch(tab,resume=false) {
  if(stopping) throw new Error('正在停止，请等待确认');
  if (child) return;
  const env = {...process.env,CX_RECOVERY_SETTINGS:JSON.stringify(state.recoverySettings), CX_AUTO_ANSWER:state.autoAnswer?'1':'0', CX_ANSWER_MODEL:state.model.id,
    CX_OPENAI_BASE_URL:state.model.baseUrl, CX_ANSWER_API_KEY_ENV:state.model.keyEnv,CX_MODEL_PROTOCOL:state.model.protocol || 'responses', CX_CONSOLE_PORT:String(port), CX_CONSOLE_TOKEN:auth.token};
  if(state.automation.enabled && existsSync(automaticQueue.configPath)){
    env.CX_COURSE_CONFIG=automaticQueue.configPath;env.CX_SCHEDULE_PATH=automaticSchedule;
  }
  state.targetTab = tab;
  outputBuffer = '';
  errorBuffer = '';
  // CX_AGENT_MODE=loop switches chapter driving to the observe/decide/act loop.
  const entry = (process.env.CX_AGENT_MODE || 'classic') === 'loop' ? 'chaoxing-agent-control.mjs' : 'chaoxing-auto.mjs';
  child = spawn(process.execPath, [join(root, entry), `--tab=${tab}`,...(resume?['--restart-page']:[])],
    {cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
  state.mode = 'running';
  state.error = '';
  save();
  child.stdout.on('data', chunk => {
    outputBuffer += String(chunk);
    const lines = outputBuffer.split('\n');
    outputBuffer = lines.pop();
    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        state.event = event;
        if(event.event==='quiz')state.currentQuiz={id:event.id,tab:event.tab};
        if (event.tab) state.targetTab = event.tab;
        if (event.event === 'needs-review' && event.chapterId)
          state.lastQuizIssue = {chapterId:event.chapterId, reason:event.reason || ''};
        if (event.event === 'quiz-submitted' ||
            (event.event === 'progress' && state.lastQuizIssue?.chapterId !== event.chapterId))
          state.lastQuizIssue = null;
        if (event.event === 'answer-proposal') recordModelActivity(event);
        if(event.event==='schedule-complete' && !stopping){
          state.automation.status='complete';state.automation.summary=event.summary || [];
          void halt('stopped').catch(error=>{state.error=String(error.message);save();});
        }
        if ((event.event==='incident' || event.event==='needs-review') && !stopping) {
          state.error=String(event.reason || '页面需要人工检查').slice(0,500);
          incidentBusy=true;
          void handleIncident(event).catch(error=>{state.error=String(error.message);save();}).finally(()=>{
            incidentBusy=false;
            if(!child && state.mode==='needs-review')void autopilot.failed(new Error(state.error || event.reason || '任务需要重试'));
          });
        }
        if (event.event === 'quiz-submitted') {
          const activity = state.modelActivity.find(item => item.key?.startsWith(`${event.id}:`));
          if (activity) activity.status = 'submitted';
        }
        save();
      } catch {}
    }
  });
  child.stderr.on('data', chunk => {
    errorBuffer = (errorBuffer + String(chunk)).slice(-2000);
    state.error = errorBuffer;
    save();
  });
  child.on('exit', code => {
    child = null;
    if (!stopping) {
      state.mode = 'stopped';
      state.error = `${errorBuffer || '控制进程退出'}（代码 ${code}）`.slice(-2000);
      void autopilot.failed(new Error(state.error));
    }
    save();
  });
}
async function halt(mode) {
  controlRevision++;
  if(stopping) throw new Error('正在停止，请等待确认');
  stopping = true;
  state.mode = 'pausing';
  save();
  if (child) {
    const running = child;
    await new Promise(resolve => {
      const timeout = setTimeout(() => running.kill('SIGKILL'),5000);
      running.once('exit',()=>{clearTimeout(timeout);resolve();});
      if(running.connected) running.send({type:'cancel'},()=>{});
      else running.kill();
    });
  }
  const tab = state.targetTab;
  let pageStopped = true;
  if (tab) {
    try {
      await bridge.command('eval','(()=>{window.__cxV3?.stop();return true;})()',
        '--world','MAIN','--tab',String(tab));
      const until=Date.now()+5000;
      let confirmed=false;
      do {
        const raw=await bridge.command('eval','!window.__cxV3?.active','--world','MAIN','--tab',String(tab));
        if(JSON.parse(raw)===true){confirmed=true;break;}
        await new Promise(resolve=>setTimeout(resolve,100));
      } while(Date.now()<until);
      if(!confirmed)throw new Error('页面脚本仍在退出中');
    } catch (error) { pageStopped = false; state.error = `页面停止指令未确认：${error.message}`.slice(0,500); }
  }
  stopping = false;
  state.mode = pageStopped ? mode : 'needs-review';
  save();
}
// Pacing: recovery used to relaunch within a second, so a run of broken chapters
// navigated every few seconds — the pattern that got the account an image-captcha
// page (antispiderShowVerify 9010). Keep a human-ish gap between relaunches.
const relaunchCooldown = () => new Promise(resolve => setTimeout(resolve, 12000 + Math.floor(Math.random() * 8000)));
async function handleIncident(event){
  await halt('needs-review');
  const skipFailure=process.env.CX_SKIP_QUIZ_ERRORS==='1' && event.event==='needs-review';
  const skipVideo=false;
  const recover=state.automation.enabled && process.env.CX_SKIP_QUIZ_ERRORS==='1' && event.event==='incident';
  if(!recover && !skipFailure && !skipVideo && (process.env.CX_AI_SKIP_UNAVAILABLE!=='1' || !/测验.*(?:未加载|无法作答|未创建)/.test(event.reason || '')))return;
  const revision=controlRevision,tab=state.targetTab;
  const current=()=>revision===controlRevision && !child && state.mode==='needs-review';
  const inspect=async()=>JSON.parse(await bridge.command('eval',`(${inspectUnavailableQuiz.toString()})()`,'--world','MAIN','--tab',String(tab)));
  const evidence=await inspect();
  let recoveryDecision;
  if(recover && !eligibleForSkip(evidence)){
    evidence.videoFailure=/视频|播放器/.test(event.reason || '');
    evidence.allowVideoSkip=state.recoverySettings.skipVideo;
    evidence.retryLimit=state.recoverySettings.retryLimit;
    if(event.chapterId && String(event.chapterId)!==evidence.chapterId)return;
    if(existsSync(automaticQueue.configPath))evidence.finalChapter=JSON.parse(readFileSync(automaticQueue.configPath,'utf8')).courses.some(c=>c.courseId===evidence.courseId && c.finalChapterId===evidence.chapterId);
    const attemptPath=join(dataDir,'recovery-attempts.json');let attempts={};
    try{attempts=JSON.parse(readFileSync(attemptPath,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
    const key=`${evidence.courseId}:${evidence.chapterId}`,count=attempts[key] || 0;
    state.event={event:'recovery-check',tab,reason:'AI 正在判断页面故障与恢复动作'};save();
    recoveryDecision=await decideRecovery(state.model,event,evidence,count);
    if(!current())return;
    const fresh=await inspect();Object.assign(fresh,{finalChapter:evidence.finalChapter,videoFailure:evidence.videoFailure,allowVideoSkip:evidence.allowVideoSkip,retryLimit:evidence.retryLimit});
    if(recoveryDecision.action==='wait' && current()){
      state.error='视频恢复次数已用尽，已暂停；自动跳过视频已关闭。可在恢复设置调整或手动继续。';
      await autopilot.setIntent(state.automation.enabled,true);save();return;
    }
    if(fresh.courseId!==evidence.courseId || fresh.chapterId!==evidence.chapterId || !recoveryActions(fresh,count).includes(recoveryDecision.action))return;
    appendRotating(join(dataDir,'recovery-events.jsonl'),JSON.stringify({at:new Date().toISOString(),courseId:evidence.courseId,chapterId:evidence.chapterId,attempt:count,...recoveryDecision})+'\n');
    state.event={event:'recovery-action',tab,...recoveryDecision};save();
    if(['wait','wait-user'].includes(recoveryDecision.action))return;
    attempts[key]=count+1;
    writeFileSync(attemptPath+'.tmp',JSON.stringify(attempts));renameSync(attemptPath+'.tmp',attemptPath);
    if(recoveryDecision.action!=='skip'){
      if(recoveryDecision.action==='reload'){
        await bridge.command('eval',`location.reload(); 'reloading'`,'--tab',String(tab));
        await new Promise(resolve=>setTimeout(resolve,1500));
      }
      if(current()){
        await relaunchCooldown();
        if(!current())return;
        launch(String(tab),true);
      }
      return;
    }
  }
  const allowed=value=>recoveryDecision?.action==='skip' ? recoveryActions({...value,finalChapter:evidence.finalChapter},2).includes('skip') : skipVideo ? eligibleVideoFailure(event,value) : skipFailure ? Boolean(value.work && value.courseId && value.chapterId && !value.requiresUser && !/验证码|人脸识别|身份核验|请.*登录/.test(value.text || '')) : eligibleForSkip(value);
  if(!allowed(evidence) || (event.chapterId && String(event.chapterId)!==evidence.chapterId))return;
  state.event={event:'quiz-skip-check',tab,reason:skipVideo ? '视频等待超时，正在核验并记录待补做' : '正在判断测验是否不可用'};save();
  const decision=recoveryDecision?.action==='skip' ? {skip:true,reason:recoveryDecision.reason} : skipVideo || skipFailure ? {skip:true,reason:`按用户设置跳过失败任务：${String(event.reason || '').slice(0,250)}`} : await judgeUnavailableQuiz(state.model,evidence);
  if(!current())return;
  const fresh=await inspect();
  if(!decision.skip || !allowed(fresh) || fresh.chapterId!==evidence.chapterId || fresh.courseId!==evidence.courseId){
    state.error=decision.reason || '页面已变化，未跳过';save();return;
  }
  const log=event=>appendRotating(join(dataDir,'skipped-quizzes.jsonl'),JSON.stringify({at:new Date().toISOString(),courseId:evidence.courseId,chapterId:evidence.chapterId,reason:decision.reason,...event})+'\n');
  log({status:'skip-intent'});
  const advance=async confirm=>bridge.command('eval',`(${advanceUnavailableQuiz.toString()})(${JSON.stringify(evidence)},${confirm})`,'--world','MAIN','--tab',String(tab));
  if(!current())return;
  if(state.automation.enabled && existsSync(automaticQueue.configPath)){
    const courses=JSON.parse(readFileSync(automaticQueue.configPath,'utf8')).courses;
    if(courses.some(c=>c.courseId===evidence.courseId && c.finalChapterId===evidence.chapterId)){
      log({status:'deferred',courseBoundary:true});launch(String(tab),true);return;
    }
  }
  await advance(false);
  // Poll until the chapter id changes; returns the new chapter, null on timeout,
  // or 'cancelled' when the run was stopped/replaced meanwhile.
  const confirmAdvance = async windowMs => {
    const until=Date.now()+windowMs;let confirmed=false;
    while(current() && Date.now()<until){
      await new Promise(resolve=>setTimeout(resolve,500));
      if(!current())return 'cancelled';
      const next=await inspect();
      if(next.courseId!==evidence.courseId)throw new Error('跳过时课程发生变化，已停止');
      if(next.chapterId && next.chapterId!==evidence.chapterId)return {chapterId:next.chapterId};
      if(!confirmed)confirmed=(await advance(true))==='confirmed';
    }
    return null;
  };
  let moved=await confirmAdvance(15000);
  if(!moved && current()){
    // Some layouts ignore the in-page skip path even though the chapter page has a
    // working 下一节 button. Click it directly, then re-check the chapter id.
    await bridge.command('eval',
      "(()=>{const button=document.getElementById('prevNextFocusNext');if(!button)return 'missing';button.click();return 'clicked'})()",
      '--world','MAIN','--tab',String(tab));
    moved=await confirmAdvance(10000);
  }
  if(moved && moved.chapterId){
    log({status:'deferred',nextChapterId:moved.chapterId});
    state.event={event:'quiz-deferred',tab,chapterId:evidence.chapterId,reason:decision.reason};save();
    await relaunchCooldown();
    if(!current())return;
    launch(String(tab),true);return;
  }
  if(current() && moved!=='cancelled')throw new Error('AI 判断可跳过，但未确认进入下一节；请检查页面');
}
function json(response, status, data) {
  response.writeHead(status, {'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':'no-store'});
  response.end(JSON.stringify(data));
}
function automationStatus(){
  const info={...state.automation};
  try{
    const queue=automaticQueue.read();let completed=[];
    try{completed=JSON.parse(readFileSync(automaticSchedule,'utf8')).completed || [];}catch{}
    info.courses=(queue?.courses || []).map(c=>({name:c.name,courseId:c.courseId,status:completed.find(r=>r.courseId===c.courseId)?.status || c.status,reason:c.reason || ''}));
    info.excluded=queue?.excluded?.length || 0;
    const deferred=new Map();
    for(const suffix of ['', '.1','.2','.3'])try{
      for(const line of readFileSync(join(dataDir,'skipped-quizzes.jsonl'+suffix),'utf8').split('\n').filter(Boolean)){
        const row=JSON.parse(line);if(row.status==='deferred')deferred.set(`${row.courseId}:${row.chapterId}`,{courseId:row.courseId,chapterId:row.chapterId,reason:row.reason});
      }
    }catch{}
    info.deferred=[...deferred.values()];
  }catch{}
  return info;
}
async function body(request) {
  let raw = '';
  for await (const part of request) {
    raw += part;
    if (raw.length > 100000) throw new Error('请求过大');
  }
  return raw ? JSON.parse(raw) : {};
}
async function modelCall(input) {
  const result=await requestModel(state.model,{input});
  state.lastModelUsage={...result.usage,durationMs:result.durationMs};
  return result.text;
}
const server = createServer(async (request,response) => {
  const origin = request.headers.origin || '';
  if ((origin && !allowedOrigin.test(origin)) ||
      (request.method === 'OPTIONS' && !origin) ||
      (request.method !== 'OPTIONS' && request.headers['x-cx-console'] !== '1')) {
    json(response,403,{error:'扩展来源无效'}); return;
  }
  if (origin) {
    response.setHeader('Access-Control-Allow-Origin',origin);
    response.setHeader('Vary','Origin');
  }
  response.setHeader('Access-Control-Allow-Headers','Content-Type, X-CX-Console, Authorization, X-CX-Extension-Version');
  response.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Private-Network','true');
  if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
  if (!auth.accepts(request.headers.authorization)) {
    json(response,401,{error:'请先在连接设置中填写本机控制台配对令牌'}); return;
  }
  // This is authenticated client telemetry, not proof of an extension's identity.
  // Privileged extension requests may omit Origin; keep that case distinct.
  const clientVersion=String(request.headers['x-cx-extension-version'] || '');
  if((origin && allowedOrigin.test(origin)) || /^\d+(?:\.\d+){1,3}$/.test(clientVersion)){
    extensionClient={id:origin ? origin.slice('chrome-extension://'.length) : null,
      identification:origin ? 'origin' : 'version-header',lastSeenAt:new Date().toISOString(),
      version:clientVersion.slice(0,30) || 'unknown'};
    if(!sawExtensionRequest){sawExtensionRequest=true;console.log('已接收通过认证的扩展请求');}
  }
  try {
    const route = new URL(request.url,'http://localhost').pathname;
    if (route === '/agent/command' && request.method === 'POST') {
      const input = await body(request);
      if (!/^[a-z_]+$/.test(String(input.cmd || ''))) throw new Error('cmd 无效');
      const result = await hub.command(input.cmd, input.args || {}, {timeoutMs: Number(input.timeoutMs) || 20000});
      json(response, 200, {ok: true, result}); return;
    }
    if (route === '/status' && request.method === 'GET') {
      json(response,200,{...state,operations:operationHistory(dataDir),automation:automationStatus(),connected:true,extensionClient,agent:hub.status(),keyConfigured:Boolean(process.env[state.model.keyEnv]),pid:child?.pid || null,
        setup:{bridgeInstalled:hub.status().agent,browserInstalled:Boolean(browserPath()),coursesConfigured:existsSync(courseFile)}}); return;
    }
    if (route === '/tabs' && request.method === 'GET') {
      const tabs=(await bridge.tabs()).filter(tab=>/^https:\/\/(?:i|mooc1(?:-[a-z0-9]+)?|mooc2-ans)\.chaoxing\.com\//.test(tab.url));
      json(response,200,{tabs:tabs.map(({id,title})=>({id,title}))});return;
    }
    if(route === '/reviews' && request.method === 'GET'){json(response,200,{items:reviews.list()});return;}
    if(route === '/diagnostics' && request.method === 'GET'){json(response,200,diagnostics(dataDir,state));return;}
    if (request.method !== 'POST') { json(response,404,{error:'未知接口'}); return; }
    const input = await body(request);
    if(route==='/recovery-settings'){
      const settings=recoverySettings(input);
      const running=Boolean(child),paused=state.automation.userPaused;
      await autopilot.setIntent(state.automation.enabled,true);await halt('paused');
      state.recoverySettings=settings;save();
      await autopilot.setIntent(state.automation.enabled,paused);
      if(running && !paused)launch(String(state.targetTab),true);
      json(response,200,{recoverySettings:settings});return;
    }
    if(route==='/auto-answer'){
      if(typeof input.enabled!=='boolean')throw new Error('自动答题参数无效');
      const wasRunning=Boolean(child),wasPaused=state.automation.userPaused;
      await autopilot.setIntent(state.automation.enabled,true);
      await halt('paused');
      state.autoAnswer=input.enabled;save();
      await autopilot.setIntent(state.automation.enabled,wasPaused);
      if(wasRunning && !wasPaused)launch(String(state.targetTab),true);
      json(response,200,{autoAnswer:state.autoAnswer});return;
    }
    if(route==='/automation'){
      if(typeof input.enabled!=='boolean')throw new Error('自动模式参数无效');
      if(input.enabled){validateModel(state.model);if(!process.env[state.model.keyEnv])throw new Error('请先配置模型密钥');}
      await autopilot.setIntent(false,true);
      await halt('paused');
      await autopilot.setIntent(input.enabled,false);
      if(input.enabled)void autopilot.tick().catch(error=>{state.error=String(error.message);save();});
      json(response,200,{automation:automationStatus()});return;
    }
    if(route === '/maintenance/preview'){json(response,200,archivePlan(dataDir,Number(input.days || 30)));return;}
    if(route === '/maintenance/archive'){
      if(child || stopping)throw new Error('请先停止队列再归档');
      json(response,200,archiveReports(dataDir,Number(input.days || 30)));return;
    }
    if(route === '/reviews/read'){json(response,200,reviews.read(input.key));return;}
    if(route === '/reviews/save'){
      if(child || stopping)throw new Error('请先暂停队列再保存人工复核结果');
      const result=reviews.save(input);json(response,200,result);return;
    }
    if(route === '/reviews/retry'){
      const pair=reviews.read(input.key);
      if(!child?.connected || stopping)throw new Error('请先继续已绑定的队列，再重试当前测验');
      if(state.currentQuiz?.id!==pair.report.id)throw new Error('只能重试当前队列正在处理的测验');
      child.send({type:'retry-quiz',reportId:pair.report.id,forceModel:true});
      json(response,200,{queued:true});return;
    }
    if(route === '/courses/preview') {
      if(!/^\d+$/.test(String(input.tab)))throw new Error('请选择学习通课程标签');
      const result=JSON.parse(await bridge.command('eval',`(${inspectCoursePage.toString()})()`,'--world','MAIN','--tab',String(input.tab)));
      json(response,200,{preview:result});return;
    }
    if(route === '/courses/save') {
      if(child || stopping)throw new Error('请停止队列后修改课程');
      const next=validateCourses(input.config);
      // Keep an explicit recoverable backup when replacing a queue.
      if(existsSync(courseFile))writeFileSync(`${courseFile}.backup`,readFileSync(courseFile),{mode:0o600});
      const temporary=`${courseFile}.${process.pid}.tmp`;
      writeFileSync(temporary,JSON.stringify(next,null,2),{mode:0o600});renameSync(temporary,courseFile);
      json(response,200,{saved:next.courses.length});return;
    }
    if (route === '/control') {
      if (input.action === 'start' || input.action === 'resume') {
        await autopilot.setIntent(state.automation.enabled,false);
        const tab=String(input.action === 'resume' ? state.targetTab || '' : input.tab || '');
        if(!/^\d+$/.test(tab)) throw new Error('请先选择要控制的学习通标签');
        const target=(await bridge.tabs()).find(item=>item.id===tab);
        if(!target || !/^https:\/\/(?:i|mooc1(?:-[a-z0-9]+)?|mooc2-ans)\.chaoxing\.com\//.test(target.url))
          throw new Error('绑定标签不存在或已离开学习通，请重新选择');
        launch(tab,input.action==='resume');
      }
      else if (input.action === 'pause') {await autopilot.setIntent(state.automation.enabled,true);await halt('paused');}
      else if (input.action === 'stop') {await autopilot.setIntent(state.automation.enabled,true);await halt('stopped');}
      else throw new Error('未知操作');
      json(response,200,{mode:state.mode}); return;
    }
    if (route === '/model') {
      if (child) throw new Error('请先暂停运行再切换模型');
      const next = {name:String(input.name || input.id || '').slice(0,80),
        id:String(input.id || ''),baseUrl:String(input.baseUrl || ''),keyEnv:String(input.keyEnv || ''),protocol:String(input.protocol || 'responses')};
      if (!/^[A-Za-z0-9._:/-]{1,200}$/.test(next.id) || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(next.keyEnv))
        throw new Error('模型配置格式无效');
      validateModel(next);
      state.model = next; state.modelCapabilities=null;save(); json(response,200,{model:next}); return;
    }
    if (route === '/test-model') {
      const model={...state.model};
      const capabilities=await probeModel(model);
      if(JSON.stringify(model)===JSON.stringify(state.model)){state.modelCapabilities=capabilities;save();}
      json(response,200,capabilities); return;
    }
    if (route === '/chat') {
      const question = String(input.text || '').slice(0,10000);
      if (!question) throw new Error('消息为空');
      const answer = await modelCall([...state.messages.slice(-12).map(message => ({role:message.role,content:message.text})),
        {role:'user',content:question}]);
      state.messages.push({role:'user',text:question},{role:'assistant',text:answer});
      state.messages = state.messages.slice(-40); save();
      json(response,200,{answer}); return;
    }
    if (route === '/clear-chat') {
      state.messages = []; save(); json(response,200,{ok:true}); return;
    }
    json(response,404,{error:'未知接口'});
  } catch (error) { json(response,400,{error:String(error.message || error)}); }
});
server.on('error',error=>{console.error(error.code==='EADDRINUSE'?'控制台端口已被占用，请检查已有实例或更改 CX_CONSOLE_PORT':String(error.message));process.exitCode=1;});
const autopilot=new Autopilot(state.automation,{
  save:()=>save(),running:()=>Boolean(child || stopping || incidentBusy),
  prepare:async current=>{
    if(!process.env[state.model.keyEnv] || !state.model.id || !state.model.baseUrl)return {wait:'waiting-model'};
    const connection=JSON.parse(await bridge.command('status','--no-autostart','--json'));
    if(connection && !connection.connected)return {wait:'waiting-browser'};
    const tabs=await bridge.tabs();if(!current())return;
    const studies=tabs.filter(tab=>/^https:\/\/mooc1(?:-[a-z0-9]+)?\.chaoxing\.com\/mycourse\/studentstudy/.test(tab.url));
    let chosen=studies.find(tab=>tab.id===String(state.targetTab)) || studies[0];
    if(chosen){
      const readiness=JSON.parse(await bridge.command('eval',`(${inspectAutomationReadiness.toString()})()`,'--world','MAIN','--tab',chosen.id));
      if(readiness.requiresUser || !readiness.courseId)return {wait:'waiting-user'};
    }
    if(!tabs.some(tab=>/^https:\/\/(?:i|mooc1(?:-[a-z0-9]+)?|mooc2-ans)\.chaoxing\.com\//.test(tab.url)))return {wait:'waiting-login'};
    const preferred=chosen?new URL(chosen.url).searchParams.get('courseId'):null;
    const queue=await automaticQueue.discover(tabs,preferred,current);
    if(queue.waitingLogin)return {wait:'waiting-login'};
    if(!current())return;
    state.automation.queue=queue.courses.map(({courseId,name,status,reason})=>({courseId,name,status,reason}));
    if(!queue.courses.some(c=>c.status==='pending'))return {complete:true,summary:state.automation.queue};
    try{const schedule=JSON.parse(readFileSync(automaticSchedule,'utf8'));if(schedule.status==='complete')return {complete:true,summary:schedule.completed};}catch(error){if(error.code!=='ENOENT')throw error;}
    if(!chosen){
      const course=queue.courses.find(c=>c.status==='pending');
      const opened=JSON.parse(await bridge.command('open',course.url,'--background','--json'));
      return {tab:String(opened.tabId)};
    }
    return {tab:chosen.id};
  },
  launch:async(ready,current)=>{if(current())launch(ready.tab,true);},
});
for(const name of readdirSync(dataDir).filter(n=>/^answer-[a-f0-9]{16}\.json$/.test(n)))
  recordModelActivity({answer:join(dataDir,name),report:join(dataDir,name.replace(/^answer-/,'quiz-'))});
server.on('upgrade',(request,socket)=>hub.upgrade(request,socket));
server.listen(port,'127.0.0.1',() => {
  save();
  console.log(`学习通控制台监听 127.0.0.1:${server.address().port}`);
  console.log(`配对令牌文件：${auth.path}`);
  const timer=setInterval(()=>void autopilot.tick().catch(error=>console.error(String(error.message))),10000);timer.unref();
  void autopilot.tick().catch(error=>console.error(String(error.message)));
});
