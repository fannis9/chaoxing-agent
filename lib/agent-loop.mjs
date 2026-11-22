// Agent loop: observe -> decide -> act -> verify.
// Fast path: rules handle the well-known cases (no model call).
// Slow path: anything unknown escalates to the model with the scene attached.
import {appendFileSync, mkdirSync, readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {requestModel} from './model-client.mjs';
import {readScene} from './probe.mjs';
import {enterCourse} from './course-run.mjs';
import {detectPlatform, platformById} from '../platforms/registry.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

export const ACTIONS = [
  'activate_tab', 'play_video', 'play_document', 'answer_quiz',
  'next_chapter', 'open_course', 'mark_deferred', 'reload_page', 'ask_operator', 'wait',
];

const decisionSchema = {
  type: 'object',
  properties: {
    think: {type: 'string'},
    action: {type: 'string', enum: ACTIONS},
    args: {type: 'object', properties: {}, additionalProperties: true},
    expect: {type: 'string'},
    confidence: {type: 'number'},
  },
  required: ['think', 'action', 'expect'],
  additionalProperties: false,
};

const PLAY_VIDEO = `(() => {
  let view = null, player = null;
  const walk = (w, depth) => {
    let doc; try { doc = w.document; } catch { return; }
    const video = doc.querySelector('video');
    if (video && !view) {
      view = w;
      try {
        const players = w.videojs?.getPlayers?.() || {};
        player = Object.values(players).find(p => { try { return p?.el?.()?.isConnected; } catch { return false; } }) || null;
      } catch { /* plain element */ }
      return;
    }
    if (depth >= 4) return;
    for (const f of doc.querySelectorAll('iframe')) { try { if (f.contentWindow) walk(f.contentWindow, depth + 1); } catch {} }
  };
  walk(window, 0);
  if (!view) return 'no-player';
  if (player) { player.muted(true); if (player.paused()) player.play().catch(() => {}); return 'player-play'; }
  const video = view.document.querySelector('video');
  video.muted = true;
  if (video.paused) video.play().catch(() => {});
  return 'element-play';
})()`;

/** Rules cover the common cases; null means "ask the model". */
export function ruleDecide(scene) {
  if (scene.requiresUser) {
    return {action: 'ask_operator', args: {}, think: '页面要求验证码/登录/身份核验', expect: '等待人工处理', by: 'rule'};
  }
  if (scene.pageKind === 'verify') {
    return {action: 'ask_operator', args: {}, think: '停在反爬验证页', expect: '等待人工通过验证', by: 'rule'};
  }
  if (scene.pageKind === 'space' || scene.pageKind === 'catalog') {
    return {action: 'open_course', args: {platform: detectPlatform(scene.url)?.id || null},
      think: '不在章节页，需要先进入课程', expect: '进入章节学习页', by: 'rule'};
  }
  if (scene.pageKind !== 'chapter') {
    return {action: 'ask_operator', args: {}, think: `无法识别的页面：${scene.pageKind}`, expect: '人工确认', by: 'rule'};
  }
  if (!scene.tasks.length) {
    return {action: 'mark_deferred', args: {chapter: scene.chapter.id}, think: '本章没有可识别任务', expect: '记为待补做并进入下一章', by: 'rule'};
  }
  if (scene.allTasksDone) {
    return scene.nextAvailable
      ? {action: 'next_chapter', args: {}, think: '本章任务均已完成', expect: '章节 id 变化', by: 'rule'}
      : {action: 'ask_operator', args: {}, think: '已到末章', expect: '核对课程总进度', by: 'rule'};
  }
  const pending = scene.tasks.find(task => task.state !== 'done');
  if (pending) {
    const platform = detectPlatform(scene.url);
    const action = platform ? platform.taskAction(pending.type) : null;
    if (!platform) return null;               // 陌生平台：交给模型
    if (!action) return null;                 // 认识的平台但不认识的任务类型：也交给模型
    if (action === 'play_video') {
      if (scene.player && !scene.player.paused && scene.player.currentTime > 0) {
        return {action: 'wait', args: {taskId: pending.id}, think: `视频正在播放（${scene.player.currentTime}s）`, expect: '进度继续前进', by: 'rule'};
      }
      return {action: 'play_video', args: {taskId: pending.id, hidden: scene.tabHidden ?? scene.player?.frameHidden ?? true}, think: `视频任务 ${pending.id} 未完成`, expect: '播放进度前进', by: 'rule'};
    }
    if (action === 'play_document') {
      return {action: 'play_document', args: {
        taskId: pending.id, token: pending.token,
        knowledgeid: scene.defaults?.knowledgeid, courseid: scene.defaults?.courseId,
        clazzid: scene.defaults?.clazzId,
      }, think: `文档任务 ${pending.id} 未完成`, expect: '平台确认文档完成', by: 'rule'};
    }
    if (action === 'answer_quiz') {
      return {action: 'answer_quiz', args: {taskId: pending.id}, think: `测验任务 ${pending.id} 未完成`, expect: '平台确认测验完成', by: 'rule'};
    }
    return null;
  }
  return null;
}

const INSTRUCTIONS = [
  '你是专为学习通刷课而生的浏览器 agent。每次只输出一个 JSON 决策。',
  `可用动作：${ACTIONS.join('、')}。`,
  '规则：页面出现验证码/人脸核验/登录失效时必须 ask_operator；不得伪造完成；',
  '无法判断时用 wait 或 ask_operator，不要猜。expect 写你能观察到的预期变化。',
].join('');

export async function decide(scene, {model, history = [], timeoutMs = 30000, forceModel = false} = {}) {
  // 规则负责常见路径；异常/陌生页面/反复卡住时升级给模型，这才叫混合式。
  const recent = history.slice(-4);
  const stuck = recent.filter(item => item.chapterId === scene.chapter.id
    && item.action !== 'wait').length >= 3;
  const unusualPage = scene.pageKind === 'unknown';
  const platform = detectPlatform(scene.url);
  const unusualTask = scene.tasks.some(task => task.state !== 'done'
    && (!platform || !platform.taskAction(task.type)));
  const escalate = forceModel || stuck || unusualPage || unusualTask;
  const rule = escalate ? null : ruleDecide(scene);
  if (rule) return rule;
  const {text, durationMs} = await requestModel(model, {
    instructions: INSTRUCTIONS,
    input: JSON.stringify({scene, recent: history.slice(-6)}),
    schema: decisionSchema,
    name: 'decision',
    timeout: timeoutMs,
  });
  return {...JSON.parse(text), by: 'model', durationMs};
}

function writeJsonl(path, record) {
  try {
    mkdirSync(join(path, '..'), {recursive: true});
    appendFileSync(path, `${JSON.stringify(record)}\n`);
  } catch { /* best effort */ }
}

export async function act({bridge, tab, decision, dataDir}) {
  const args = decision.args || {};
  switch (decision.action) {
    case 'activate_tab':
      await bridge.command('activate', String(args.tab || tab));
      return {ok: true};
    case 'play_video':
      // 只有播放器所在文档处于隐藏态时才需要切前台；独立窗口里不需要。
      if (args.hidden !== false) {
        await bridge.command('activate', String(args.tab || tab)).catch(() => {});
      }
      return {ok: true, result: await bridge.command('eval', PLAY_VIDEO, '--world', 'MAIN', '--tab', String(tab))};
    case 'next_chapter':
      return {ok: true, result: await bridge.command('eval',
        "(()=>{const b=document.getElementById('prevNextFocusNext');if(!b)return 'missing';b.click();return 'clicked'})()",
        '--world', 'MAIN', '--tab', String(tab))};
    case 'play_document': {
      // The document API alone is rejected (status:false), so hand this chapter to
      // the proven single-chapter page script; the agent still decides when.
      const script = (await import('node:fs')).readFileSync(join(ROOT, 'chaoxing-autoplay-v3-one-chapter.js'), 'utf8');
      return {ok: true, result: await bridge.command('eval', script, '--world', 'MAIN', '--tab', String(tab))};
    }
    case 'open_course': {
      // 只导航到 stucoursemiddle 会停在目录页；必须继续进到首章学习页。
      const configPath = process.env.CX_COURSE_CONFIG;
      if (!configPath) throw new Error('没有课程配置，无法自动进入课程');
      const config = JSON.parse(readFileSync(configPath, 'utf8'));
      let index = 0;
      try {
        const schedule = JSON.parse(readFileSync(process.env.CX_SCHEDULE_PATH || '', 'utf8'));
        if (Number.isInteger(schedule.index)) index = schedule.index;
      } catch { /* 单课程模式 */ }
      const course = config.courses?.[index] || config.courses?.[0];
      if (!course) throw new Error('课程配置为空');
      // 优先从上次记录的位置继续，避免每次重启都从第一章重走。
      let resume = course.firstChapterId;
      try {
        const runtime = JSON.parse(readFileSync(join(ROOT, 'quiz-reports', 'runtime.json'), 'utf8'));
        if (String(runtime.courseId) === String(course.courseId) && /^\\d+$/.test(String(runtime.chapterId))) {
          resume = String(runtime.chapterId);
        }
      } catch { /* 没有运行记录就从首章开始 */ }
      const adapter = platformById(args.platform) || detectPlatform(config.courses?.[0]?.url || '');
      const enter = adapter?.enterCourse || enterCourse;
      const entered = await enter({
        bridge, tab, course, cpi: config.cpi, chapterId: resume,
      });
      return {ok: true, courseId: course.courseId, url: entered.url};
    }
    case 'reload_page':
      await bridge.command('eval', "location.reload(); 'reloading'", '--world', 'MAIN', '--tab', String(tab));
      return {ok: true};
    case 'mark_deferred':
      writeJsonl(join(dataDir, 'agent-deferred.jsonl'), {at: new Date().toISOString(), tab, chapter: args.chapter || '', think: decision.think});
      // 记完待补做必须真的前进，否则会在同一章无限循环。
      return {ok: true, result: await bridge.command('eval',
        "(()=>{const b=document.getElementById('prevNextFocusNext');if(!b)return 'missing';b.click();return 'clicked'})()",
        '--world', 'MAIN', '--tab', String(tab))};
    case 'ask_operator':
      writeJsonl(join(dataDir, 'agent-operator.jsonl'), {at: new Date().toISOString(), tab, think: decision.think, scene: args.scene || null});
      return {ok: true};
    case 'wait':
      return {ok: true};
    default:
      throw new Error(`动作尚未实现：${decision.action}`);
  }
}

/** Verify the expected change by probing again; returns {ok, scene}. */
export async function verify({bridge, tab, before, decision, timeoutMs = 15000, platform = null}) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const scene = await readScene(bridge, tab, platform);
    if (['next_chapter', 'mark_deferred'].includes(decision.action)
        && scene.chapter.id && scene.chapter.id !== before.chapter.id) {
      return {ok: true, scene};
    }
    if (decision.action === 'play_video' && scene.player) {
      const moved = scene.player.currentTime > (before.player?.currentTime ?? 0) + 2;
      const playing = !scene.player.paused && scene.player.currentTime > 0;
      if (moved || playing) return {ok: true, scene};
    }
    if (decision.action === 'play_video' && scene.allTasksDone) return {ok: true, scene};
    if (decision.action === 'open_course' && scene.pageKind === 'chapter') {
      return {ok: true, scene};
    }
    if (decision.action === 'play_document') {
      if (scene.allTasksDone || (scene.chapter.id && scene.chapter.id !== before.chapter.id)) {
        return {ok: true, scene};
      }
    }
    if (['activate_tab', 'ask_operator', 'wait'].includes(decision.action)) {
      return {ok: true, scene};
    }
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
  return {ok: false, scene: await readScene(bridge, tab)};
}

/** One full cycle. dryRun only observes and decides. */
export async function step({bridge, tab, model, dataDir, history = [], dryRun = true, forceModel = false, platform = null}) {
  const scene = await readScene(bridge, tab, platform);
  const decision = await decide(scene, {model, history, forceModel});
  let result = null;
  let check = null;
  if (!dryRun) {
    result = await act({bridge, tab, decision, dataDir});
    const verifyMs = decision.action === 'open_course' ? 60000
      : decision.action === 'answer_quiz' ? 300000 : 15000;
    check = await verify({bridge, tab, before: scene, decision, timeoutMs: verifyMs, platform});
  }
  return {scene, decision, result, check};
}
