// Watch the queue until a quiz chapter triggers the P3 pipeline, then report.
import {readdirSync, readFileSync, statSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT = join(ROOT, 'quiz-reports');
const PORT = Number(process.env.CX_CONSOLE_PORT || 8788);
const token = readFileSync(join(OUT, 'console-token'), 'utf8').trim();
const headers = {'X-CX-Console': '1', Authorization: `Bearer ${token}`};
const startedAt = Date.now();
const seen = new Set(readdirSync(OUT).filter(name => /^quiz-.*\.json$/.test(name)));

const say = message => console.log(`${new Date().toLocaleTimeString()} ${message}`);

let lastMode = '';
let lastChapter = '';
for (;;) {
  const status = await fetch(`http://127.0.0.1:${PORT}/status`, {headers}).then(r => r.json()).catch(() => null);
  if (!status) { say('控制台没响应'); await sleep(15000); continue; }

  const runtime = (() => { try { return JSON.parse(readFileSync(join(OUT, 'runtime.json'), 'utf8')); } catch { return {}; } })();
  const chapter = runtime.chapterId || '';
  const video = runtime.video ? `${runtime.video.time}/${runtime.video.duration}s` : '-';

  if (chapter && chapter !== lastChapter) {
    say(`章节 ${chapter} · 模式 ${status.mode}/${status.automation?.status} · 视频 ${video}`);
    lastChapter = chapter;
  }
  if (status.mode !== lastMode) {
    if (lastMode) say(`模式变化：${lastMode} → ${status.mode}${status.error ? ` · ${status.error.slice(0, 120)}` : ''}`);
    lastMode = status.mode;
  }

  const quizzes = readdirSync(OUT).filter(name => /^quiz-.*\.json$/.test(name));
  const fresh = quizzes.filter(name => !seen.has(name));
  for (const name of fresh) {
    seen.add(name);
    const path = join(OUT, name);
    let report = {};
    try { report = JSON.parse(readFileSync(path, 'utf8')); } catch { /* being written */ }
    say(`★ 新测验报告 ${name} · 章节 ${report.chapterId} · ${report.questions?.length ?? '?'} 题 · ${(statSync(path).size / 1024).toFixed(1)}KB`);
  }
  if (fresh.length) {
    say('检测到测验章，P3 链路开始运行；继续观察答案/填写/提交结果');
    // 再观察 3 分钟，把答案与提交结果也收进来
    for (let i = 0; i < 12; i += 1) {
      await sleep(15000);
      const answers = readdirSync(OUT).filter(name => /^answer-.*\.json$/.test(name)).length;
      const latest = (() => { try { return JSON.parse(readFileSync(join(OUT, 'runtime.json'), 'utf8')); } catch { return {}; } })();
      const st = await fetch(`http://127.0.0.1:${PORT}/status`, {headers}).then(r => r.json()).catch(() => null);
      say(`  观察 ${i + 1}/12 · 答案文件 ${answers} · runtime ${latest.status || '?'} · 章节 ${latest.chapterId || '?'} · 控制台 ${st?.mode || '?'}${st?.error ? ` · ${st.error.slice(0, 100)}` : ''}`);
      if (st && ['stopped', 'needs-review'].includes(st.mode)) break;
    }
    process.exit(0);
  }

  if (status.mode === 'stopped' || (status.mode === 'needs-review' && status.automation?.status !== 'running')) {
    say(`队列停了：mode=${status.mode} auto=${status.automation?.status} error=${status.error || ''}`);
    process.exit(0);
  }
  await sleep(20000);
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
