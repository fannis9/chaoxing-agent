// 超星学习通适配器。
// 参照 OCS.js 的组织方式：平台自己的任务模型（taskAction）、入口流程（enterCourse）、答题链路（quiz）
// 都收敛在这里；lib/agent-loop 只保留与平台无关的循环。
import {enterCourse} from '../../lib/course-run.mjs';
import {ensureReport, runQuiz} from '../../lib/quiz-run.mjs';
import {readTasks, pageKind, chapterId} from './probe.mjs';
export {inspectCoursePage, inspectAutomationReadiness} from './inspect.mjs';

// 学习通的任务类型来自 window.AttachmentSetting.attachments[].type
const TASK_ACTIONS = {
  video: 'play_video',
  document: 'play_document',
  workid: 'answer_quiz',
};

export const chaoxing = {
  id: 'chaoxing',
  name: '超星学习通',
  hosts: ['chaoxing.com'],

  match(url) {
    try {
      const host = new URL(url).hostname;
      return host === 'chaoxing.com' || host.endsWith('.chaoxing.com');
    } catch {
      return false;
    }
  },

  /** 平台任务类型 → 通用动作；返回 null 表示这个类型不认识（交给模型判断）。 */
  taskAction(type) {
    return TASK_ACTIONS[String(type || '')] || null;
  },

  /** 页面内任务读取器（会被序列化进页面执行）。 */
  readTasks,
  /** 页面类型：chapter / catalog / space / verify / unknown。 */
  pageKind,
  /** 章节 id。 */
  chapterId,

  /** 是否是章节学习页。 */
  isStudyPage(url) {
    try {
      return /\/mycourse\/studentstudy\/?$/.test(new URL(url).pathname);
    } catch {
      return false;
    }
  },

  /** 是否是课程目录/门户页（需要先 enterCourse）。 */
  isEntryPage(url) {
    try {
      const path = new URL(url).pathname;
      return /\/mycourse\/(stu|studentcourse)\/?$/.test(path) || /\/base\/?$/.test(path) || /\/space\//.test(path);
    } catch {
      return false;
    }
  },

  /** 进入课程（超星要求两步换 enc）。 */
  enterCourse,

  quiz: {
    ensureReport,
    run: runQuiz,
  },
};
