// 真实页面快照的回归测试：同一类页面必须得到同一个决策。
import {ruleDecide} from '../lib/agent-loop.mjs';
import {scenes} from './fixtures/scenes.mjs';

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? '✓' : '✗'} ${label}${ok ? '' : ` — 期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`}`);
  if (!ok) failed += 1;
};
const act = (scene, options) => ruleDecide(scene, options)?.action ?? null;

check('视频在播 → wait', act(scenes.videoPlaying), 'wait');
check('播放器没加载 → play_video', act(scenes.videoNotLoaded), 'play_video');
check('视频快到结尾 → wait（别打断完成上报）', act(scenes.videoNearEnd), 'wait');
check('外链已完成 → next_chapter', act(scenes.hyperlinkDone), 'next_chapter');
check('拓展资料默认跳过 → next_chapter', act(scenes.optionalVideo), 'next_chapter');
check('开关打开则播放拓展资料 → play_video', act(scenes.optionalVideo, {processOptional: true}), 'play_video');
check('拓展资料处理过 → next_chapter',
  act(scenes.optionalVideo, {processOptional: true, satisfied: ['0:']}), 'next_chapter');
check('空章（暂无内容）→ mark_deferred', act(scenes.emptyChapter), 'mark_deferred');
check('章节测验 → answer_quiz', act(scenes.chapterTest), 'answer_quiz');
check('未实现的签名交给模型 → null', act(scenes.pptWithAudio), null);
check('视频弹题优先 → answer_popup', act(scenes.videoPopup), 'answer_popup');

// 外链决策参数要带 taskKey，方便控制器记录
const hyperlink = ruleDecide({...scenes.hyperlinkDone, tasks: [{...scenes.hyperlinkDone.tasks[0], state: 'pending'}]});
check('外链未完成 → open_link', hyperlink?.action, 'open_link');
check('外链参数带 taskKey', Boolean(hyperlink?.args?.taskKey), true);

console.log(failed ? `\n${failed} 项失败` : '\n真实页面快照回归通过');
process.exit(failed ? 1 : 0);
