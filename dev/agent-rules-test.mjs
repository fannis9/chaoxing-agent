// Offline checks for the decision rules — no browser, no model calls.
import {ruleDecide} from '../lib/agent-loop.mjs';

let failed = 0;
const check = (label, actual, expected) => {
  const ok = actual === expected;
  console.log(`${ok ? '✓' : '✗'} ${label}${ok ? '' : ` — 期望 ${expected}，实际 ${actual}`}`);
  if (!ok) failed += 1;
};

const scene = (over = {}) => ({
  url: 'https://mooc1.chaoxing.com/mycourse/studentstudy?chapterId=100',
  pageKind: 'chapter', chapter: {id: '100', name: 'test'}, tasks: [],
  player: null, nextAvailable: true, requiresUser: false, blocked: false,
  allTasksDone: false, defaults: {knowledgeid: 1, courseId: 2, clazzId: 3}, ...over,
});
const decide = (over) => ruleDecide(scene(over))?.action ?? null;

check('验证码/登录 → ask_operator', decide({requiresUser: true}), 'ask_operator');
check('反爬页 → ask_operator', decide({pageKind: 'verify'}), 'ask_operator');
check('空间首页 → open_course', decide({pageKind: 'space'}), 'open_course');
check('课程目录 → open_course', decide({pageKind: 'catalog'}), 'open_course');
check('未知页面 → ask_operator', decide({pageKind: 'unknown'}), 'ask_operator');
check('没有任务且平台显示暂无内容 → mark_deferred', decide({tasks: [], emptyContent: true}), 'mark_deferred');
check('没有任务但可能没加载完 → 先 wait', decide({tasks: [], emptyContent: false}), 'wait');
check('只有非任务点内容 → 直接下一章', decide({tasks: [{id: '', type: 'video', state: 'pending', required: false}]}), 'next_chapter');
check('非任务点不触发播放', decide({tasks: [{id: '', type: 'video', state: 'pending', required: false}, {id: '7', type: 'video', state: 'done', required: true}], allTasksDone: true}), 'next_chapter');
check('全部完成且有下一节 → next_chapter', decide({
  tasks: [{id: '1', type: 'video', state: 'done'}], allTasksDone: true,
}), 'next_chapter');
check('全部完成但末章 → ask_operator', decide({
  tasks: [{id: '1', type: 'video', state: 'done'}], allTasksDone: true, nextAvailable: false,
}), 'ask_operator');
check('视频未开始 → play_video', decide({tasks: [{id: '1', type: 'video', state: 'pending'}]}), 'play_video');
check('视频正在播 → wait', decide({
  tasks: [{id: '1', type: 'video', state: 'pending'}],
  player: {currentTime: 42, duration: 300, paused: false},
}), 'wait');
check('视频已暂停 → play_video', decide({
  tasks: [{id: '1', type: 'video', state: 'pending'}],
  player: {currentTime: 42, duration: 300, paused: true},
}), 'play_video');
check('文档 → play_document', decide({tasks: [{id: '9', type: 'document', state: 'pending', token: 'abc'}]}), 'play_document');
check('测验 → answer_quiz', decide({tasks: [{id: '7', type: 'workid', state: 'pending'}]}), 'answer_quiz');
check('未知类型 → 交给模型（ruleDecide 返回 null）', decide({tasks: [{id: '3', type: 'hyperlink', state: 'pending'}]}), null);
check('陌生平台 → 交给模型', ruleDecide({...scene(), url: 'https://example.com/course', tasks: [{id: '1', type: 'video', state: 'pending'}]}), null);

const doc = ruleDecide(scene({tasks: [{id: '9', type: 'document', state: 'pending', token: 'abc'}]}));
check('文档决策带上接口参数', `${doc.args.taskId}/${doc.args.knowledgeid}/${doc.args.courseid}/${doc.args.clazzid}/${doc.args.token}`,
  '9/1/2/3/abc');

check('视频弹题 → answer_popup', ruleDecide({...scene(), popup: {present: true, text: '下列哪个是电子？', options: ['质子', '电子']}})?.action, 'answer_popup');

console.log(failed ? `\n${failed} 项失败` : '\n规则测试全部通过');
process.exit(failed ? 1 : 0);
