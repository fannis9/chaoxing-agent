// 课程边界：末章完成后的记账与切课。抽出来是为了能离线测试（控制器只负责发事件）。
import {advanceSchedule, enterCourse, saveSchedule} from './course-run.mjs';

/**
 * @returns {{kind:'switched', lastEntry:object, upcoming:object, next:object}
 *          |{kind:'schedule-complete', lastEntry:object, next:object}}
 */
export async function advanceCourse({bridge, tab, queue, course, scene, enterCourseFn = enterCourse}) {
  const next = advanceSchedule(queue.schedule, course, {progress: scene.progress});
  saveSchedule(queue.schedulePath, next);
  const lastEntry = next.completed.at(-1);

  if (next.index >= queue.config.courses.length) {
    next.status = 'complete';
    saveSchedule(queue.schedulePath, next);
    return {kind: 'schedule-complete', lastEntry, next};
  }

  const upcoming = queue.config.courses[next.index];
  await enterCourseFn({bridge, tab, course: upcoming, cpi: queue.config.cpi});
  return {kind: 'switched', lastEntry, upcoming, next};
}
