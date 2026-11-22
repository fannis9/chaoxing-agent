// End-to-end smoke test against the running console and the extension.
import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const PORT = Number(process.env.CX_CONSOLE_PORT || 8788);
const BASE = `http://127.0.0.1:${PORT}`;
const token = readFileSync(join(ROOT, 'quiz-reports', 'console-token'), 'utf8').trim();
const headers = {'Content-Type': 'application/json', 'X-CX-Console': '1', Authorization: `Bearer ${token}`};

let failed = false;
const assert = (label, condition, detail = '') => {
  console.log(`${condition ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!condition) failed = true;
};

const call = async (cmd, args = {}, timeoutMs = 20000) => {
  const started = Date.now();
  const response = await fetch(`${BASE}/agent/command`, {
    method: 'POST', headers, body: JSON.stringify({cmd, args, timeoutMs}),
  });
  const body = await response.json();
  return {...body, ms: Date.now() - started};
};

const status = await (await fetch(`${BASE}/status`, {headers})).json().catch(() => null);
if (!status) {
  console.log(`控制台没在运行：先启动它（node dev/console.mjs，端口 ${PORT}）`);
  process.exit(1);
}
if (!status.agent?.agent) {
  console.log([
    '扩展还没连上。请：',
    '1. edge://extensions → 重新加载本仓库的 extension 目录',
    '2. 打开学习通页面，点扩展图标打开侧栏，填端口和令牌：',
    `   端口 ${PORT}`,
    `   令牌 ${token}`,
    '3. 再运行一次 node dev/smoke.mjs',
  ].join('\n'));
  process.exit(1);
}

const tabs = await call('tabs');
assert('tabs 返回数组', Array.isArray(tabs.result), `${tabs.result?.length} 个标签，${tabs.ms}ms`);

const opened = await call('open', {url: 'https://i.chaoxing.com/base', background: true});
assert('open 新建标签', Boolean(opened.result?.tabId), `tabId=${opened.result?.tabId}，${opened.ms}ms`);
const tabId = opened.result?.tabId;

await new Promise(resolve => setTimeout(resolve, 2500));

const evaluated = await call('eval', {tab: tabId, code: 'JSON.stringify({title:document.title, href:location.href.slice(0,60)})'});
assert('eval 读到页面', typeof evaluated.result === 'string' && evaluated.result.includes('href'), `${evaluated.result}，${evaluated.ms}ms`);

const activated = await call('activate', {tab: tabId});
assert('activate 成功', activated.result?.ok === true, `${activated.ms}ms`);

const closed = await call('close', {tab: tabId});
assert('close 成功', closed.result?.ok === true, `${closed.ms}ms`);

console.log(failed ? '\n冒烟测试失败' : '\n冒烟测试通过：扩展通道可用');
process.exit(failed ? 1 : 0);
