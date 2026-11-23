// 待补做清单对账：结合左侧目录的完成标记，把“其实已经完成”的记录清掉。
// 用法：
//   node dev/audit-deferred.mjs --catalog=<page-eval-结果.json> [--apply]
// catalog 文件内容是页面里读目录的 eval 返回值（{"ok":true,"result":"{...}"}）。

import {readFileSync, writeFileSync, copyFileSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const file = join(ROOT, 'quiz-reports', 'agent-deferred.jsonl');
const args = process.argv.slice(2);
const catalogArg = args.find(arg => arg.startsWith('--catalog='))?.slice(10);
const apply = args.includes('--apply');
if (!catalogArg) throw new Error('需要 --catalog=<file>');

const raw = readFileSync(catalogArg, 'utf8');
const outer = JSON.parse(raw);
const inner = typeof outer === 'string' ? outer : outer.result;
const parsed = JSON.parse(inner);
const completed = new Map(Object.entries(parsed).map(([id, done]) => [String(id), Boolean(done)]));

const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
const byChapter = new Map();
for (const line of lines) {
  let record;
  try { record = JSON.parse(line); } catch { continue; }
  const id = String(record.chapter || '');
  byChapter.set(id || `unknown:${byChapter.size}`, record);
}

const keep = [];
const droppedComplete = [];
const unknown = [];
const legacy = [];   // 早期记录没有 chapter 字段，无法对账，单独归档
for (const [id, record] of byChapter) {
  if (!record.chapter) { legacy.push(record); continue; }
  const done = completed.get(String(record.chapter));
  if (done === true) { droppedComplete.push(id); continue; }
  if (done === undefined) unknown.push(String(record.chapter));
  keep.push(record);
}

console.log(`原始记录 ${lines.length} 条 → 去重后 ${byChapter.size} 个章节`);
console.log(`无章节 id 的早期记录（归档）：${legacy.length}`);
console.log(`已确认完成（可清）：${droppedComplete.length}`);
console.log(`目录里找不到（保留）：${unknown.length}`);
console.log(`需要保留：${keep.length}`);
if (droppedComplete.length) {
  console.log('\n清掉的章节：');
  for (const id of droppedComplete.slice(0, 40)) console.log(`  ${id}  ${byChapter.get(id)?.think || ''}`.slice(0, 120));
}
if (unknown.length) {
  console.log('\n目录里没有的章节（可能是别的课程）：');
  for (const id of unknown.slice(0, 20)) console.log(`  ${id}  ${byChapter.get(id)?.think || ''}`.slice(0, 100));
}

if (apply) {
  copyFileSync(file, `${file}.bak`);
  if (legacy.length) {
    const legacyFile = join(ROOT, 'quiz-reports', 'agent-deferred-legacy.jsonl');
    const before = (() => { try { return readFileSync(legacyFile, 'utf8'); } catch { return ''; } })();
    writeFileSync(legacyFile, before + legacy.map(item => JSON.stringify(item)).join('\n') + '\n');
  }
  writeFileSync(file, keep.map(item => JSON.stringify(item)).join('\n') + '\n');
  const report = {
    at: new Date().toISOString(), before: lines.length, after: keep.length,
    droppedComplete: droppedComplete.length, unknown: unknown.length, legacy: legacy.length,
    keptChapters: keep.map(item => ({chapter: item.chapter, think: item.think})),
  };
  writeFileSync(join(ROOT, 'quiz-reports', 'deferred-audit.json'), JSON.stringify(report, null, 2));
  console.log(`\n已写回 ${file}（备份 ${file}.bak），报告 quiz-reports/deferred-audit.json`);
} else {
  console.log('\n（没有 --apply，只预览，不修改文件）');
}
