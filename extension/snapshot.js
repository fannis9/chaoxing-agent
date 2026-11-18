// Kept self-contained so chrome.scripting.executeScript can run it in an already-open tab.
function snapshotPage() {
  const params = new URL(location.href).searchParams;
  const chapterId = params.get('chapterId') || '';
  const courseId = params.get('courseId') || '';
  const readJSON = id => {
    try { return JSON.parse(document.getElementById(id)?.textContent || 'null'); }
    catch { return null; }
  };
  const clean = value => (value || '').replace(/\s+/g, ' ').trim();
  const directory = chapterId ? document.getElementById(`cur${chapterId}`) : null;
  const directoryTitle = clean(directory?.innerText || directory?.textContent);
  const heading = clean(document.querySelector('.prev_title')?.textContent);
  const chapterTitle = directoryTitle.length <= 160 && (!heading || directoryTitle.includes(heading))
    ? directoryTitle || heading : heading;
  const live = readJSON('cx-v3-status');
  let stored = null;
  try { stored = JSON.parse(sessionStorage.getItem('cx-v3-runtime') || 'null'); }
  catch { /* unavailable or invalid checkpoint */ }
  const runtime = live || (stored?.courseId === courseId ? stored : null);
  const report = readJSON('cx-v3-quiz-report');
  const automatic = readJSON('cx-auto-console-state');
  const taskPoints = Array.from(document.querySelectorAll('li[id^="dct"]'))
    .map(node => clean(node.innerText || node.textContent))
    .filter(Boolean).slice(0, 12);
  return {
    page:location.origin + location.pathname, chapterId, courseId, chapterTitle,
    pageTitle:document.title, taskPoints,
    runtime:runtime && {
      status:runtime.status || '', active:Boolean(runtime.active),
      chapterId:runtime.chapterId || '', completed:Array.isArray(runtime.completed) ? runtime.completed.length : 0,
      lastLog:Array.isArray(runtime.lastLog) ? runtime.lastLog.slice(-8) : [],
      incident:runtime.incident?.message || '', updatedAt:runtime.updatedAt || '',
      video:runtime.video && {time:Number(runtime.video.time) || 0,
        duration:Number(runtime.video.duration) || 0, rate:Number(runtime.video.rate) || 1},
      source:live ? 'live' : 'checkpoint',
    },
    quiz:report && {title:report.title || '章节测验', questionCount:report.questionCount || 0},
    automatic,
    visibleLog:clean(document.getElementById('cx-v3-logbox')?.innerText).slice(-3000),
  };
}
