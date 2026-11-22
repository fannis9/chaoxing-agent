// Generic scene probe. Runs inside the page (stringified into eval), so it must
// not reference anything outside its own body. It reports signals instead of
// assuming one particular layout, so a changed page still produces usable data.

export function probeScene() {
  const visible = element => Boolean(element?.isConnected && element.getClientRects().length);
  const texts = [];

  // 1) Task container: chaoxing exposes AttachmentSetting inside the cards frame.
  const containers = [];
  const walk = (view, depth) => {
    let doc;
    try { doc = view.document; } catch { return; }
    try { texts.push((doc.body?.innerText || '').replace(/\s+/g, ' ')); } catch { /* frame changing */ }
    try {
      const setting = view.AttachmentSetting;
      if (setting && Array.isArray(setting.attachments)) containers.push({view, setting, depth});
    } catch { /* no attachment data in this frame */ }
    if (depth >= 4) return;
    for (const frame of doc.querySelectorAll('iframe')) {
      if (!visible(frame)) continue;
      try { if (frame.contentWindow) walk(frame.contentWindow, depth + 1); } catch { /* cross origin */ }
    }
  };
  walk(window, 0);

  const bodyText = texts.join(' ');
  let tasks = [];
  let defaults = null;
  let containerDepth = null;
  if (containers.length) {
    containers.sort((a, b) => b.depth - a.depth);
    const selected = containers[0];
    containerDepth = selected.depth;
    try { defaults = {...(selected.setting.defaults || {})}; } catch { defaults = null; }
    tasks = selected.setting.attachments.map((item, index) => {
      const id = String(item?.jobid || '');
      let domFinished = false;
      try {
        const node = [...selected.view.document.querySelectorAll('[jobid]')]
          .find(element => element.getAttribute('jobid') === id);
        domFinished = Boolean(node?.closest('.ans-attach-ct')?.classList.contains('ans-job-finished'));
      } catch { /* tab re-rendered */ }
      const done = domFinished || item?.isPassed === true;
      return {
        index, id, type: String(item?.type || ''), job: Boolean(item?.job),
        passed: item?.isPassed, domFinished, token: String(item?.jtoken || ''),
        state: done ? 'done' : 'pending',
      };
    });
  }

  // 2) Player state (may live several iframes deep).
  let player = null;
  const walkPlayer = (view, depth) => {
    if (player) return;
    let doc;
    try { doc = view.document; } catch { return; }
    const video = doc.querySelector('video');
    if (video) {
      let videojs = false;
      try { videojs = Boolean(view.videojs?.getPlayers?.() && Object.keys(view.videojs.getPlayers()).length); } catch { /* plain element */ }
      player = {
        present: true,
        readyState: video.readyState,
        paused: video.paused,
        duration: Number.isFinite(video.duration) ? Math.round(video.duration) : null,
        currentTime: Math.round(video.currentTime),
        rate: video.playbackRate,
        videojs,
        frameHidden: doc.visibilityState === 'hidden',
      };
      return;
    }
    if (depth >= 4) return;
    for (const frame of doc.querySelectorAll('iframe')) {
      try { if (frame.contentWindow) walkPlayer(frame.contentWindow, depth + 1); } catch { /* cross origin */ }
    }
  };
  walkPlayer(window, 0);

  // 3) Blockers, progress, navigation.
  const blocked = /【9010】|操作异常，请输入|人脸识别|身份核验|请输入验证码|请先登录|登录已失效/.test(bodyText);
  const progress = bodyText.match(/已完成任务点\s*[:：]?\s*(\d+)\s*\/\s*(\d+)/);
  const nextButton = document.getElementById('prevNextFocusNext');
  const params = new URL(location.href).searchParams;
  const chapterId = params.get('chapterId') || params.get('chapterid') || '';

  let pageKind = 'unknown';
  if (/antispiderShowVerify|\/login/i.test(location.pathname)) pageKind = 'verify';
  else if (/\/mycourse\/studentstudy/.test(location.pathname)) pageKind = 'chapter';
  else if (/\/mycourse\/(stu|studentcourse)/.test(location.pathname)) pageKind = 'catalog';
  else if (/\/base|\/space\//.test(location.pathname)) pageKind = 'space';

  return {
    url: location.href,
    title: document.title,
    pageKind,
    chapter: {id: chapterId, name: String(document.querySelector('#curChapterName,.chapterName,select option[selected],select option')?.textContent || document.title || '').trim().slice(0, 80)},
    tasks,
    defaults,
    containerDepth,
    allTasksDone: tasks.length > 0 && tasks.every(task => task.state === 'done'),
    player,
    nextAvailable: Boolean(nextButton && visible(nextButton)),
    progress: progress ? {done: Number(progress[1]), total: Number(progress[2])} : null,
    blocked,
    requiresUser: blocked || pageKind === 'verify' || (pageKind === 'space' && /登录/.test(bodyText)),
    hasAttachmentData: containers.length > 0,
    bodySnippet: bodyText.slice(0, 300),
  };
}

export async function readScene(bridge, tab, {attempts = 3} = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const raw = await bridge.command('eval', `(${probeScene.toString()})()`, '--world', 'MAIN', '--tab', String(tab));
      return JSON.parse(raw);
    } catch (error) {
      lastError = error;
      // 页面正在跳转时注入会超时，等一下再试
      await new Promise(resolve => setTimeout(resolve, 1200 * attempt));
    }
  }
  throw lastError;
}
