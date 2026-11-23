// 课程边界（末章完成后记账 + 切课）的离线测试：用临时调度文件 + 假的 enterCourse。
import {mkdtempSync, writeFileSync, readFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {advanceCourse} from '../lib/course-boundary.mjs';

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? '✓' : '✗'} ${label}${ok ? '' : ` — 期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`}`);
  if (!ok) failed += 1;
};

const dir = mkdtempSync(join(tmpdir(), 'cx-boundary-'));
const schedulePath = join(dir, 'automation-schedule.json');
const courseA = {courseId: 'A', name: '课程A', firstChapterId: '1', finalChapterId: '99'};
const courseB = {courseId: 'B', name: '课程B', firstChapterId: '201', finalChapterId: '299'};

const fresh = (index, courses) => {
  writeFileSync(schedulePath, JSON.stringify({schemaVersion: 1, index, status: 'running', completed: []}));
  return {configPath: join(dir, 'courses.json'), schedulePath, config: {cpi: '777', courses},
    schedule: JSON.parse(readFileSync(schedulePath, 'utf8'))};
};

const readSchedule = () => JSON.parse(readFileSync(schedulePath, 'utf8'));
const noBridge = {};

// 1) 两门课，第一门完成 → 切到第二门
{
  const queue = fresh(0, [courseA, courseB]);
  const calls = [];
  const result = await advanceCourse({
    bridge: noBridge, tab: '42', queue, course: courseA,
    scene: {chapter: {id: '99'}, progress: {done: 45, total: 45}},
    enterCourseFn: async options => calls.push(options),
  });
  check('两门课 → 切换', result.kind, 'switched');
  check('切到课程B', result.upcoming.courseId, 'B');
  check('enterCourse 被调用一次', calls.length, 1);
  check('enterCourse 收到课程B和 cpi', [calls[0].course.courseId, calls[0].cpi], ['B', '777']);
  check('调度 index 前进到 1', readSchedule().index, 1);
  check('记录状态 complete', result.lastEntry.status, 'complete');
}

// 2) 最后一门完成 → 调度结束
{
  const queue = fresh(1, [courseA, courseB]);
  const result = await advanceCourse({
    bridge: noBridge, tab: '42', queue, course: courseB,
    scene: {chapter: {id: '299'}, progress: {done: 30, total: 30}},
    enterCourseFn: async () => { throw new Error('不应该切课'); },
  });
  check('最后一门 → 调度结束', result.kind, 'schedule-complete');
  check('调度状态 complete', readSchedule().status, 'complete');
  check('完成记录写入', readSchedule().completed.length, 1);
}

// 3) 进度没满 → 记 processed-with-unresolved
{
  const queue = fresh(0, [courseA, courseB]);
  const result = await advanceCourse({
    bridge: noBridge, tab: '42', queue, course: courseA,
    scene: {chapter: {id: '99'}, progress: {done: 40, total: 45}},
    enterCourseFn: async () => {},
  });
  check('未满进度 → processed-with-unresolved', result.lastEntry.status, 'processed-with-unresolved');
  check('完成记录保留 done/total', [result.lastEntry.done, result.lastEntry.tasks], [40, 45]);
}

rmSync(dir, {recursive: true, force: true});
console.log(failed ? `\n${failed} 项失败` : '\n课程边界测试全部通过');
process.exit(failed ? 1 : 0);
