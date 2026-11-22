// 视频弹题：选项匹配与提示词构造（离线）。
import {pickOption, buildPopupRequest} from '../lib/popup.mjs';

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? '✓' : '✗'} ${label}${ok ? '' : ` — 期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`}`);
  if (!ok) failed += 1;
};

const options = ['A. 质子', 'B. 中子', 'C. 电子', 'D. 原子核'];
check('字母答案 → 下标', pickOption(options, 'C'), 2);
check('带括号的字母', pickOption(options, '（B）'), 1);
check('“第三个” → 下标', pickOption(options, '第三个'), 2);
check('原文匹配（忽略标点）', pickOption(options, '电子'), 2);
check('带前缀的原文', pickOption(options, 'C. 电子'), 2);
check('空答案 → -1', pickOption(options, ''), -1);
check('答非所问 → -1', pickOption(options, '量子力学'), -1);
check('歧义（多个包含）→ -1', pickOption(['质子数', '质子量'], '质子'), -1);
check('空选项 → -1', pickOption([], 'A'), -1);
check('未知字母 → -1', pickOption(options, 'H'), -1);

const request = buildPopupRequest({text: '下列哪个是电子？', options});
check('提示词包含题干', request.input.includes('电子'), true);
check('提示词包含选项', request.input.includes('质子'), true);
check('要求结构化输出', request.schema.required.join(','), 'answer,confidence');
check('带防注入说明', request.instructions.includes('不可信'), true);
check('超时设置', request.timeout, 45000);

console.log(failed ? `\n${failed} 项失败` : '\n弹题测试全部通过');
process.exit(failed ? 1 : 0);
