// 倍速策略的离线检查。
import {pickRate, recordRate, needsRateChange, DEFAULT_MAX_RATE} from '../lib/rate.mjs';

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? '✓' : '✗'} ${label}${ok ? '' : ` — 期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`}`);
  if (!ok) failed += 1;
};

check('默认上限 2x', DEFAULT_MAX_RATE, 2);
check('没被锁定时用上限', pickRate(null, 2), 2);
check('被锁定后退回 1x', pickRate({blocked: true}, 2), 1);
check('上限填 1 时就是 1x', pickRate(null, 1), 1);
check('上限非法时退回 1x', pickRate(null, 0), 1);

check('读回 2x → 记成功', recordRate({failures: 1, blocked: false}, 2, 2), {failures: 0, blocked: false});
check('读回 1x → 记一次失败', recordRate(null, 1, 2), {failures: 1, blocked: false});
check('连续两次失败 → 锁定', recordRate({failures: 1, blocked: false}, 1, 2), {failures: 2, blocked: true});
check('锁定后不再累计', recordRate({failures: 2, blocked: true}, 1, 2), {failures: 3, blocked: true});
check('目标 1x 时不动状态', recordRate({failures: 1, blocked: false}, 1, 1), {failures: 1, blocked: false});

check('已经是 2x 就不用再设', needsRateChange(2, 2), false);
check('当前 1x 需要设置', needsRateChange(1, 2), true);
check('读不到倍速需要设置', needsRateChange(null, 2), true);
check('目标 1x 永远不用设置', needsRateChange(1, 1), false);

console.log(failed ? `\n${failed} 项失败` : '\n倍速策略测试全部通过');
process.exit(failed ? 1 : 0);
