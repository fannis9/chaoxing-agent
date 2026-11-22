#!/usr/bin/env node
// Keep the 浏览器代理 controller independent of an interactive terminal session.
import {spawn} from 'node:child_process';
import {mkdirSync, readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = process.env.CX_QUIZ_REPORT_DIR || join(here, 'quiz-reports');
const tab = process.argv.find(arg => arg.startsWith('--tab='))?.slice(6);
if (!/^\d+$/.test(tab || '')) throw new Error('需要 --tab=<浏览器代理 标签 ID>');
mkdirSync(out, {recursive:true, mode:0o700});
const lock = join(out, '.controller.lock');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function owner() {
  try {
    const data = JSON.parse(readFileSync(lock, 'utf8'));
    process.kill(data.pid, 0);
    return data.pid;
  } catch { return null; }
}
let previous = owner();
if (previous && !process.argv.includes('--restart'))
  throw new Error(`控制端已运行：pid ${previous}；可加 --restart 重启`);
if (previous) {
  process.kill(previous, 'SIGTERM');
  for (let i = 0; i < 50 && owner(); i++) await sleep(100);
  if (owner()) throw new Error('旧控制端未退出');
}
const log = join(out, 'controller.log');
const child = spawn(process.execPath,
  [join(here, 'chaoxing-quiz-control.mjs'), '--start', '--schedule', '--daemon-log', `--tab=${tab}`],
  {detached:true, windowsHide:true, stdio:'ignore'});
child.unref();
for (let i = 0; i < 100; i++) {
  await sleep(100);
  if (owner() === child.pid) {
    process.stdout.write(`${JSON.stringify({event:'daemon-started',pid:child.pid,tab,log})}\n`);
    process.exit(0);
  }
}
throw new Error(`控制端未启动；检查 ${log}`);
