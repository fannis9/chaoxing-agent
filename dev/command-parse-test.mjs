// Offline checks for the argv → agent command translation.
import {parseCommand} from '../lib/bridge-client.mjs';

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? '✓' : '✗'} ${label}${ok ? '' : ` — 期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`}`);
  if (!ok) failed += 1;
};

check('status', parseCommand(['status', '--no-autostart', '--json']), {cmd: 'status', args: {'no-autostart': true, json: true}});
check('tabs', parseCommand(['tabs', '--json']), {cmd: 'tabs', args: {json: true}});
check('eval 带 tab/world', parseCommand(['eval', '1+1', '--world', 'MAIN', '--tab', 42]),
  {cmd: 'eval', args: {world: 'MAIN', tab: '42', code: '1+1'}});
check('navigate 带 tab', parseCommand(['navigate', 'https://x.y/z', '--tab', '7']),
  {cmd: 'navigate', args: {tab: '7', url: 'https://x.y/z'}});
check('open 后台', parseCommand(['open', 'https://x.y/z', '--background', '--json']),
  {cmd: 'open', args: {background: true, json: true, url: 'https://x.y/z'}});
check('activate 位置参数', parseCommand(['activate', '123']), {cmd: 'activate', args: {tab: '123'}});
check('close 位置参数', parseCommand(['close', 9]), {cmd: 'close', args: {tab: '9'}});
check('url 位置参数', parseCommand(['url', '5']), {cmd: 'url', args: {tab: '5'}});

console.log(failed ? `\n${failed} 项失败` : '\n命令解析测试全部通过');
process.exit(failed ? 1 : 0);
