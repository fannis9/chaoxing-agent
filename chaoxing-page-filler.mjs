#!/usr/bin/env node
// Fill answers in the existing study tab via 浏览器代理. Never submits the quiz.
import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync, renameSync, writeFileSync} from 'node:fs';
import {basename, dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {RunScope,bindCancellation} from './lib/run-scope.mjs';
import {BridgeClient} from './lib/bridge-client.mjs';

const scope = new RunScope();
bindCancellation(scope);
const exec = (...args) => scope.exec(...args);
const bridge = new BridgeClient(exec);
const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = resolve(process.env.CX_QUIZ_REPORT_DIR || join(HERE, 'quiz-reports'));
const CODE = readFileSync(join(HERE, 'chaoxing-fill-page.js'), 'utf8').trim();
const answerArg = process.argv.find(arg => arg.startsWith('--answer='))?.slice(9);
const tabArg = process.argv.find(arg => arg.startsWith('--tab='))?.slice(6);
const APPLY = process.argv.includes('--apply');

function readBounded(path, limit) {
  const data = readFileSync(path, 'utf8');
  if (data.length > limit) throw new Error(`${basename(path)} 文件过大`);
  return data;
}

async function command(...args) {
  return bridge.command(...args);
}

async function targetTab() {
  const tabs = await bridge.tabs();
  if (tabArg) {
    if (!/^\d+$/.test(tabArg) || !tabs.some(tab=>tab.id===tabArg)) throw new Error('指定标签不存在');
    return tabArg;
  }
  const matches = tabs.filter(tab => /^https:\/\/mooc1(?:-[a-z0-9]+)?\.chaoxing\.com\/mycourse\/studentstudy/i.test(tab.url))
    .map(tab=>tab.id);
  if (matches.length !== 1) throw new Error(`需要恰好一个学习通章节标签；当前找到 ${matches.length} 个`);
  return matches[0];
}

function loadPair(path) {
  const answerPath = resolve(path);
  const name = basename(answerPath);
  if (dirname(answerPath) !== DIR || !/^answer-[a-f0-9]{16}\.json$/.test(name))
    throw new Error('答案路径必须是报告目录中的 answer-*.json');
  const reportPath = join(DIR, `quiz-${name.slice(7)}`);
  const reportRaw = readBounded(reportPath, 5_000_000);
  const report = JSON.parse(reportRaw);
  const answer = JSON.parse(readBounded(answerPath, 1_000_000));
  const hash = createHash('sha256').update(reportRaw).digest('hex');
  if (report?.schemaVersion !== 1 || report.kind !== 'quiz' || !Array.isArray(report.questions)
      || answer?.schemaVersion !== 1 || answer.kind !== 'answer-proposal'
      || answer.reportId !== report.id || answer.sourceHash !== hash
      || !['ready','needs-review'].includes(answer.status) || !Array.isArray(answer.answers))
    throw new Error('答案与题目报告不匹配或已过期');
  const byIndex = new Map(report.questions.map(q => [q.index, q]));
  if (byIndex.size !== report.questions.length || answer.answers.length !== report.questions.length)
    throw new Error('题目数量或索引不一致');
  const seen = new Set();
  const fillable = [];
  const skipped = [];
  for (const item of answer.answers) {
    const q = byIndex.get(item.index);
    if (!q || seen.has(item.index) || item.questionId !== q.questionId
        || !Array.isArray(item.answerValues) || !item.answerValues.every(v => typeof v === 'string'))
      throw new Error(`答案映射不一致：第 ${item.index} 题`);
    seen.add(item.index);
    const contentAcknowledged=answer.humanReviewed===true && item.reviewedSourceHash===hash && item.captureAcknowledged===true
      && (q.captureIssues || []).every(issue=>['image-not-embedded','font-unavailable'].includes(issue));
    if (item.needsReview !== false || !item.answerValues.length || ((q.captureIssues || []).length && !contentAcknowledged)) {
      skipped.push({index:q.index, reason:'需要复核或答案为空'});
      continue;
    }
    if (q.control?.kind === 'choice') {
      if (item.answerValues.some(v => !q.options?.some(o => o.value === v)))
        throw new Error(`第 ${q.index} 题选项值无效`);
      if (/单选|判断/.test(q.type || '') && item.answerValues.length > 1)
        throw new Error(`第 ${q.index} 题只能选择一个选项`);
    } else if (q.control?.kind === 'fill' || q.control?.kind === 'editor') {
      if (item.answerValues.length !== q.control.editors?.length)
        throw new Error(`第 ${q.index} 题答案数量与编辑器不符`);
    } else { skipped.push({index:q.index, reason:'控件类型不支持'}); continue; }
    fillable.push({question:q, answer:item});
  }
  return {report, answer, answerPath, fillable, skipped};
}

function slimReport(report, questions) {
  return {id:report.id, courseId:report.courseId, chapterId:report.chapterId,
    jobId:report.jobId, questions:questions.map(q => ({index:q.index, questionId:q.questionId,
      heading:q.heading, options:q.options, control:q.control}))};
}

async function evaluate(tab, payload) {
  const raw = await command('eval', `${CODE}(${JSON.stringify(payload)})`, '--world', 'MAIN', '--tab', tab);
  return JSON.parse(raw);
}

async function main() {
  if (process.argv.includes('--help')) {
    process.stdout.write('用法: node chaoxing-page-filler.mjs --answer=/绝对路径/answer-*.json [--tab=标签ID] [--apply]\n默认只检查；--apply 才填写页面，不会提交。\n');
    return;
  }
  if (!answerArg) throw new Error('请提供 --answer=/绝对路径/answer-*.json');
  const pair = loadPair(answerArg);
  const tab = await targetTab();
  const report = slimReport(pair.report, pair.fillable.map(item => item.question));
  const checked = await evaluate(tab, {mode:'preflight', report});
  if (!checked.ok) throw new Error(`页面核对失败：${JSON.stringify(checked.issues || checked.reason)}`);
  if (!APPLY) {
    process.stdout.write(`${JSON.stringify({event:'fill-preview', tab, reportId:pair.report.id,
      model:pair.answer.model || '', fillable:pair.fillable.map(item => item.question.index),
      skipped:pair.skipped})}\n`);
    return;
  }
  const filled = [];
  const failed = [];
  for (const {question, answer} of pair.fillable) {
    let outcome;
    try {
      if (question.control.kind === 'choice') {
        for (let step = 0; step <= question.options.length; step++) {
          outcome = await evaluate(tab, {mode:'fill', report, question, answer});
          if (!outcome.ok || !outcome.clicks) break;
          const clickedLabel = outcome.clickedLabel;
          await new Promise(resolve => setTimeout(resolve, 900));
          outcome = await evaluate(tab, {mode:'verify-step', report, question, answer, clickedLabel});
          if (!outcome.ok) break;
        }
      } else outcome = await evaluate(tab, {mode:'fill', report, question, answer});
      if (outcome.ok) {
        await new Promise(resolve => setTimeout(resolve, 900));
        outcome = await evaluate(tab, {mode:'verify', report, question, answer});
      }
    }
    catch (error) { outcome = {ok:false, reason:error.message}; }
    if (outcome.ok) filled.push({index:question.index, kind:question.control.kind});
    else { failed.push({index:question.index, reason:outcome.reason || '页面未确认填写'}); break; }
  }
  const audit = {schemaVersion:1, kind:'fill-audit', at:new Date().toISOString(), tab,
    reportId:pair.report.id, sourceHash:pair.answer.sourceHash,
    model:pair.answer.model || '', filled, skipped:pair.skipped, failed, submitted:false};
  const auditPath = join(DIR, `fill-${basename(pair.answerPath).slice(7)}`);
  const temp = `${auditPath}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(audit, null, 2), {mode:0o600});
  renameSync(temp, auditPath);
  process.stdout.write(`${JSON.stringify({event:'fill-result', audit:auditPath, ...audit})}\n`);
  if (failed.length) process.exitCode = 2;
}

main().catch(error => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; })
  .finally(async () => {await scope.drain();if(process.connected)process.disconnect();});
