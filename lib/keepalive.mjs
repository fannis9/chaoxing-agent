// 页面内保活：学习通的播放器在"没有用户活动"几秒后会自己暂停。
// 这个脚本装一个轻量定时器：暂停就继续播，并周期性发一个 mousemove 事件。
// 只在当前页面生命周期内有效，导航后自动消失（下次 play_video 会重新注入）。

export const KEEP_ALIVE_SCRIPT = `(() => {
  if (window.__cxKeepAliveTimer) return 'already';
  let view = null;
  let video = null;
  const find = (w, depth) => {
    try {
      const doc = w.document;
      const element = doc.querySelector('video');
      if (element && !video) { video = element; view = w; return; }
    } catch { return; }
    if (depth >= 4) return;
    try {
      for (const frame of w.document.querySelectorAll('iframe')) {
        try { if (frame.contentWindow) find(frame.contentWindow, depth + 1); } catch {}
      }
    } catch {}
  };
  find(window, 0);
  if (!video) return 'no-video';
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
      // 每 3 次发一次鼠标移动，避免被判定为挂机
      if (ticks % 3 === 0) {
        view.document.dispatchEvent(new MouseEvent('mousemove', {bubbles: true, clientX: 200, clientY: 200}));
      }
    } catch { /* 页面切换中 */ }
  }, 2500);
  return 'started';
})()`;
