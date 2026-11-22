#!/usr/bin/env node
// Agent-mode controller: observe -> decide -> act -> verify, replacing the fixed
// chapter state machine. Quiz chapters are handed back to the classic pipeline
// (the page script owns reporting/submission there).
import {mkdirSync, renameSync, writeFileSync as writeFile} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {BridgeClient} from './lib/bridge-client.mjs';
import {step, act} from './lib/agent-loop.mjs';
import {readScene} from './lib/probe.mjs';
import {ensureReport, runQuiz} from './lib/quiz-run.mjs';
import {appendRotating} from './lib/maintenance.mjs';
import {advanceSchedule, enterCourse, loadQueue, saveSchedule} from './lib/course-run.mjs';
import {detectPlatform} from './platforms/registry.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = process.env.CX_QUIZ_REPORT_DIR || join(HERE, 'quiz-reports');
const tabArg = process.argv.find(arg => arg.startsWith('--tab='))?.slice(6);
const dryRun = process.argv.includes('--dry-run');
const maxSteps = Number(process.argv.find(arg => arg.startsWith('--max-steps='))?.slice(12) || 0);
const paceMs = Number(process.env.CX_AGENT_PACE_MS || 4000);

const model = {
  id: process.env.CX_ANSWER_MODEL || 'deepseek-flash',
  baseUrl: process.env.CX_OPENAI_BASE_URL || 'https://api.deepseek.com',
  keyEnv: process.env.CX_ANSWER_API_KEY_ENV || 'DEEPSEEK_API_KEY',
  protocol: process.env.CX_MODEL_PROTOCOL || 'responses',
};

const bridge = new BridgeClient();
const RUN_ID = crypto.randomUUID();
const log = [];
// Keep runtime.json (panel/console read it) in sync with the agent's view.
function saveRuntime(scene, status = 'running') {
  const record = {
    schemaVersion: 1, runId: RUN_ID, agent: true,
    courseId: new URL(scene.url).searchParams.get('courseId') || '',
    chapterId: scene.chapter.id, status, active: true, completed: [],
    video: scene.player ? {time: scene.player.currentTime, duration: scene.player.duration,
      rate: scene.player.rate, paused: scene.player.paused} : null,
    incident: null, lastLog: log.slice(-12), updatedAt: new Date().toISOString(),
    tab: scene.url, live: true,
  };
  try {
    mkdirSync(OUT, {recursive: true, mode: 0o700});
    const target = join(OUT, 'runtime.json');
    writeFile(`${target}.tmp`, JSON.stringify(record, null, 2), {mode: 0o600});
    renameSync(`${target}.tmp`, target);
  } catch { /* best effort */ }
}
const emit = event => process.stdout.write(`${JSON.stringify({at: new Date().toISOString(), ...event})}\n`);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function resolveTab() {
  if (tabArg) return tabArg;
  const tabs = await bridge.tabs();
  const study = tabs.find(tab => detectPlatform(tab.url)?.isStudyPage(tab.url));
  if (!study) throw new Error('没有找到学习章节页；可用 --tab=<id> 指定');
  return study.id;
}

async function main() {
  let tab = await resolveTab();
  // 学习页若能独占一个窗口，平台就不会因为标签切换而暂停播放。
  try {
    const rows = await bridge.tabs();
    const mine = rows.find(row => row.id === String(tab));
    const sharing = mine?.windowId !== undefined
      ? rows.some(row => row.id !== String(tab) && row.windowId === mine.windowId) : false;
    if (sharing) {
      const result = JSON.parse(await bridge.command('open_window', '--tab', String(tab)));
      if (result?.tabId) {
        tab = String(result.tabId);
        emit({event: 'own-window', tab, windowId: result.windowId});
      }
    }
  } catch (error) {
    emit({event: 'own-window-skip', reason: String(error.message || error).slice(0, 120)});
  }
  try {
    await bridge.command('eval', '1+1', '--world', 'MAIN', '--tab', String(tab));
  } catch {
    emit({event: 'page-unresponsive', tab});
    try {
      const rows = await bridge.tabs();
      const row = rows.find(item => item.id === String(tab));
      if (row?.url) await bridge.command('navigate', row.url, '--tab', String(tab));
    } catch { /* 标签可能已关闭 */ }
    await sleep(8000);
  }
  emit({event: 'started', tab, mode: dryRun ? 'dry-run' : 'act', platform: detectPlatform(await bridge.url(String(tab)).catch(() => ''))?.id || null});
  let lastChapter = '';
  let chaptersSinceReload = 0;
  const history = [];

  let consecutiveFailures = 0;
  let delegatedChapter = null;
  const modelCalls = new Map();
  const videoLoops = new Map();
  for (let index = 0; !maxSteps || index < maxSteps; index += 1) {
    let outcome;
    try {
      outcome = await step({
      bridge, tab, model, dataDir: OUT, history, dryRun,
      });
      consecutiveFailures = 0;
    } catch (error) {
      consecutiveFailures += 1;
      let reason = String(error.message || error);
      if (/No tab with id/i.test(reason)) {
        try {
          const rows = await bridge.tabs();
          const next = rows.find(row => detectPlatform(row.url)?.isStudyPage(row.url));
          if (next) { tab = next.id; delegatedChapter = null; reason = `切换标签 ${next.id}`; }
        } catch { /* 浏览器可能已关闭 */ }
      }
      emit({event: 'incident', tab, reason: reason.slice(0, 200)});
      if (consecutiveFailures >= 5) throw error;
      // 页面卡死时 eval 会超时；用 tabs.update 重载（不依赖渲染进程）自救。
      if (/超时|timeout/i.test(reason)) {
        try {
          const rows = await bridge.tabs();
          const row = rows.find(item => item.id === String(tab));
          if (row?.url) await bridge.command('navigate', row.url, '--tab', String(tab));
        } catch { /* 标签可能已关闭 */ }
        await sleep(15000);
      } else {
        await sleep(5000);
      }
      continue;
    }
    const {scene, decision, result, check} = outcome;
    if (scene.chapter.id && scene.chapter.id !== lastChapter) {
      if (lastChapter) chaptersSinceReload += 1;
      lastChapter = scene.chapter.id;
      if (chaptersSinceReload >= 20) {
        chaptersSinceReload = 0;
        emit({event: 'maintenance-reload', tab, chapterId: scene.chapter.id});
        try {
          const rows = await bridge.tabs();
          const row = rows.find(item => item.id === String(tab));
          if (row?.url) await bridge.command('navigate', row.url, '--tab', String(tab));
        } catch { /* 交给下一轮探针处理 */ }
        await sleep(6000);
        continue;
      }
    }
    if (!scene.chapter.id && scene.pageKind === 'chapter') {
      emit({event: 'needs-review', tab, reason: '章节 id 为空，无法判断进度'});
      return;
    }
    if (decision.by === 'model') {
      modelCalls.set(scene.chapter.id, (modelCalls.get(scene.chapter.id) || 0) + 1);
      if ((modelCalls.get(scene.chapter.id) || 0) > 5) {
        emit({event: 'needs-review', tab, chapterId: scene.chapter.id, reason: '本章模型决策已超过 5 次，停下来避免空转'});
        return;
      }
    }
    if (scene.chapter.id !== delegatedChapter) delegatedChapter = null;

    // 视频播完但平台不记完成（任务缺 id 的章节很常见）：播两遍还不行就记待补做前进。
    if (scene.player && scene.player.duration) {
      const state = videoLoops.get(scene.chapter.id) || {last: 0, ends: 0, rewinds: 0};
      const atEnd = scene.player.currentTime >= scene.player.duration - 2;
      if (atEnd) state.ends += 1;
      else if (scene.player.currentTime + 10 < state.last) state.rewinds += 1;
      state.last = scene.player.currentTime;
      videoLoops.set(scene.chapter.id, state);
      const unfinished = scene.tasks.some(task => task.state !== 'done');
      if (unfinished && (state.ends >= 2 || state.rewinds >= 2)) {
        emit({event: 'video-loop-detected', tab, chapterId: scene.chapter.id,
          reason: `视频已播放 ${state.ends} 遍/回退 ${state.rewinds} 次，平台仍未标记完成`});
        await act({bridge, tab, dataDir: OUT, decision: {action: 'mark_deferred',
          args: {chapter: scene.chapter.id},
          think: '视频重播但平台不记完成，记为待补做'}});
        videoLoops.delete(scene.chapter.id);
        await sleep(3000);
        continue;
      }
    }

    if (decision.action === 'play_document' && delegatedChapter === scene.chapter.id) {
      // 单章脚本还在跑，别再注入一份
      await sleep(15000);
      continue;
    }
    if (decision.action === 'play_document') delegatedChapter = scene.chapter.id;

    // 课程边界：本章是最后一章且没有下一节 → 记完成并切下一门
    if (scene.allTasksDone && !scene.nextAvailable) {
      const queue = loadQueue();
      if (!queue) {
        emit({event: 'needs-review', tab, chapterId: scene.chapter.id, reason: '已到课程末尾但没有队列配置'});
        return;
      }
      const course = queue.config.courses[queue.schedule.index] || queue.config.courses.at(-1);
      const expected = String(course?.finalChapterId || '');
      if (expected && expected !== String(scene.chapter.id)) {
        log.push(`${new Date().toLocaleTimeString()} 末章与配置不符：配置 ${expected}，当前 ${scene.chapter.id}`);
      }
      const next = advanceSchedule(queue.schedule, course, {progress: scene.progress});
      saveSchedule(queue.schedulePath, next);
      emit({event: 'course-complete', tab, courseId: course.courseId, name: course.name,
        status: next.completed.at(-1).status, done: next.completed.at(-1).done, total: next.completed.at(-1).tasks});
      log.push(`${new Date().toLocaleTimeString()} 课程完成：${course.name}`);
      if (next.index >= queue.config.courses.length) {
        next.status = 'complete';
        saveSchedule(queue.schedulePath, next);
        emit({event: 'schedule-complete', tab, completed: next.completed.length, summary: next.completed});
        return;
      }
      const upcoming = queue.config.courses[next.index];
      emit({event: 'course-switch', tab, courseId: upcoming.courseId, name: upcoming.name});
      await enterCourse({bridge, tab, course: upcoming, cpi: queue.config.cpi});
      await sleep(4000);
      continue;
    }

    if (scene.tasks.some(task => task.type === 'workid' && task.state !== 'done')) {
      log.push(`${new Date().toLocaleTimeString()} 测验章节：交给答题管线`);
      saveRuntime(scene);
      emit({event: 'quiz-needed', tab, chapterId: scene.chapter.id, reason: '本章是测验任务'});
      let outcome;
      const quizAdapter = detectPlatform(scene.url)?.quiz;
      try {
        if (!quizAdapter) throw new Error('当前平台没有答题链路实现');
        const report = await quizAdapter.ensureReport({bridge, tab, root: HERE});
        emit({event: 'quiz-report', tab, chapterId: scene.chapter.id, questions: report.questions?.length || 0});
        outcome = await quizAdapter.run({
          bridge, tab, root: HERE, dataDir: OUT, report,
          onStep: detail => emit({event: 'quiz-step', tab, chapterId: scene.chapter.id, ...detail}),
        });
      } catch (error) {
        outcome = {status: 'needs-review', reason: String(error.message || error).slice(0, 300)};
      }
      emit({event: outcome.status === 'submitted' ? 'quiz-submitted' : 'needs-review',
        tab, chapterId: scene.chapter.id, reason: outcome.reason || outcome.status});
      if (outcome.status !== 'submitted') return;
      const doneBy = Date.now() + 240000;
      let finished = false;
      while (Date.now() < doneBy && !finished) {
        await sleep(3000);
        const next = await readScene(bridge, tab);
        finished = next.allTasksDone || next.chapter.id !== scene.chapter.id;
      }
      log.push(`${new Date().toLocaleTimeString()} 测验章节处理完成`);
      continue;
    }

    emit({
      event: 'agent-step', tab, chapterId: scene.chapter.id, pageKind: scene.pageKind,
      tasks: scene.tasks.map(task => `${task.type || '?'}:${task.state}`).join(','),
      player: scene.player ? {t: scene.player.currentTime, dur: scene.player.duration, paused: scene.player.paused} : null,
      action: decision.action, think: decision.think, by: decision.by,
      verified: check ? check.ok : null, durationMs: decision.durationMs || null,
    });
    emit({event: 'progress', tab, chapterId: scene.chapter.id, status: 'running', live: true,
      completed: 0, agent: true});

    history.push({chapterId: scene.chapter.id, action: decision.action, think: decision.think});
    try {
      appendRotating(join(OUT, 'agent-events.jsonl'), `${JSON.stringify({
        at: new Date().toISOString(), chapterId: scene.chapter.id, pageKind: scene.pageKind,
        action: decision.action, by: decision.by, think: decision.think,
        verified: check ? check.ok : null, durationMs: decision.durationMs || null,
      })}\n`);
    } catch { /* 日志失败不影响运行 */ }
    log.push(`${new Date().toLocaleTimeString()} ${decision.action}：${decision.think}`);
    saveRuntime(scene);

    if (decision.action === 'ask_operator') {
      emit({event: 'needs-review', tab, chapterId: scene.chapter.id,
        reason: decision.think || '需要人工处理'});
      return;
    }
    if (decision.action === 'mark_deferred') {
      // 记录后由下一章继续；这里只把动作留在日志里，避免死循环。
      await sleep(paceMs);
      continue;
    }
    if (check && !check.ok && decision.action !== 'wait') {
      emit({event: 'incident', tab, chapterId: scene.chapter.id,
        reason: `动作未验证通过：${decision.action}`});
      return;
    }
    if (decision.action === 'wait') await sleep(Math.max(paceMs, 6000));
    else await sleep(paceMs + Math.floor(Math.random() * 2000));
  }
}

main().catch(error => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
