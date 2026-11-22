// 章节结果模型的离线检查。
import {chapterOutcome, shouldRetry} from '../lib/chapter-result.mjs';

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? '✓' : '✗'} ${label}${ok ? '' : ` — 期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`}`);
  if (!ok) failed += 1;
};

const scene = (over = {}) => ({chapter: {id: '100'}, bodySnippet: '', ...over});
const before = {chapter: {id: '100'}};

check('验证通过 → success',
  chapterOutcome({decision: {action: 'play_video'}, result: {ok: true}, check: {ok: true}, scene: scene(), before}), 'success');
check('章节变了也算 success',
  chapterOutcome({decision: {action: 'next_chapter'}, result: {ok: true}, check: {ok: false},
    scene: scene({chapter: {id: '200'}}), before}), 'success');
check('记待补做 → pending',
  chapterOutcome({decision: {action: 'mark_deferred'}, result: {ok: true}, check: {ok: false}, scene: scene(), before}), 'pending');
check('动作执行失败 → error',
  chapterOutcome({decision: {action: 'play_video'}, result: {ok: false}, check: {ok: false}, scene: scene(), before}), 'error');
check('平台提示未开放 → not-open',
  chapterOutcome({decision: {action: 'wait'}, result: {ok: true}, check: {ok: false},
    scene: scene({bodySnippet: '本章尚未开放'}), before}), 'not-open');
check('ask_operator 且验证失败 → error',
  chapterOutcome({decision: {action: 'ask_operator'}, result: {ok: true}, check: {ok: false}, scene: scene(), before}), 'error');
check('ask_operator 无验证 → pending',
  chapterOutcome({decision: {action: 'ask_operator'}, result: null, check: null, scene: scene(), before}), 'pending');

check('pending 且未重试过 → 重试', shouldRetry('pending', 0), true);
check('pending 但已重试 → 不重试', shouldRetry('pending', 1), false);
check('success 不重试', shouldRetry('success', 0), false);
check('error 不重试', shouldRetry('error', 0), false);
check('not-open 不重试', shouldRetry('not-open', 0), false);

console.log(failed ? `\n${failed} 项失败` : '\n章节结果模型测试全部通过');
process.exit(failed ? 1 : 0);
