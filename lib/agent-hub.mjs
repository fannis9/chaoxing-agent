// In-process hub: the extension connects over WebSocket, local processes send
// commands over HTTP. Mounted by chaoxing-console.mjs so one port serves both
// the panel and the browser agent.
import {acceptKey, createReader, encodeText} from './ws.mjs';

export function createHub({token}) {
  const agents = new Set();
  const pending = new Map();
  let nextId = 1;

  const send = (socket, payload) => {
    if (!socket || socket.destroyed) return false;
    socket.write(encodeText(JSON.stringify(payload)));
    return true;
  };

  const failPending = (socket, reason) => {
    for (const [id, entry] of pending) {
      if (entry.socket !== socket) continue;
      clearTimeout(entry.timer);
      pending.delete(id);
      entry.reject(new Error(reason));
    }
  };

  const command = (cmd, args = {}, {timeoutMs = 20000} = {}) => {
    const agent = [...agents].find(socket => !socket.destroyed);
    if (!agent) return Promise.reject(new Error('扩展未连接：在侧栏里填好配对令牌后重试'));
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`命令超时（${timeoutMs}ms）：${cmd}`));
      }, timeoutMs);
      timer.unref?.();
      pending.set(id, {resolve, reject, timer, socket: agent});
      if (!send(agent, {type: 'cmd', id, cmd, args})) {
        pending.delete(id);
        clearTimeout(timer);
        reject(new Error('扩展连接已断开'));
      }
    });
  };

  const upgrade = (request, socket) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname !== '/agent' || url.searchParams.get('token') !== token) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    socket.write([
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${acceptKey(request.headers['sec-websocket-key'])}`,
      '', '',
    ].join('\r\n'));
    socket.setNoDelay(true);
    socket.__lastSeen = Date.now();
    agents.add(socket);

    const read = createReader(({opcode, data}) => {
      if (opcode === 0x8) { socket.end(); return; }
      if (opcode !== 0x1) return;
      let message;
      try { message = JSON.parse(data.toString()); } catch { return; }
      socket.__lastSeen = Date.now();
      if (message.type === 'hello') { send(socket, {type: 'hello', ok: true}); return; }
      if (message.type === 'pong') return;
      if (message.type !== 'result') return;
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.ok) entry.resolve(message.result);
      else entry.reject(new Error(message.error || '扩展返回失败'));
    });
    socket.on('data', read);
    socket.on('close', () => { agents.delete(socket); failPending(socket, '扩展断线'); });
    socket.on('error', () => {});
  };

  // 休眠/网络闪断后 TCP 可能假死：定期探活，超时就丢掉让扩展重连。
  const heartbeat = setInterval(() => {
    for (const socket of [...agents]) {
      if (socket.destroyed) { agents.delete(socket); continue; }
      if (Date.now() - (socket.__lastSeen || 0) > 180000) {
        agents.delete(socket);
        failPending(socket, '扩展心跳超时');
        socket.destroy();
        continue;
      }
      send(socket, {type: 'ping'});
    }
  }, 20000);
  heartbeat.unref?.();

  const status = () => ({agent: agents.size > 0, clients: agents.size, pending: pending.size});

  return {command, upgrade, status};
}
