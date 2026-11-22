// Same surface as the old Page Bridge client, backed by this project's own
// extension through the local console (/agent/command). No subprocesses.
import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.CX_CONSOLE_PORT || 8788);
let cachedToken = String(process.env.CX_CONSOLE_TOKEN || '');

function token() {
  if (cachedToken) return cachedToken;
  try { cachedToken = readFileSync(join(HERE, '..', 'quiz-reports', 'console-token'), 'utf8').trim(); } catch { /* console not started yet */ }
  return cachedToken;
}

const format = value => (typeof value === 'string' ? value : JSON.stringify(value, null, 2));

/** Translate the old argv-style calls into one JSON command. */
export function parseCommand(argv) {
  const [cmd, ...rest] = argv;
  const args = {};
  const positional = [];
  for (let i = 0; i < rest.length; i += 1) {
    const item = rest[i];
    if (typeof item === 'string' && item.startsWith('--')) {
      const name = item.slice(2);
      if (['json', 'no-autostart', 'background'].includes(name)) { args[name] = true; continue; }
      args[name] = rest[i + 1];
      i += 1;
    } else positional.push(item);
  }
  if (cmd === 'eval') args.code = positional[0] ?? '';
  if (cmd === 'navigate' || cmd === 'open') args.url = positional[0] ?? '';
  if (['activate', 'close', 'url'].includes(cmd)) args.tab = String(positional[0] ?? '');
  if (args.tab !== undefined) args.tab = String(args.tab);
  if (args.background) args.background = true;
  return {cmd, args};
}

export class BridgeClient {
  // `execute` is accepted for signature compatibility with the old client.
  constructor(execute) { this.execute = execute; }

  async command(...argv) {
    const {cmd, args} = parseCommand(argv);
    const response = await fetch(`http://127.0.0.1:${PORT}/agent/command`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'X-CX-Console': '1', Authorization: `Bearer ${token()}`},
      body: JSON.stringify({cmd, args}),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.ok === false) throw new Error(body.error || `agent 命令失败：${cmd}`);
    return format(body.result);
  }

  async tabs() {
    let raw;
    try { raw = await this.command('tabs', '--json'); }
    catch (error) {
      if (/扩展未连接/.test(String(error.message))) return [];
      throw error;
    }
    let tabs;
    try { tabs = JSON.parse(raw); } catch {
      throw new Error('agent 返回的标签列表不是 JSON');
    }
    if (!Array.isArray(tabs)) throw new Error('agent 标签协议不兼容：需要数组');
    return tabs.map(tab => ({...tab, id: String(tab.id)}));
  }

  async url(tab) { return (await this.tabs()).find(row => row.id === String(tab))?.url || ''; }
}
