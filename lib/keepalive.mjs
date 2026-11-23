// 页面内保活：学习通的播放器在"没有用户活动"几秒后会自己暂停。
// 这个脚本装一个轻量定时器：暂停就继续播，并周期性发一个 mousemove 事件。
// 只在当前页面生命周期内有效，导航后自动消失（下次 play_video 会重新注入）。

export const KEEP_ALIVE_SCRIPT = `(() => {
  if (window.__cxKeepAliveTimer) { clearInterval(window.__cxKeepAliveTimer); window.__cxKeepAliveTimer = null; }
  // 优先盯“未完成任务点”那个卡里的播放器（一章可能有多个视频）。
  const candidates = [];
  const find = (w, depth) => {
    try {
      const doc = w.document;
      for (const video of doc.querySelectorAll('video')) {
        let finishedCard = false;
        try {
          const frame = w.frameElement;
          const card = frame && frame.closest ? frame.closest('.ans-attach-ct') : null;
          finishedCard = Boolean(card && card.classList.contains('ans-job-finished'));
        } catch {}
        candidates.push({video, view: w, finishedCard});
      }
    } catch { return; }
    if (depth >= 4) return;
    try {
      for (const frame of w.document.querySelectorAll('iframe')) {
        try { if (frame.contentWindow) find(frame.contentWindow, depth + 1); } catch {}
      }
    } catch {}
  };
  find(window, 0);
  const chosen = candidates.find(item => !item.finishedCard) || candidates[0] || null;
  if (!chosen) return 'no-video';
  const video = chosen.video;
  const view = chosen.view;
  let ticks = 0;
  window.__cxKeepAliveTimer = setInterval(() => {
    try {
      if (!video.isConnected) { clearInterval(window.__cxKeepAliveTimer); window.__cxKeepAliveTimer = null; return; }
      ticks += 1;
      if (video.paused) {
        video.muted = true;
        video.play().catch(() => {});
        const control = view.document.querySelector('.vjs-play-control');
        if (control && video.paused) control.click();
      }
      if (ticks % 3 === 0) {
        view.document.dispatchEvent(new MouseEvent('mousemove', {bubbles: true, clientX: 200, clientY: 200}));
      }
    } catch { /* 页面切换中 */ }
  }, 2500);
  return 'started';
})()`;