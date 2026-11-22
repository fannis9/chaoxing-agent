// 倍速策略：能倍速就倍速，被平台重置就退回 1x 并记住（按章节）。
// 纯函数，便于离线测试；控制器只负责把观测值喂进来。

export const DEFAULT_MAX_RATE = 2;

/** 这一章现在该用多少倍速。 */
export function pickRate(state, maxRate = DEFAULT_MAX_RATE) {
  const cap = Number.isFinite(maxRate) && maxRate > 1 ? maxRate : 1;
  return state?.blocked ? 1 : cap;
}

/**
 * 用观测到的实际倍速更新状态。
 * @param {{failures:number, blocked:boolean}} state
 * @param {number} observed 实际读到的 playbackRate
 * @param {number} desired 想设置的倍速
 * @param {number} limit 连续失败几次就锁定 1x
 */
export function recordRate(state, observed, desired, limit = 2) {
  const current = {failures: 0, blocked: false, ...(state || {})};
  if (!Number.isFinite(desired) || desired <= 1) return current;
  if (Number.isFinite(observed) && observed >= desired - 0.01) {
    return {failures: 0, blocked: false};
  }
  const failures = current.failures + 1;
  return {failures, blocked: failures >= limit};
}

/** 需要尝试设置倍速吗（已经是目标值就不用每轮都设）。 */
export function needsRateChange(observed, desired) {
  if (!Number.isFinite(desired) || desired <= 1) return false;
  return !Number.isFinite(observed) || observed < desired - 0.01;
}
