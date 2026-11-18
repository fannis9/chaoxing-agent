const PANEL = 'panel.html';

function isChaoxing(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' &&
      (parsed.hostname === 'chaoxing.com' || parsed.hostname.endsWith('.chaoxing.com'));
  } catch { return false; }
}

async function updateTab(tabId, url) {
  try {
    await chrome.sidePanel.setOptions({tabId, path:PANEL, enabled:isChaoxing(url)});
  } catch { /* tab may have closed during navigation */ }
}

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:true});
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map(tab => updateTab(tab.id, tab.url)));
});
chrome.runtime.onStartup.addListener(async () => {
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map(tab => updateTab(tab.id, tab.url)));
});
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.url || info.status === 'complete') void updateTab(tabId, tab.url);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'stop-page' || !isChaoxing(sender.url || sender.tab?.url)) return;
  const tabId = sender.tab?.id;
  if (!tabId) return;
  chrome.scripting.executeScript({target:{tabId}, world:'MAIN',
    func:() => {
      if (typeof window.__cxV3?.stop !== 'function') return {ok:false, reason:'当前页没有运行中的章节脚本'};
      window.__cxV3.stop();
      return {ok:true};
    }}).then(result => sendResponse(result[0]?.result || {ok:false}))
    .catch(error => sendResponse({ok:false,reason:error.message}));
  return true;
});
