// One service worker does two jobs:
//  1) the side panel (学习通控制台 UI), enabled only on chaoxing tabs;
//  2) the browser agent: a WebSocket to the local console that executes
//     tabs/scripting commands, replacing Page Bridge.
const PANEL = 'panel.html';
const RECONNECT_MS = [1000, 2000, 5000, 10000];

/* ---------------- side panel ---------------- */

function isChaoxing(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' &&
      (parsed.hostname === 'chaoxing.com' || parsed.hostname.endsWith('.chaoxing.com'));
  } catch { return false; }
}

async function syncPanelForTab(tabId, url) {
  try {
    await chrome.sidePanel.setOptions({tabId, path: PANEL, enabled: isChaoxing(url)});
  } catch { /* tab may have closed during navigation */ }
}

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.sidePanel.setPanelBehavior({openPanelOnActionClick: true}).catch(() => {});
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map(tab => syncPanelForTab(tab.id, tab.url)));
});
chrome.runtime.onStartup.addListener(async () => {
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map(tab => syncPanelForTab(tab.id, tab.url)));
});
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.url || info.status === 'complete') void syncPanelForTab(tabId, tab.url);
});

/* ---------------- browser agent ---------------- */

let socket = null;
let attempt = 0;
let lastMessageAt = 0;
let consolePort = 8788;
let consoleToken = '';

const badge = text => chrome.action.setBadgeText({text}).catch(() => {});
const badgeColor = color => chrome.action.setBadgeBackgroundColor({color}).catch(() => {});

async function loadConfig() {
  const stored = await chrome.storage.local.get({consolePort: 8788, consoleToken: ''});
  consolePort = Number(stored.consolePort) || 8788;
  consoleToken = String(stored.consoleToken || '').trim();
}

function connect() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
  if (!consoleToken) { badge('·'); badgeColor('#6b7280'); return; }
  try {
    socket = new WebSocket(`ws://127.0.0.1:${consolePort}/agent?token=${encodeURIComponent(consoleToken)}`);
  } catch {
    scheduleReconnect();
    return;
  }
  socket.addEventListener('open', () => {
    attempt = 0;
    lastMessageAt = Date.now();
    badge('ON');
    badgeColor('#15803d');
    socket.send(JSON.stringify({type: 'hello', version: chrome.runtime.getManifest().version}));
  });
  socket.addEventListener('message', event => {
    lastMessageAt = Date.now();
    let message;
    try { message = JSON.parse(event.data); } catch { return; }
    if (message.type === 'ping') { socket?.send(JSON.stringify({type: 'pong'})); return; }
    if (message.type !== 'cmd') return;
    handleCommand(message).then(result => {
      socket?.send(JSON.stringify({type: 'result', id: message.id, ok: true, result}));
    }).catch(error => {
      socket?.send(JSON.stringify({type: 'result', id: message.id, ok: false, error: String(error.message || error)}));
    });
  });
  socket.addEventListener('close', () => {
    badge('…');
    badgeColor('#b45309');
    scheduleReconnect();
  });
  socket.addEventListener('error', () => {});
}

function scheduleReconnect() {
  const delay = RECONNECT_MS[Math.min(attempt, RECONNECT_MS.length - 1)];
  attempt += 1;
  setTimeout(connect, delay);
  chrome.alarms.create('cx-agent-reconnect', {periodInMinutes: 1}).catch(() => {});
}

const handlers = {
  status: () => ({connected: true, version: chrome.runtime.getManifest().version}),
  tabs: async () => (await chrome.tabs.query({})).map(tab => ({
    id: String(tab.id), windowId: tab.windowId, url: tab.url || '',
    title: tab.title || '', active: Boolean(tab.active),
  })),
  url: async ({tab}) => (await chrome.tabs.get(Number(tab))).url || '',
  eval: async ({tab, code, world = 'MAIN'}) => {
    const target = {tabId: Number(tab)};
    try {
      const [entry] = await chrome.scripting.executeScript({
        target, world, func: source => (0, eval)(source), args: [String(code)],
      });
      return entry?.result ?? null;
    } catch (error) {
      if (!/world/i.test(String(error.message))) throw error;
      const [entry] = await chrome.scripting.executeScript({
        target, func: source => (0, eval)(source), args: [String(code)],
      });
      return entry?.result ?? null;
    }
  },
  navigate: async ({tab, url}) => { await chrome.tabs.update(Number(tab), {url}); return {ok: true}; },
  open: async ({url, background = false}) => {
    const tab = await chrome.tabs.create({url, active: !background});
    return {ok: true, tabId: String(tab.id)};
  },
  activate: async ({tab}) => { await chrome.tabs.update(Number(tab), {active: true}); return {ok: true}; },
  // 把窗口从最小化恢复并聚焦：标签隐藏时平台会暂停播放。
  focus_window: async ({tab}) => {
    const target = await chrome.tabs.get(Number(tab));
    await chrome.windows.update(target.windowId, {focused: true, state: 'normal'});
    return {ok: true, windowId: target.windowId};
  },
  // 把标签挪进独立窗口：窗口不最小化时标签始终是选中态，平台就不会因为“标签隐藏”暂停。
  open_window: async ({tab, url}) => {
    const options = {focused: false, state: 'normal'};
    if (tab) options.tabId = Number(tab); else options.url = url;
    const win = await chrome.windows.create(options);
    return {ok: true, windowId: win.id, tabId: win.tabs?.[0]?.id ? String(win.tabs[0].id) : null};
  },
  close: async ({tab}) => { await chrome.tabs.remove(Number(tab)); return {ok: true}; },
};

async function handleCommand({cmd, args = {}}) {
  const handler = handlers[cmd];
  if (!handler) throw new Error(`未知命令：${cmd}`);
  return handler(args);
}

chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'cx-agent-reconnect') { checkStale(); connect(); } });
// 休眠唤醒后 WebSocket 可能仍显示 OPEN 但已死：没有心跳就主动重连。
function checkStale() {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  if (Date.now() - lastMessageAt > 70000) {
    socket.close();
    socket = null;
    connect();
  }
}
setInterval(checkStale, 25000);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (!('consolePort' in changes) && !('consoleToken' in changes)) return;
  void loadConfig().then(() => {
    socket?.close();
    socket = null;
    connect();
  });
});
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'reconnect') {
    loadConfig().then(() => { socket?.close(); socket = null; connect(); sendResponse({ok: true}); });
    return true;
  }
  if (message?.type === 'status') {
    sendResponse({connected: socket?.readyState === WebSocket.OPEN, port: consolePort, hasToken: Boolean(consoleToken)});
    return false;
  }
  return false;
});

void loadConfig().then(connect);
