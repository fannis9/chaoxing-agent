// 通用场景探针：只采集与平台无关的信号（URL、播放器、拦截提示、任务容器），
// 平台特有的任务解析通过 readTasks（页面内函数）注入，页面类型通过 platform.pageKind 在 Node 侧判定。
//
// 这个函数会被 toString() 后注入页面执行，所以不能引用模块外的任何变量。

export function probeScene(readTasks) {
  const visible = element => Boolean(element?.isConnected && element.getClientRects().length);
  const texts = [];
  const walk = (view, depth) => {
    let doc;
    try { doc = view.document; } catch { return; }
    try { texts.push((doc.body?.innerText || '').replace(/\s+/g, ' ')); } catch { /* frame changing */ }
    if (depth >= 4) return;
    for (const frame of doc.querySelectorAll('iframe')) {
      if (!visible(frame)) continue;
      try { if (frame.contentWindow) walk(frame.contentWindow, depth + 1); } catch { /* cross origin */ }
    }
  };
  walk(window, 0);
  const bodyText = texts.join(' ');

  // 平台注入的任务读取器：自己决定去哪里找任务、怎么判断完成。
  let extras = {tasks: [], defaults: null, containerDepth: null, nextAvailable: null, progress: null, chapterName: null, popup: null};
  if (typeof readTasks === 'function') {
    try {
      const result = readTasks() || {};
      extras = {
        tasks: Array.isArray(result.tasks) ? result.tasks : [],
        defaults: result.defaults ?? null,
        containerDepth: result.containerDepth ?? null,
        nextAvailable: result.nextAvailable ?? null,
        progress: result.progress ?? null,
        chapterName: result.chapterName ?? null,
        popup: result.popup ?? null,
      };
    } catch (error) {
      extras.readError = String(error && error.message || error).slice(0, 160);
    }
  }

  // 播放器状态（可能嵌在多层 iframe 里）——所有平台通用。
  // 一章可能有多个视频：优先取“未完成任务点”那个卡里的播放器。
  const candidates = [];
  const walkPlayer = (view, depth) => {
    let doc;
    try { doc = view.document; } catch { return; }
    for (const video of doc.querySelectorAll('video')) {
      let finishedCard = false;
      try { finishedCard = Boolean(video.closest('.ans-attach-ct')?.classList.contains('ans-job-finished')); } catch { /* 非学习通结构 */ }
      let videojs = false;
      try { videojs = Boolean(view.videojs?.getPlayers?.() && Object.keys(view.videojs.getPlayers()).length); } catch { /* plain element */ }
      candidates.push({
        finishedCard,
        state: {
          present: true,
          readyState: video.readyState,
          paused: video.paused,
          duration: Number.isFinite(video.duration) ? Math.round(video.duration) : null,
          currentTime: Math.round(video.currentTime),
          rate: video.playbackRate,
          videojs,
          frameHidden: doc.visibilityState === 'hidden',
        },
      });
    }
    if (depth >= 4) return;
    for (const frame of doc.querySelectorAll('iframe')) {
      try { if (frame.contentWindow) walkPlayer(frame.contentWindow, depth + 1); } catch { /* cross origin */ }
    }
  };
  walkPlayer(window, 0);
  const chosen = candidates.find(item => !item.finishedCard) || candidates[0] || null;
  const player = chosen ? chosen.state : null;

  // 反爬/登录拦截：措辞各家不同，这里用最常见的几组关键词。
  const blocked = /验证码|人脸识别|身份核验|请先登录|登录已失效|操作异常|【9010】|滑动验证|安全验证/.test(bodyText);
  const progress = extras.progress
    || (() => {
      const match = bodyText.match(/已完成任务点\s*[:：]?\s*(\d+)\s*\/\s*(\d+)/);
      return match ? {done: Number(match[1]), total: Number(match[2])} : null;
    })();

  const params = new URL(location.href).searchParams;
  const chapterId = params.get('chapterId') || params.get('chapterid') || params.get('knowledgeId') || '';

  return {
    url: location.href,
    title: document.title,
    pageKind: 'unknown',          // 由 Node 侧的 platform.pageKind 覆盖
    chapter: {
      id: chapterId,
      name: String(extras.chapterName || document.querySelector('#curChapterName,.chapterName,select option[selected],select option')?.textContent || document.title || '').trim().slice(0, 80),
    },
    tasks: extras.tasks,
    defaults: extras.defaults,
    containerDepth: extras.containerDepth,
    allTasksDone: extras.tasks.filter(task => task.required !== false).length > 0
      && extras.tasks.every(task => task.required === false || task.state === 'done'),
    emptyContent: /暂无内容|暂无任务|没有内容|无学习内容/.test(bodyText),
    player,
    tabHidden: document.visibilityState === 'hidden',
    nextAvailable: Boolean(extras.nextAvailable),
    popup: extras.popup,
    progress,
    blocked,
    requiresUser: blocked,
    readError: extras.readError || null,
    bodySnippet: bodyText.slice(0, 300),
  };
}

export async function readScene(bridge, tab, platform, {attempts = 3} = {}) {
  const reader = platform?.readTasks ? platform.readTasks.toString() : 'null';
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const raw = await bridge.command('eval', `(${probeScene.toString()})(${reader})`, '--world', 'MAIN', '--tab', String(tab));
      const scene = JSON.parse(raw);
      if (platform) {
        scene.pageKind = platform.pageKind(scene.url) || scene.pageKind;
        scene.chapter.id = platform.chapterId?.(scene.url) || scene.chapter.id;
        scene.requiresUser = scene.blocked || scene.pageKind === 'verify';
      }
      return scene;
    } catch (error) {
      lastError = error;
      // 页面正在跳转时注入会超时，等一下再试
      await new Promise(resolve => setTimeout(resolve, 1200 * attempt));
    }
  }
  throw lastError;
}
