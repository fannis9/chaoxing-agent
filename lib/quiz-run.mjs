// Quiz primitives for agent mode: ask the page script for a report, answer it
// with the model, fill the page, submit, and let the platform confirm.
// Reuses the existing worker/filler/submit scripts instead of reimplementing.
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {promisify} from 'node:util';

const exec = promisify(execFile);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function reportNode(bridge, tab) {
  return bridge.command('eval', "document.getElementById('cx-v3-quiz-report')?.textContent || ''",
    '--world', 'MAIN', '--tab', String(tab));
}

/** Wait for (or provoke) the page script's structured quiz report. */
export async function ensureReport({bridge, tab, root, timeoutMs = 90000}) {
  const existing = await reportNode(bridge, tab);
  if (existing) {
    try { return JSON.parse(existing); } catch { /* stale node, regenerate */ }
  }
  const script = readFileSync(join(root, 'chaoxing-autoplay-v3-one-chapter.js'), 'utf8');
  await bridge.command('eval', script, '--world', 'MAIN', '--tab', String(tab));
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(1500);
    const raw = await reportNode(bridge, tab);
    if (!raw) continue;
    try {
      const report = JSON.parse(raw);
      if (report?.schemaVersion === 1 && report.kind === 'quiz') return report;
    } catch { /* still being written */ }
  }
  throw new Error('等待测验报告超时');
}

/** Run answer -> fill -> submit for one report. Returns a structured outcome. */
export async function runQuiz({bridge, tab, root, dataDir, report, onStep = () => {}}) {
  const key = `${tab}:${report.id}`;
  const name = createHash('sha256').update(key).digest('hex').slice(0, 16);
  mkdirSync(dataDir, {recursive: true, mode: 0o700});
  const reportPath = join(dataDir, `quiz-${name}.json`);
  writeFileSync(reportPath, JSON.stringify(report, null, 2), {mode: 0o600});

  onStep({step: 'answer', reportPath});
  const {stdout: answerOut} = await exec(process.execPath,
    [join(root, 'chaoxing-answer-worker.mjs'), '--once', `--report=${reportPath}`],
    {timeout: 300000, maxBuffer: 4 * 1024 * 1024, windowsHide: true});
  const answerEvent = JSON.parse(answerOut.trim().split('\n').filter(Boolean).at(-1) || '{}');
  if (!answerEvent.answer) throw new Error('答题进程没有产出答案文件');
  const answer = JSON.parse(readFileSync(answerEvent.answer, 'utf8'));
  if (answer.status !== 'ready') {
    return {status: 'needs-review', reason: `答案状态 ${answer.status}`, answer: answerEvent.answer};
  }

  onStep({step: 'fill', answer: answerEvent.answer});
  const {stdout: fillOut} = await exec(process.execPath,
    [join(root, 'chaoxing-page-filler.mjs'), `--answer=${answerEvent.answer}`, `--tab=${tab}`, '--apply'],
    {timeout: 180000, maxBuffer: 4 * 1024 * 1024, windowsHide: true});
  const filled = JSON.parse(fillOut.trim().split('\n').filter(Boolean).at(-1) || '{}');
  if (filled.event !== 'fill-result' || filled.failed?.length || filled.skipped?.length
      || filled.filled?.length !== report.questions?.length) {
    return {status: 'needs-review', reason: '页面填写未全部确认', fill: filled};
  }

  onStep({step: 'submit'});
  const submit = readFileSync(join(root, 'chaoxing-submit-page.js'), 'utf8').trim();
  const phase = async value => {
    const raw = await bridge.command('eval',
      `${submit}(${JSON.stringify({phase: value, reportId: report.id, jobId: report.jobId, chapterId: report.chapterId})})`,
      '--world', 'MAIN', '--tab', String(tab));
    return JSON.parse(raw);
  };
  const opened = await phase('open');
  if (!opened.ok) return {status: 'needs-review', reason: `打开提交确认失败：${opened.reason}`};
  let confirmed = false;
  for (let attempt = 0; attempt < 10 && !confirmed; attempt += 1) {
    await sleep(500);
    confirmed = Boolean((await phase('confirm')).ok);
  }
  if (!confirmed) return {status: 'needs-review', reason: '未找到提交确认按钮'};
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    await sleep(1000);
    try { if ((await phase('status')).completed) return {status: 'submitted', reportPath}; } catch { /* page changing */ }
  }
  return {status: 'needs-review', reason: '提交后平台未确认完成', reportPath};
}
