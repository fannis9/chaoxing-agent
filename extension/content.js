function snapshot() {
  let runtime = null;
  try { runtime = JSON.parse(document.getElementById('cx-v3-status')?.textContent || 'null'); }
  catch { /* page may be updating */ }
  let quiz = null;
  try {
    const report = JSON.parse(document.getElementById('cx-v3-quiz-report')?.textContent || 'null');
    if (report) quiz = {title:report.title || '章节测验', questionCount:report.questionCount || 0};
  } catch { /* page may be updating */ }
  const box = document.getElementById('cx-v3-logbox');
  let automatic = null;
  try { automatic = JSON.parse(document.getElementById('cx-auto-console-state')?.textContent || 'null'); }
  catch { /* page may be updating */ }
  return {
    title:document.title,
    page:location.origin + location.pathname,
    chapterId:new URL(location.href).searchParams.get('chapterId') || '',
    runtime:runtime && {status:runtime.status || '', active:Boolean(runtime.active),
      chapterId:runtime.chapterId || '', completed:runtime.completed?.length || 0,
      lastLog:(runtime.lastLog || []).slice(-8), incident:runtime.incident?.message || ''},
    quiz,
    automatic,
    visibleLog:(box?.innerText || '').slice(-3000),
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'snapshot') sendResponse(snapshot());
  if (message?.type === 'stop-page') {
    chrome.runtime.sendMessage({type:'stop-page'}, sendResponse);
    return true;
  }
});
