// 学习通的平台特化探针。
// 任务发现按 OCS.js 的思路：遍历 .ans-attach-ct 的任务 iframe，用 DOM 特征判断类型，
// 再用 iframe data 里的 jobid/mid 回查附件拿任务点状态。附件类型只作兜底。
// readTasks 会被序列化进页面执行（不能引用模块外变量）。

export function readTasks() {
  const visible = element => Boolean(element?.isConnected && element.getClientRects().length);

  // ---------- 1) 附件元数据（jobid / job / isPassed / mid） ----------
  const containers = [];
  const walkFrames = (view, depth) => {
    let doc;
    try { doc = view.document; } catch { return; }
    try {
      const setting = view.AttachmentSetting;
      if (setting && Array.isArray(setting.attachments)) containers.push({view, setting, depth});
    } catch { /* 这一帧没有附件数据 */ }
    if (depth >= 4) return;
    for (const frame of doc.querySelectorAll('iframe')) {
      if (!visible(frame)) continue;
      try { if (frame.contentWindow) walkFrames(frame.contentWindow, depth + 1); } catch { /* 跨域 */ }
    }
  };
  walkFrames(window, 0);

  let defaults = null;
  let containerDepth = null;
  const attachments = [];
  if (containers.length) {
    containers.sort((a, b) => b.depth - a.depth);
    const selected = containers[0];
    containerDepth = selected.depth;
    try { defaults = {...(selected.setting.defaults || {})}; } catch { defaults = null; }
    for (const item of selected.setting.attachments) {
      const topJobId = String(item?.jobid || '');
      const id = topJobId || String(item?.property?._jobid || '');
      const mid = String(item?.property?.mid || '');
      // 任务点判定：job === true，或附件自己带顶层 jobid；
      // 知识拓展/资料类通常 job 缺失且顶层 jobid 为空（只有 property._jobid）。
      const required = item?.job === true || Boolean(topJobId);
      let domFinished = false;
      try {
        const node = id
          ? [...selected.view.document.querySelectorAll(`[jobid="${id}"]`)].find(Boolean)
          : null;
        domFinished = Boolean(node?.closest('.ans-attach-ct')?.classList.contains('ans-job-finished'));
      } catch { /* 页面重绘 */ }
      const done = domFinished || item?.isPassed === true;
      attachments.push({
        index: attachments.length, id, mid, required,
        type: String(item?.type || ''), job: Boolean(item?.job),
        passed: item?.isPassed, domFinished, token: String(item?.jtoken || ''),
        state: done ? 'done' : 'pending',
      });
    }
  }
  const byJobId = new Map();
  const byMid = new Map();
  for (const item of attachments) {
    if (item.id) byJobId.set(item.id, item);
    if (item.mid) byMid.set(item.mid, item);
  }

  // ---------- 2) 任务 iframe：按 DOM 特征分类 ----------
  const SIGNATURES = [
    ['videojs', '#video,#audio'],
    ['chapterTest', '.TiMu'],
    ['read', '#img.imglook'],
    ['pptWithAudio', '.swiper-container'],
    ['hyperlink', '#hyperlink'],
    ['timereader', 'iframe[name="bookifame"][src*="timing"]'],
  ];
  const classify = (doc, depth) => {
    if (!doc || depth > 3) return null;
    for (const [name, selector] of SIGNATURES) {
      try { if (doc.querySelector(selector)) return name; } catch { /* 选择器不支持 */ }
    }
    let found = null;
    try {
      for (const frame of doc.querySelectorAll('iframe')) {
        if (found) break;
        try { if (frame.contentDocument) found = classify(frame.contentDocument, depth + 1); } catch { /* 跨域 */ }
      }
    } catch { /* ignore */ }
    return found;
  };

  const jobs = [];
  const seen = new Set();
  const walkCards = (view, depth) => {
    let doc;
    try { doc = view.document; } catch { return; }
    let cards = [];
    try { cards = [...doc.querySelectorAll('.ans-attach-ct')]; } catch { cards = []; }
    for (const card of cards) {
      const frame = card.querySelector('iframe');
      let data = {};
      try { data = JSON.parse(frame?.getAttribute('data') || '{}'); } catch { data = {}; }
      const id = String(data.jobid || data._jobid || '');
      const mid = String(data.mid || '');
      const key = mid || id;
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      let signature = null;
      try { if (frame?.contentDocument) signature = classify(frame.contentDocument, 0); } catch { /* 跨域 */ }
      const attachment = (id && byJobId.get(id)) || (mid && byMid.get(mid)) || null;
      const domFinished = /ans-job-finished/.test(String(card.className || ''));
      const done = domFinished || attachment?.passed === true;
      jobs.push({
        index: jobs.length,
        id: id || attachment?.id || '',
        mid,
        signature,
        type: signature || attachment?.type || '',
        required: attachment ? attachment.job === true : true,
        state: done ? 'done' : 'pending',
        token: attachment?.token || '',
        href: String(data.href || data.linkUrl || data._href || ''),
      });
    }
    if (depth >= 3) return;
    for (const frame of doc.querySelectorAll('iframe')) {
      try { if (frame.contentWindow) walkCards(frame.contentWindow, depth + 1); } catch { /* 跨域 */ }
    }
  };
  walkCards(window, 0);

  // 3) 兜底：页面没有 .ans-attach-ct 时用附件列表
  const tasks = jobs.length ? jobs : attachments;
  const nextButton = document.getElementById('prevNextFocusNext');

  // 视频弹题：播放中弹出的选择题，不答完不会继续播。
  let popup = null;
  const popupRoot = ['.ans-videoquiz', '[class*="videoquiz"]', '[id*="videoquiz"]', '.videoquiz-container']
    .map(selector => document.querySelector(selector))
    .find(node => node && node.getClientRects().length);
  if (popupRoot) {
    const options = [...popupRoot.querySelectorAll('li,label,.option,[class*="option"],[class*="item"]')]
      .filter(node => node.getClientRects().length && String(node.innerText || '').trim())
      .map(node => String(node.innerText || '').replace(/\s+/g, ' ').trim())
      .filter((value, index, all) => all.indexOf(value) === index)
      .slice(0, 8);
    popup = {
      present: true,
      text: String(popupRoot.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 400),
      options,
    };
  }

  return {
    tasks,
    defaults,
    containerDepth,
    nextAvailable: Boolean(nextButton && visible(nextButton)),
    popup,
  };
}

/** 页面类型（Node 侧，看 URL）。 */
export function pageKind(url) {
  try {
    if (/detect\.chaoxing\.com|monitor_temp/.test(url)) return 'verify';
    const path = new URL(url).pathname;
    if (/antispiderShowVerify|\/login/i.test(path)) return 'verify';
    if (/\/mycourse\/studentstudy/.test(path)) return 'chapter';
    if (/\/mycourse\/(stu|studentcourse)/.test(path)) return 'catalog';
    if (/\/base|\/space\//.test(path)) return 'space';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

/** 章节 id（Node 侧，看 URL 参数）。 */
export function chapterId(url) {
  try {
    const params = new URL(url).searchParams;
    return params.get('chapterId') || params.get('chapterid') || '';
  } catch {
    return '';
  }
}
