// Offline checks for the course-boundary schedule math.
import {advanceSchedule} from '../lib/course-run.mjs';

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? '✓' : '✗'} ${label}${ok ? '' : ` — 期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`}`);
  if (!ok) failed += 1;
};

const base = {schemaVersion: 1, index: 2, status: 'running', completed: [{courseId: 'A'}]};
const course = {courseId: 'B', name: '课程B'};

const complete = advanceSchedule(base, course, {progress: {done: 45, total: 45}});
check('全部完成 → complete', complete.completed.at(-1).status, 'complete');
check('index 前进', complete.index, 3);
check('状态保持 running', complete.status, 'running');
check('不污染原对象', base.index, 2);

const unresolved = advanceSchedule(base, course, {progress: {done: 40, total: 45}});
check('未完成 → processed-with-unresolved', unresolved.completed.at(-1).status, 'processed-with-unresolved');
check('保留历史完成记录', unresolved.completed.length, 2);

const noProgress = advanceSchedule(base, course);
check('没有进度信息 → processed-with-unresolved', noProgress.completed.at(-1).status, 'processed-with-unresolved');
check('没有进度时 tasks 为 null', noProgress.completed.at(-1).tasks, null);

const empty = advanceSchedule({index: 0, status: 'running'}, course, {progress: {done: 1, total: 1}});
check('缺省字段可补齐', `${empty.index}/${empty.completed.length}/${empty.status}`, '1/1/running');

console.log(failed ? `\n${failed} 项失败` : '\n课程调度测试全部通过');
process.exit(failed ? 1 : 0);
