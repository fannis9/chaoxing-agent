#!/usr/bin/env node
// Read-only soak check for the current controller while it waits at a quiz.
import {readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';

const dir = process.env.CX_QUIZ_REPORT_DIR || join(dirname(fileURLToPath(import.meta.url)), 'quiz-reports');
const seconds = Math.max(60, Number(process.argv[2] || 300));
const allowProgress = process.argv.includes('--allow-progress');
const intervalMs = 5000;
const read = file => JSON.parse(readFileSync(join(dir, file), 'utf8'));
const initial = read('runtime.json');
const initialSchedule = read('schedule.json');
const initialLock = read('.controller.lock');
if ((!allowProgress && initial.status !== 'waiting-quiz') || initialSchedule.status !== 'running')
  throw new Error('当前状态不适合只读长时测试');
let samples = 0;
let maxLagMs = 0;
const statuses = new Set();
const started = Date.now();
while (Date.now() - started < seconds * 1000) {
  const runtime = read('runtime.json');
  const schedule = read('schedule.json');
  const lock = read('.controller.lock');
  process.kill(lock.pid, 0);
  const lag = Date.now() - Date.parse(runtime.observedAt);
  maxLagMs = Math.max(maxLagMs, lag);
  if (!Number.isFinite(lag) || lag > 30000)
    throw new Error(`控制端心跳超时：${lag} ms`);
  statuses.add(runtime.status);
  if (lock.pid !== initialLock.pid || runtime.tab !== initial.tab
      || (!allowProgress && (runtime.courseId !== initial.courseId
        || runtime.chapterId !== initial.chapterId || runtime.status !== 'waiting-quiz'))
      || ['needs-review','stopped'].includes(runtime.status)
      || schedule.status === 'needs-review')
    throw new Error(`等待状态发生变化：${JSON.stringify({runtime, schedule})}`);
  samples += 1;
  if (samples % 12 === 0) process.stdout.write(`${JSON.stringify({elapsedSeconds:Math.round((Date.now()-started)/1000), samples, maxLagMs})}\n`);
  await new Promise(resolve => setTimeout(resolve, intervalMs));
}
process.stdout.write(`${JSON.stringify({result:'passed', seconds:Math.round((Date.now()-started)/1000), samples, maxLagMs,statuses:[...statuses]})}\n`);
