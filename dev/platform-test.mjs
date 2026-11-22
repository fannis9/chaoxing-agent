// 平台适配器与注册表的离线检查。
import {detectPlatform, platformById, platformList} from '../platforms/registry.mjs';

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? '✓' : '✗'} ${label}${ok ? '' : ` — 期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`}`);
  if (!ok) failed += 1;
};

check('学习通章节页被识别', detectPlatform('https://mooc1.chaoxing.com/mycourse/studentstudy?chapterId=1')?.id, 'chaoxing');
check('学习通门户被识别', detectPlatform('https://i.chaoxing.com/base?ws=1')?.id, 'chaoxing');
check('学习通目录被识别', detectPlatform('https://mooc2-ans.chaoxing.com/mooc2-ans/mycourse/stu?courseid=1')?.id, 'chaoxing');
check('别的站点不被误判', detectPlatform('https://zhihuishu.com/study') ?? null, null);
check('空 URL 不崩', detectPlatform('') ?? null, null);
check('按 id 取适配器', platformById('chaoxing')?.name, '超星学习通');
check('未知 id 返回 null', platformById('nope') ?? null, null);
check('注册表只登记一个平台', platformList().map(p => p.id), ['chaoxing']);

const cx = platformById('chaoxing');
check('任务类型 → 动作：video', cx.taskAction('video'), 'play_video');
check('任务类型 → 动作：document', cx.taskAction('document'), 'play_document');
check('任务类型 → 动作：workid', cx.taskAction('workid'), 'answer_quiz');
check('未知任务类型 → null', cx.taskAction('hyperlink') ?? null, null);
check('缺少类型 → null', cx.taskAction(undefined) ?? null, null);

check('章节页判定', cx.isStudyPage('https://mooc1.chaoxing.com/mycourse/studentstudy?chapterId=1'), true);
check('目录页不算章节页', cx.isStudyPage('https://mooc2-ans.chaoxing.com/mooc2-ans/mycourse/stu?courseid=1'), false);
check('目录页判定', cx.isEntryPage('https://mooc2-ans.chaoxing.com/mooc2-ans/mycourse/stu?courseid=1'), true);
check('章节页不算入口页', cx.isEntryPage('https://mooc1.chaoxing.com/mycourse/studentstudy?chapterId=1'), false);

console.log(failed ? `\n${failed} 项失败` : '\n平台适配器测试全部通过');
process.exit(failed ? 1 : 0);
