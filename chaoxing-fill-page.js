// Evaluated in 浏览器代理 MAIN world. The final expression is called with a JSON payload.
(function fillPage(payload) {
  const fail = reason => ({ok:false, reason});
  if (!/^mooc1(?:-[a-z0-9]+)?\.chaoxing\.com$/i.test(location.hostname)
      || !/^\/mycourse\/studentstudy\/?$/.test(location.pathname)) return fail('当前页不是学习通章节页');
  const params = new URL(location.href).searchParams;
  const report = payload.report;
  if (params.get('courseId') !== report.courseId || params.get('chapterId') !== report.chapterId)
    return fail('课程或章节与报告不符');
  if (window.__cxV3?.status !== 'waiting-quiz') return fail('页面未处于等待测验状态');
  let current;
  try { current = JSON.parse(document.getElementById('cx-v3-quiz-report')?.textContent || 'null'); }
  catch { return fail('页面题目报告无效'); }
  if (current?.id !== report.id || current.jobId !== report.jobId) return fail('当前测验与报告不符');

  const matches = [];
  const works = [];
  function walk(view, depth) {
    let doc;
    try { doc = view.document; } catch { return; }
    try {
      for (const item of view.AttachmentSetting?.attachments || [])
        if (item?.type === 'workid') works.push(item);
    } catch { /* changing frame */ }
    for (const wrapper of doc.querySelectorAll('.singleQuesId[id^="question"]'))
      matches.push({wrapper, view});
    if (depth >= 5) return;
    for (const frame of doc.querySelectorAll('iframe'))
      try { if (frame.contentWindow) walk(frame.contentWindow, depth + 1); } catch { /* other origin */ }
  }
  walk(window, 0);
  if (!works.some(item => String(item.jobid || '') === report.jobId && item.job === true))
    return fail('当前测验任务未确认处于待完成状态');
  const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
  function locate(question) {
    const found = matches.filter(item => item.wrapper.id === `question${question.questionId}`);
    if (found.length !== 1) return {error:'题目控件缺失或重复'};
    const {wrapper, view} = found[0];
    const heading = clean(wrapper.querySelector('.Zy_TItle')?.innerText);
    if (heading !== clean(question.heading)) return {error:'题干与报告不符'};
    return {wrapper, view};
  }
  const questions = payload.mode === 'preflight' ? report.questions : [payload.question];
  const issues = [];
  for (const q of questions) {
    if (!/^\d+$/.test(q.questionId || '')) { issues.push({index:q.index, reason:'缺少题目 ID'}); continue; }
    const found = locate(q);
    if (found.error) { issues.push({index:q.index, reason:found.error}); continue; }
    const {wrapper} = found;
    if (q.control?.kind === 'choice') {
      const labels = [...wrapper.querySelectorAll('.num_option[data]')].map(node => clean(node.textContent));
      if (q.options?.some(option => labels.filter(label => label === clean(option.label)).length !== 1))
        issues.push({index:q.index, reason:'选项映射与报告不符'});
    } else if (['fill', 'editor'].includes(q.control?.kind)) {
      if (!q.control.editors?.length || q.control.editors.some(editor =>
        !/^answer(?:Editor)?\d+$/.test(editor.id) || !wrapper.querySelector(`#${editor.id}`)))
        issues.push({index:q.index, reason:'编辑器映射与报告不符'});
    } else issues.push({index:q.index, reason:'未知题型控件'});
  }
  if (payload.mode === 'preflight') return {ok:issues.length === 0, checked:questions.length, issues};
  if (issues.length) return fail(issues[0].reason);
  const q = payload.question;
  const answer = payload.answer;
  const {wrapper, view} = locate(q);
  if (!Array.isArray(answer.answerValues) || !answer.answerValues.length) return fail('答案为空');
  if (q.control.kind === 'choice') {
    const targetLabels = answer.answerValues.map(value => q.options.find(option => option.value === value)?.label);
    if (targetLabels.some(label => !label) || new Set(targetLabels).size !== targetLabels.length)
      return fail('答案选项不在报告中');
    const spans = [...wrapper.querySelectorAll('.num_option[data]')];
    const selected = span => span.classList.contains('check_answer')
      || span.parentElement?.querySelector('.answerBg[aria-checked="true"], .answerBg.checked, input:checked') != null;
    const expected = [...targetLabels].sort();
    if (payload.mode === 'verify-step') {
      const span = spans.find(item => clean(item.textContent) === payload.clickedLabel);
      const ok = Boolean(span) && selected(span) === targetLabels.includes(payload.clickedLabel);
      return {ok, index:q.index, kind:'choice', reason:ok ? '' : '页面未确认单个选项状态'};
    }
    if (payload.mode === 'verify') {
      const actual = spans.filter(selected).map(span => clean(span.textContent)).sort();
      return {ok:actual.join('|') === expected.join('|'), index:q.index, kind:'choice',
        selected:actual, reason:actual.join('|') === expected.join('|') ? '' : '页面未确认选项状态'};
    }
    for (const span of spans) {
      const want = targetLabels.includes(clean(span.textContent));
      if (selected(span) === want) continue;
      const clickable = span.parentElement;
      if (!clickable) return fail('选项不可点击');
      clickable.click();
      return {ok:true, index:q.index, kind:'choice', clicks:1, clickedLabel:clean(span.textContent)};
    }
    return {ok:true, index:q.index, kind:'choice', clicks:0};
  }
  const editors = q.control.editors;
  if (answer.answerValues.length !== editors.length) return fail('答案数量与编辑器数量不符');
  if (payload.mode === 'verify') {
    const values = editors.map(meta => wrapper.querySelector(`#${meta.id}`)?.value || '');
    const ok = values.every((value, index) => value === answer.answerValues[index]
      || value.includes(escapeText(answer.answerValues[index]).replace(/\n/g, '<br>')));
    return {ok, index:q.index, kind:q.control.kind,
      reason:ok ? '' : '页面编辑器内容未同步'};
  }
  function escapeText(value) { return value.replace(/[&<>"']/g, char =>
    ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[char]));
  }
  const results = [];
  for (const [index, meta] of editors.entries()) {
    const element = wrapper.querySelector(`#${meta.id}`);
    const value = answer.answerValues[index];
    if (element instanceof view.HTMLTextAreaElement && element.getClientRects().length) {
      const setter = Object.getOwnPropertyDescriptor(view.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(element, value);
      element.dispatchEvent(new view.Event('input', {bubbles:true}));
      element.dispatchEvent(new view.Event('change', {bubbles:true}));
      element.dispatchEvent(new view.Event('blur', {bubbles:true}));
      results.push({id:meta.id, method:'textarea', ok:element.value === value});
    } else {
      let ue;
      try { ue = view.UE?.getEditor?.(meta.id); } catch { /* editor not ready */ }
      if (ue?.isReady && typeof ue.setContent === 'function' && typeof ue.sync === 'function') {
        ue.setContent(`<p>${escapeText(value).replace(/\n/g, '<br>')}</p>`);
        ue.sync();
        results.push({id:meta.id, method:'UEditor', ok:true});
      } else results.push({id:meta.id, method:'unsupported', ok:false});
    }
  }
  const save = wrapper.ownerDocument.getElementById(`save_${q.questionId}`);
  if (results.every(item => item.ok) && save) save.click();
  return {ok:results.every(item => item.ok), index:q.index, kind:q.control.kind,
    editors:results, saved:Boolean(save && results.every(item => item.ok)),
    reason:results.every(item => item.ok) ? '' : '编辑器未就绪或不支持'};
})
