(function submitQuiz(payload) {
  if (!/^mooc1(?:-[a-z0-9]+)?\.chaoxing\.com$/i.test(location.hostname)
      || !/^\/mycourse\/studentstudy\/?$/.test(location.pathname))
    return {ok:false,reason:'当前页不是学习通章节页'};
  const views = [];
  function walk(view, depth) {
    let doc;
    try { doc = view.document; } catch { return; }
    views.push(view);
    if (depth >= 5) return;
    for (const frame of doc.querySelectorAll('iframe'))
      try { if (frame.contentWindow) walk(frame.contentWindow, depth + 1); } catch {}
  }
  walk(window, 0);
  const work = views.flatMap(view => {
    try { return view.AttachmentSetting?.attachments || []; } catch { return []; }
  }).find(item => item?.type === 'workid' && String(item.jobid || '') === payload.jobId);
  if (payload.phase === 'status') return {ok:true,
    completed:work?.job === false || window.__cxV3?.status === 'running'
      || new URL(location.href).searchParams.get('chapterId') !== payload.chapterId};
  const current = JSON.parse(document.getElementById('cx-v3-quiz-report')?.textContent || 'null');
  if (current?.id !== payload.reportId || current.jobId !== payload.jobId
      || window.__cxV3?.status !== 'waiting-quiz')
    return {ok:false,reason:'当前测验与答案不符'};
  if (!work || work.job !== true) return {ok:false,reason:'测验任务不在待完成状态'};
  if (payload.phase === 'open') {
    const view = views.find(item => typeof item.btnBlueSubmit === 'function');
    if (!view) return {ok:false,reason:'页面未找到提交按钮函数'};
    view.btnBlueSubmit();
    return {ok:true,phase:'opened'};
  }
  if (payload.phase === 'confirm') {
    for (const view of views) {
      const button = view.document.getElementById('popok');
      if (button && button.getClientRects().length) {
        button.click();
        return {ok:true,phase:'confirmed'};
      }
    }
    return {ok:false,reason:'未找到可见的提交确认按钮'};
  }
  return {ok:false,reason:'未知提交阶段'};
})
