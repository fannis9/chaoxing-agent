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
