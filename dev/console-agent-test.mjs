// 集成自检：控制台内嵌 hub + /agent/command + 新的 BridgeClient 适配层。
import net from 'node:net';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createReader, encodeClose, encodeText} from '../lib/ws.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const PORT = Number(process.env.TEST_PORT || 8789);
const BASE = `http://127.0.0.1:${PORT}`;

let failed = false;
const assert = (label, condition, detail = '') => {
  console.log(`${condition ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!condition) failed = true;
};

const child = spawn(process.execPath, [join(ROOT, 'chaoxing-console.mjs')], {
  env: {...process.env, CX_CONSOLE_PORT: String(PORT)},
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stderr.on('data', chunk => process.stderr.write(`[console] ${chunk}`));

await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('控制台启动超时')), 15000);
  child.stdout.on('data', chunk => {
    const text = chunk.toString();
    if (text.includes('监听')) { clearTimeout(timer); resolve(); }
  });
});

const token = readFileSync(join(ROOT, 'quiz-reports', 'console-token'), 'utf8').trim();
const call = async (cmd, args = {}) => {
  const response = await fetch(`${BASE}/agent/command`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json', 'X-CX-Console': '1', Authorization: `Bearer ${token}`},
    body: JSON.stringify({cmd, args}),
  });
  return {status: response.status, body: await response.json()};
};

function connectAgent() {
  return new Promise((resolve, reject) => {
    const socket = net.connect(PORT, '127.0.0.1', () => {
      socket.write([
        `GET /agent?token=${token} HTTP/1.1`,
        `Host: 127.0.0.1:${PORT}`,
        'Upgrade: websocket', 'Connection: Upgrade',
        `Sec-WebSocket-Key: ${randomBytes(16).toString('base64')}`,
        'Sec-WebSocket-Version: 13', '', '',
      ].join('\r\n'));
    });
    let handshake = Buffer.alloc(0);
    let upgraded = false;
    const read = createReader(({opcode, data}) => {
      if (opcode !== 0x1) return;
      const message = JSON.parse(data.toString());
      if (message.type !== 'cmd') return;
      const result = message.cmd === 'eval' ? `echo:${message.args.code}` : {fake: true};
      socket.write(encodeText(JSON.stringify({type: 'result', id: message.id, ok: true, result}), true));
    });
    socket.on('data', chunk => {
      if (upgraded) { read(chunk); return; }
      handshake = Buffer.concat([handshake, chunk]);
      const end = handshake.indexOf('\r\n\r\n');
      if (end === -1) return;
      const head = handshake.subarray(0, end).toString();
      if (!head.startsWith('HTTP/1.1 101')) { reject(new Error(head.split('\r\n')[0])); return; }
      upgraded = true;
      const rest = handshake.subarray(end + 4);
      if (rest.length) read(rest);
      resolve(socket);
    });
    socket.on('error', reject);
  });
}

try {
  const before = await (await fetch(`${BASE}/status`, {headers: {'X-CX-Console': '1', Authorization: `Bearer ${token}`}})).json();
  assert('控制台启动且 agent 未连接', before.agent?.agent === false, JSON.stringify(before.agent));

  const socket = await connectAgent();
  await new Promise(r => setTimeout(r, 200));

  const after = await (await fetch(`${BASE}/status`, {headers: {'X-CX-Console': '1', Authorization: `Bearer ${token}`}})).json();
  assert('扩展连上后 /status 报 agent=true', after.agent?.agent === true, JSON.stringify(after.agent));

  process.env.CX_CONSOLE_PORT = String(PORT);
  process.env.CX_CONSOLE_TOKEN = token;
  const {BridgeClient} = await import('../lib/bridge-client.mjs');
  const bridge = new BridgeClient();
  const raw = await bridge.command('eval', '1+1', '--world', 'MAIN', '--tab', '42');
  assert('BridgeClient.command 解析 argv 并回传', raw === 'echo:1+1', raw);

  const tabsRaw = await bridge.command('tabs', '--json');
  assert('tabs --json 走通', tabsRaw.includes('fake'), tabsRaw.replace(/\s+/g, ' ').slice(0, 60));

  socket.write(encodeClose(1000, true));
  socket.end();
  await new Promise(r => setTimeout(r, 300));
  const dropped = await call('tabs').catch(error => ({status: 0, body: {error: error.message}}));
  assert('断线后命令失败', dropped.status >= 400, JSON.stringify(dropped.body));
} finally {
  child.kill();
}

console.log(failed ? '\n集成自检失败' : '\n集成自检通过：控制台内嵌 hub + 适配层可用');
process.exit(failed ? 1 : 0);

