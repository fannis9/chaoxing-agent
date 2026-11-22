// 平台注册表：按 URL 选出适配器。新增平台 = 在 platforms/<id>/ 实现同一组钩子并在这里登记。
import {chaoxing} from './chaoxing/index.mjs';

const adapters = [chaoxing];

/** 返回匹配该 URL 的平台适配器，未匹配返回 null。 */
export function detectPlatform(url = '') {
  for (const adapter of adapters) {
    try { if (adapter.match(url)) return adapter; } catch { /* 无效 URL */ }
  }
  return null;
}

export function platformById(id) {
  return adapters.find(adapter => adapter.id === id) || null;
}

export function platformList() {
  return adapters.map(({id, name, hosts}) => ({id, name, hosts}));
}
