// 学习通的平台特化探针。
// readTasks 会被序列化进页面执行（不能引用模块外变量）；pageKind / chapterId 在 Node 侧使用。

/** 页面内：从 window.AttachmentSetting 读取任务点 + 判断“下一节”是否可用。 */
export function readTasks() {
  const visible = element => Boolean(element?.isConnected && element.getClientRects().length);
  const containers = [];
  const walk = (view, depth) => {
    let doc;
    try { doc = view.document; } catch { return; }
    try {
      const setting = view.AttachmentSetting;
      if (setting && Array.isArray(setting.attachments)) containers.push({view, setting, depth});
    } catch { /* 这一帧没有附件数据 */ }
    if (depth >= 4) return;
    for (const frame of doc.querySelectorAll('iframe')) {
      if (!visible(frame)) continue;
      try { if (frame.contentWindow) walk(frame.contentWindow, depth + 1); } catch { /* 跨域 */ }
    }
  };
  walk(window, 0);

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
      } catch { /* 页面重绘 */ }
      const done = domFinished || item?.isPassed === true;
      return {
        index, id, type: String(item?.type || ''), job: Boolean(item?.job),
        passed: item?.isPassed, domFinished, token: String(item?.jtoken || ''),
        state: done ? 'done' : 'pending',
      };
    });
  }

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

  const nextButton = document.getElementById('prevNextFocusNext');
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
