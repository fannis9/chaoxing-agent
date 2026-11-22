// 手动把某个标签页带进队列里的当前课程（用于浏览器重启后恢复）。
import {readFileSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {BridgeClient} from '../lib/bridge-client.mjs';
import {enterCourse, loadQueue} from '../lib/course-run.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
process.env.CX_COURSE_CONFIG ||= join(ROOT, 'quiz-reports', 'automation-courses.json');
process.env.CX_SCHEDULE_PATH ||= join(ROOT, 'quiz-reports', 'automation-schedule.json');

const queue = loadQueue();
if (!queue) throw new Error('没有队列配置');
const course = queue.config.courses[queue.schedule.index] || queue.config.courses[0];
let resume = course.firstChapterId;
try {
  const runtime = JSON.parse(readFileSync(join(ROOT, 'quiz-reports', 'runtime.json'), 'utf8'));
  if (String(runtime.courseId) === String(course.courseId) && /^\d+$/.test(String(runtime.chapterId))) {
    resume = String(runtime.chapterId);
  }
} catch { /* 从首章开始 */ }

const bridge = new BridgeClient();
const tabArg = process.argv.find(arg => arg.startsWith('--tab='))?.slice(6);
const tabs = await bridge.tabs();
const tab = tabArg || tabs.find(row => /studentstudy|mycourse\/(stu|studentcourse)/.test(row.url))?.id;
if (!tab) throw new Error('没有可用的学习通标签页');
const entered = await enterCourse({bridge, tab, course, cpi: queue.config.cpi, chapterId: resume});
console.log(JSON.stringify({course: course.name, courseId: course.courseId, chapterId: resume, tab, url: entered.url}, null, 2));
