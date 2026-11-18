/*
 * 学习通章节助手 v3 — 单页面、串行、确认完成后再切节。
 * 在本人获准使用自动化的课程页面中，从 Console 粘贴运行。
 * 停止：window.__cxV3.stop()
 * 状态：window.__cxV3.status / .log / .completed
 * 测验只上报并等待平台完成，不自动作答；验证码、人脸识别和未知任务会停下。
 * 不保存账号凭据，不调用第三方服务，不构造视频进度上报请求。
 */
(() => {
  'use strict';

  const KEY = '__cxV3';
  if (window[KEY]?.active) {
    console.warn('[cx-v3] 已有实例运行；使用 window.__cxV3.stop() 停止。');
    return;
  }
  if (document.getElementById('cxlogbox')) {
    console.warn('[cx-v3] 检测到旧版日志框；请先停止旧脚本并刷新页面，再启动 v3。');
    return;
  }
  if (!/^mooc1(?:-[a-z0-9]+)?\.chaoxing\.com$/i.test(location.hostname)
      || !/^\/mycourse\/studentstudy\/?$/.test(location.pathname)) {
    console.warn('[cx-v3] 请在 mooc1 的章节学习页启动。');
    return;
  }
  document.getElementById('cx-v3-quiz-report')?.remove();

  const CFG = Object.freeze({
    rate: 2,
    volume: 0.02,
    pollMs: 3000,
    tabSettleMs: 1200,
    nextSettleMs: 1200,
    verifyMs: 12000,
    maxChapters: 1,
  });
  const abort = new AbortController();
  const signal = abort.signal;
  const courseId = new URL(location.href).searchParams.get('courseId') || '';
  const schedule = window.__cxV3Schedule;
  const finalChapterId = schedule?.courseId === courseId && /^\d+$/.test(String(schedule.finalChapterId || ''))
    ? String(schedule.finalChapterId) : '';
  let prior = null;
  try {
    const saved = JSON.parse(sessionStorage.getItem('cx-v3-runtime') || 'null');
    if (saved?.courseId === courseId && Array.isArray(saved.completed)) prior = saved;
  } catch { /* old or invalid checkpoint */ }
  const state = {
    active: true,
    status: 'starting',
    runId: prior?.runId || crypto.randomUUID(),
    log: [],
    completed: prior?.completed.slice(-400) || [],
    report: null,
    video: null,
    incident: null,
    stop() {
      if (!signal.aborted) abort.abort();
      setStatus('stopping');
    },
  };
  window[KEY] = state;

  const box = document.createElement('div');
  box.id = 'cx-v3-logbox';
  box.style.cssText = 'position:fixed;left:0;bottom:0;z-index:2147483647;width:440px;max-height:180px;overflow:auto;padding:6px;background:rgba(0,0,0,.88);color:#a5f3a5;font:11px/1.5 monospace';
  const stopButton = document.createElement('button');
  stopButton.textContent = '停止';
  stopButton.style.cssText = 'float:right;color:#111;background:#a5f3a5;border:0;padding:2px 8px;cursor:pointer';
  stopButton.onclick = () => state.stop();
  box.appendChild(stopButton);
  document.body.appendChild(box);
  box.dataset.status = state.status;
  box.dataset.active = 'true';
  const statusNode = document.createElement('script');
  statusNode.id = 'cx-v3-status';
  statusNode.type = 'application/json';
  document.getElementById(statusNode.id)?.remove();
  document.body.appendChild(statusNode);
  const persist = () => {
    const params = new URL(location.href).searchParams;
    const record = {
      schemaVersion:1, runId:state.runId, courseId,
      chapterId:params.get('chapterId') || '', status:state.status, active:state.active,
      completed:state.completed.slice(-400), video:state.video, incident:state.incident,
      lastLog:state.log.slice(-12), updatedAt:new Date().toISOString(),
    };
    statusNode.textContent = JSON.stringify(record);
    try { sessionStorage.setItem('cx-v3-runtime', statusNode.textContent); } catch { /* storage unavailable */ }
  };
  const setStatus = value => { state.status = value; box.dataset.status = value; persist(); };
  persist();

  const log = message => {
    const line = `${new Date().toLocaleTimeString('zh-CN', {hour12:false})} ${message}`;
    state.log.push(line);
    if (state.log.length > 300) state.log.shift();
    const row = document.createElement('div');
    row.textContent = line;
    box.appendChild(row);
    while (box.children.length > 101) box.children[1].remove();
    box.scrollTop = box.scrollHeight;
    console.log('[cx-v3]', message);
    persist();
  };
  const stopped = () => signal.aborted || window[KEY] !== state;
  const assertActive = () => {
    if (stopped()) throw new Error('已停止');
    if (/antispiderShowVerify|\/space\/index|\/login/i.test(location.href)
        || /【9010】|操作异常，请输入|人脸识别|身份核验/.test(document.body?.innerText || '')) {
      throw new Error('页面要求验证或登录，已停止并等待人工处理');
    }
  };
  const wait = ms => new Promise((resolve, reject) => {
    if (stopped()) return reject(new Error('已停止'));
    const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(timer); reject(new Error('已停止')); };
    signal.addEventListener('abort', onAbort, {once:true});
  });
  const visible = element => Boolean(element?.isConnected && element.getClientRects().length
    && element.ownerDocument.defaultView.getComputedStyle(element).visibility !== 'hidden');

  function settingsSnapshot() {
    const found = [];
    const walk = (view, depth) => {
      let doc;
      try { doc = view.document; } catch { return; }
      try {
        const setting = view.AttachmentSetting;
        if (setting && Array.isArray(setting.attachments)) found.push({view, setting, depth});
      } catch { /* frame may be changing */ }
      if (depth >= 4) return;
      for (const frame of doc.querySelectorAll('iframe')) {
        if (!visible(frame)) continue;
        try { if (frame.contentWindow) walk(frame.contentWindow, depth + 1); } catch { /* cross origin */ }
      }
    };
    walk(window, 0);
    if (!found.length) return null;
    found.sort((a, b) => b.depth - a.depth);
    if (found.length > 1 && found[0].depth === found[1].depth) throw new Error('多个可见任务容器，无法确定当前任务');
    const selected = found[0];
    const items = selected.setting.attachments.map((item, index) => {
      const id = String(item?.jobid || '');
      const taskNode = [...selected.view.document.querySelectorAll('[jobid]')]
        .find(node => node.getAttribute('jobid') === id)?.closest('.ans-attach-ct');
      return {
        index,
        id,
        type: String(item?.type || ''),
        job: item?.job,
        isPassed: item?.isPassed,
        domFinished: taskNode?.classList.contains('ans-job-finished'),
        token: item?.jtoken,
      };
    });
    const defaults = selected.setting.defaults || {};
    let frameURL = '';
    try { frameURL = selected.view.frameElement?.getAttribute('src') || ''; } catch { /* root setting */ }
    return {view:selected.view, items, defaults, frameURL};
  }

  const itemStatus = item => {
    if (!item) return 'missing';
    if (item.job === true) return item.domFinished === true ? 'unknown' : 'pending';
    if (item.job === false || item.domFinished === true) return 'complete';
    if (item.isPassed === true && item.domFinished !== false) return 'complete';
    return 'unknown';
  };
  const taskSignature = snapshot => `${snapshot.frameURL}|${snapshot.items.map(item => item.id).join(',')}`;
  const currentItem = (id, snapshot = settingsSnapshot()) => snapshot?.items.find(item => item.id === id);

  async function selectTab(tab, previousSignature, requireChange) {
    assertActive();
    if (!tab?.isConnected) throw new Error('任务标签已变化');
    tab.click();
    await wait(CFG.tabSettleMs);
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      assertActive();
      const snapshot = settingsSnapshot();
      if (snapshot?.items.length && (!requireChange || taskSignature(snapshot) !== previousSignature)) return snapshot;
      await wait(500);
    }
    throw new Error('任务标签切换后，未确认新的任务容器');
  }

  async function verifyItem(id, tab) {
    const deadline = Date.now() + CFG.verifyMs;
    while (Date.now() < deadline) {
      assertActive();
      const item = currentItem(id);
      if (itemStatus(item) === 'complete') return true;
      await wait(1000);
    }
    // 只重开当前标签一次，让平台自身刷新状态；不会重发完成请求。
    await selectTab(tab, '', false);
    const refreshed = Date.now() + CFG.verifyMs;
    while (Date.now() < refreshed) {
      assertActive();
      const item = currentItem(id);
      if (itemStatus(item) === 'complete') return true;
      await wait(1000);
    }
    return false;
  }

  async function handleDocument(item, snapshot, tab) {
    const {knowledgeid, courseid, clazzId} = snapshot.defaults;
    if (![item.id, knowledgeid, courseid, clazzId, item.token].every(value => value != null && String(value)))
      throw new Error('文档任务参数不完整');
    const url = new URL('/mooc-ans/job/document', location.origin);
    const params = {jobid:item.id, knowledgeid, courseid, clazzid:clazzId,
      jtoken:item.token, checkMicroTopic:'true', microTopicId:'', courseEngineInfo:'false'};
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
    const response = await fetch(url, {credentials:'include', redirect:'error', cache:'no-store', signal});
    if (!response.ok) throw new Error(`文档接口返回 HTTP ${response.status}`);
    let result;
    try { result = await response.json(); } catch { throw new Error('文档接口没有返回 JSON'); }
    if (result?.status !== true) throw new Error('文档接口未确认成功');
    if (!await verifyItem(item.id, tab)) throw new Error('文档接口已响应，但平台未显示完成');
  }

  function activeVideos(view) {
    const found = [];
    const walk = (current, depth) => {
      let doc;
      try { doc = current.document; } catch { return; }
      for (const video of doc.querySelectorAll('video')) if (visible(video)) found.push(video);
      if (depth >= 4) return;
      for (const frame of doc.querySelectorAll('iframe')) {
        if (!visible(frame)) continue;
        try { if (frame.contentWindow) walk(frame.contentWindow, depth + 1); } catch { /* cross origin */ }
      }
    };
    walk(view, 0);
    return found;
  }
  function clickVisiblePlay(view) {
    const walk = (current, depth) => {
      let doc;
      try { doc = current.document; } catch { return false; }
      const button = [...doc.querySelectorAll('.vjs-big-play-button')].find(visible);
      if (button) { button.click(); return true; }
      if (depth >= 4) return false;
      for (const frame of doc.querySelectorAll('iframe')) {
        if (!visible(frame)) continue;
        try { if (frame.contentWindow && walk(frame.contentWindow, depth + 1)) return true; } catch { /* cross origin */ }
      }
      return false;
    };
    return walk(view, 0);
  }
  async function findVideo(view) {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      assertActive();
      const videos = activeVideos(view).filter(video => Number.isFinite(video.duration) && video.duration > 0);
      if (videos.length > 1) throw new Error('多个可见播放器，无法确定当前视频');
      if (videos.length === 1) return videos[0];
      clickVisiblePlay(view);
      await wait(1500);
    }
    throw new Error('未找到可播放的视频');
  }

  async function handleVideo(item, snapshot, tab) {
    let video = await findVideo(snapshot.view);
    const duration = video.duration;
    const deadline = Date.now() + Math.min(90 * 60 * 1000, duration * 800 + 180000);
    let endedAt = 0;
    let lastProgressAt = Date.now();
    let lastTime = video.currentTime;
    while (Date.now() < deadline) {
      assertActive();
      if (itemStatus(currentItem(item.id)) === 'complete') {
        state.video = null;
        persist();
        return;
      }
      const videos = activeVideos(snapshot.view);
      if (videos.length !== 1) throw new Error('视频播放器已变化或不再唯一');
      video = videos[0];
      if (video.currentTime > lastTime + 0.5) {
        lastTime = video.currentTime;
        lastProgressAt = Date.now();
      }
      state.video = {jobId:item.id, time:Math.floor(video.currentTime),
        duration:Math.floor(video.duration), rate:video.playbackRate, updatedAt:new Date().toISOString()};
      persist();
      if (!video.ended && Date.now() - lastProgressAt > 90000)
        throw new Error('视频连续 90 秒无进展，已停止等待人工检查');
      if (video.ended || video.currentTime >= video.duration - 1) {
        if (!endedAt) endedAt = Date.now();
        if (Date.now() - endedAt >= 12000) break;
      } else {
        if (video.muted) video.muted = false;
        if (Math.abs(video.volume - CFG.volume) > 0.01) video.volume = CFG.volume;
        if (Math.abs(video.playbackRate - CFG.rate) > 0.05) video.playbackRate = CFG.rate;
        if (video.paused) video.play().catch(() => {});
      }
      await wait(CFG.pollMs);
    }
    if (!await verifyItem(item.id, tab)) throw new Error('视频已播放或等待超时，但平台未显示完成');
    state.video = null;
    persist();
  }

  function chapterFingerprint() {
    const frame = [...document.querySelectorAll('iframe[src*="/knowledge/cards"]')].find(visible);
    const next = document.getElementById('prevNextFocusNext');
    const marker = frame?.getAttribute('src') || next?.getAttribute('onclick') || '';
    if (!marker) throw new Error('无法确认当前章节身份');
    return marker;
  }
  function nextButton() {
    const primary = document.getElementById('prevNextFocusNext');
    if (visible(primary) && /PCount\.next/.test(primary.getAttribute('onclick') || '')) return primary;
    const candidates = [...document.querySelectorAll('[onclick*="PCount.next"]')].filter(visible);
    if (candidates.length !== 1) throw new Error('下一节按钮不存在或不唯一');
    return candidates[0];
  }
  async function moveNext(before) {
    assertActive();
    nextButton().click();
    await wait(CFG.nextSettleMs);
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      assertActive();
      try { if (chapterFingerprint() !== before) return; } catch { /* page transitioning */ }
      await wait(500);
    }
    throw new Error('点击下一节后未确认章节身份变化');
  }

  function quizSources() {
    let work = null;
    let quizDocument = null;
    const walk = (view, depth) => {
      let doc;
      try { doc = view.document; } catch { return; }
      try {
        const candidate = view.AttachmentSetting?.attachments?.find(item => item?.type === 'workid');
        if (candidate) {
          const id = String(candidate.jobid || '');
          const taskNode = [...doc.querySelectorAll('[jobid]')]
            .find(node => node.getAttribute('jobid') === id)?.closest('.ans-attach-ct');
          work = {id, job:candidate.job, isPassed:candidate.isPassed,
            domFinished:taskNode?.classList.contains('ans-job-finished')};
        }
        if (doc.querySelector('.TiMu.newTiMu')) quizDocument = doc;
      } catch { /* frame may be changing */ }
      if (depth >= 5) return;
      for (const frame of doc.querySelectorAll('iframe')) {
        try { if (frame.contentWindow) walk(frame.contentWindow, depth + 1); } catch { /* cross origin */ }
      }
    };
    walk(window, 0);
    return {work, quizDocument};
  }

  async function captureQuiz() {
    const deadline = Date.now() + 15000;
    let sources;
    do {
      assertActive();
      sources = quizSources();
      if (sources.work && sources.quizDocument) break;
      await wait(500);
    } while (Date.now() < deadline);
    if (!sources.work) return null;
    if (!sources.quizDocument) throw new Error('测验题目 iframe 在 60 秒内未加载，无法交给模型解答');
    const doc = sources.quizDocument;
    const params = new URL(location.href).searchParams;
    let imageBudget = 2_000_000;
    const questions = doc ? [...doc.querySelectorAll('.TiMu.newTiMu')].slice(0, 100).map((node, index) => {
      const heading = node.querySelector('.Zy_TItle')?.innerText.trim() || '';
      const wrapper = node.closest('.singleQuesId');
      const questionId = /^question(\d+)$/.exec(wrapper?.id || '')?.[1] || '';
      const answerField = questionId ? wrapper?.querySelector(`#answer${questionId}`) : null;
      const answerType = questionId
        ? wrapper?.querySelector(`#answertype${questionId}`)?.value || '' : '';
      const editors = [...(wrapper?.querySelectorAll('textarea[id]') || [])]
        .filter(editor => /^answer(?:Editor)?\d+$/.test(editor.id))
        .map(editor => ({id:editor.id,
          name:/^answer(?:Editor)?\d+$/.test(editor.name || '') ? editor.name : ''}));
      const blankCount = Number(wrapper?.querySelector('input[name^="tiankongsize"]')?.value || 0);
      const options = [...node.querySelectorAll('.Zy_ulTop li')].map(option => {
        const marker = option.querySelector('.num_option');
        return {
          label:marker?.innerText.trim() || '',
          value:marker?.getAttribute('data') || '',
          text:option.innerText.replace(/^[A-Z]\s*/, '').trim().slice(0, 4000),
        };
      });
      const images = [...node.querySelectorAll('img')].map(img => {
        try {
          const url = new URL(img.currentSrc || img.src, doc.baseURI);
          let dataUrl = '';
          if (img.complete && img.naturalWidth && img.naturalHeight
              && img.naturalWidth * img.naturalHeight <= 4_000_000 && imageBudget > 0) {
            try {
              const canvas = doc.createElement('canvas');
              canvas.width = img.naturalWidth;
              canvas.height = img.naturalHeight;
              canvas.getContext('2d').drawImage(img, 0, 0);
              const encoded = canvas.toDataURL('image/png');
              if (encoded.length <= imageBudget) {
                dataUrl = encoded;
                imageBudget -= encoded.length;
              }
            } catch { /* cross-origin image: keep only its path */ }
          }
          return {path:url.protocol === 'data:' ? '' : `${url.origin}${url.pathname}`,
            alt:img.alt || '', dataUrl};
        } catch { return null; }
      }).filter(Boolean);
      const controlKind = options.length ? 'choice' : blankCount ? 'fill'
        : editors.length ? 'editor' : 'unknown';
      const captureIssues = [];
      if (!questionId) captureIssues.push('question-id-missing');
      if (controlKind === 'choice' && (!answerField?.id || options.some(option => !option.value)))
        captureIssues.push('choice-mapping-incomplete');
      if (controlKind === 'fill' && editors.length !== blankCount)
        captureIssues.push('blank-editor-count-mismatch');
      if (images.some(img => !img.dataUrl)) captureIssues.push('image-not-embedded');
      return {
        index:index + 1,
        questionId,
        type:heading.match(/【([^】]+)】/)?.[1] || '',
        heading:heading.slice(0, 10000),
        text:node.innerText.trim().slice(0, 16000),
        options,
        control:{kind:controlKind, answerType, answerFieldId:answerField?.id || '',
          editors, blankCount:Number.isSafeInteger(blankCount) && blankCount > 0 ? blankCount : 0},
        captureIssues,
        images,
        fontObfuscated:Boolean(node.querySelector('.font-cxsecret')),
      };
    }) : [];
    let fontDataUrl = '';
    if (doc) {
      for (const sheet of doc.styleSheets) {
        let rules;
        try { rules = sheet.cssRules; } catch { continue; }
        for (const rule of rules) {
          if (!rule.cssText?.includes('font-cxsecret')) continue;
          const match = rule.cssText.match(/data:application\/font-[^"')\s]+;base64,[A-Za-z0-9+/=]+/);
          if (match) { fontDataUrl = match[0]; break; }
        }
        if (fontDataUrl) break;
      }
    }
    if (!fontDataUrl)
      for (const question of questions)
        if (question.fontObfuscated) question.captureIssues.push('font-unavailable');
    return {
      schemaVersion:1,
      kind:'quiz',
      createdAt:new Date().toISOString(),
      id:[params.get('courseId'), params.get('chapterId'), sources.work.id].join(':'),
      courseId:params.get('courseId') || '',
      clazzId:params.get('clazzid') || '',
      chapterId:params.get('chapterId') || '',
      jobId:sources.work.id,
      title:doc?.querySelector('.TestTitle_name')?.innerText.trim() || '章节测验',
      questionCount:questions.length,
      questions,
      fontDataUrl,
      captureNote:doc ? '' : '题目 iframe 未加载；请在控制端查看当前页面',
    };
  }

  async function reportQuiz() {
    const report = await captureQuiz();
    if (!report) return false;
    state.report = report;
    document.getElementById('cx-v3-quiz-report')?.remove();
    const data = document.createElement('script');
    data.id = 'cx-v3-quiz-report';
    data.type = 'application/json';
    data.textContent = JSON.stringify(report);
    document.body.appendChild(data);
    setStatus('waiting-quiz');
    log(`检测到测验：${report.questionCount} 题；已生成控制端报告，等待答题处理`);
    return true;
  }

  async function waitForQuizCompletion(id, chapterId) {
    let confirmedAt = 0;
    while (true) {
      assertActive();
      const currentChapter = new URL(location.href).searchParams.get('chapterId') || '';
      if (currentChapter !== chapterId) throw new Error('测验等待期间章节已变化，请在当前页重新启动');
      const work = quizSources().work;
      const complete = work?.id === id && itemStatus(work) === 'complete';
      if (complete) {
        if (!confirmedAt) confirmedAt = Date.now();
        if (Date.now() - confirmedAt >= 2000) {
          document.getElementById('cx-v3-quiz-report')?.remove();
          state.report = null;
          setStatus('running');
          log('测验已由平台确认完成，恢复章节流程');
          return;
        }
      } else confirmedAt = 0;
      await wait(1000);
    }
  }

  async function finishChapter(chapter, taskCount) {
    const chapterId = new URL(location.href).searchParams.get('chapterId') || '';
    if (!state.completed.some(entry => entry.chapterId === chapterId))
      state.completed.push({courseId, chapterId, at:new Date().toISOString(), tasks:taskCount});
    persist();
    log(`本章 ${taskCount} 个任务均已确认`);
    if (finalChapterId && chapterId === finalChapterId) {
      log('已到课程目录最后任务章节，等待控制端核对课程总进度');
      setStatus('course-boundary');
      return false;
    }
    if (chapter + 1 >= CFG.maxChapters) {
      log('达到章节上限，已停止；没有点击下一节');
      setStatus('limit');
      return false;
    }
    log('准备进入下一节');
    const before = chapterFingerprint();
    await moveNext(before);
    return true;
  }

  async function run() {
    setStatus('running');
    log('START v3；只处理当前课程，确认平台完成后切节');
    for (let chapter = 0; chapter < CFG.maxChapters; chapter++) {
      assertActive();
      const tabs = [...document.querySelectorAll('li[id^="dct"]')].filter(visible);
      if (!tabs.length) {
        const work = quizSources().work;
        if (!work?.id) {
          const snapshot = settingsSnapshot();
          if (!snapshot?.items.length || snapshot.items.some(item => !item.id))
            throw new Error('当前章节没有可识别的任务标签，且任务数据不完整');
          const hiddenTabs = [...document.querySelectorAll('li[id^="dct"]')];
          if (hiddenTabs.length !== 1) throw new Error('隐藏任务标签数量不唯一，需人工检查');
          for (const item of snapshot.items) {
            const status = itemStatus(currentItem(item.id));
            if (status === 'complete') continue;
            if (status === 'pending' && item.type === 'video') {
              log('隐藏标签的视频播放中');
              await handleVideo(item, snapshot, hiddenTabs[0]);
            } else if (status === 'pending' && item.type === 'document') {
              log('隐藏标签的文档处理中');
              await handleDocument(item, snapshot, hiddenTabs[0]);
            } else {
              throw new Error('隐藏任务标签的任务状态或类型不明确，需人工检查');
            }
          }
          if (snapshot.items.some(item => itemStatus(currentItem(item.id)) !== 'complete'))
            throw new Error('隐藏任务标签处理后，平台仍未确认完成');
          log(`隐藏任务标签：${snapshot.items.length} 个任务已由平台确认完成`);
          if (!await finishChapter(chapter, snapshot.items.length)) return;
          continue;
        }
        const chapterId = new URL(location.href).searchParams.get('chapterId') || '';
        const status = itemStatus(work);
        if (status === 'pending') {
          if (!await reportQuiz()) throw new Error('测验报告生成失败');
          await waitForQuizCompletion(work.id, chapterId);
        } else if (status !== 'complete') {
          throw new Error('测验状态冲突，需人工检查');
        }
        log('测验任务已确认完成');
        if (!await finishChapter(chapter, 1)) return;
        continue;
      }
      log(`章节 ${chapter + 1}：${tabs.length} 个任务标签`);
      let previousSignature = '';
      const verified = new Set();
      for (let index = 0; index < tabs.length; index++) {
        assertActive();
        const snapshot = await selectTab(tabs[index], previousSignature, index > 0);
        previousSignature = taskSignature(snapshot);
        for (const item of snapshot.items) {
          assertActive();
          if (!item.id) throw new Error(`标签 ${index + 1} 有无 ID 的任务`);
          if (verified.has(item.id)) continue;
          const status = itemStatus(currentItem(item.id));
          if (status === 'complete') {
            log(`标签 ${index + 1}：${item.type} 已完成`);
          } else if (status === 'pending' && item.type === 'document') {
            log(`标签 ${index + 1}：文档处理中`);
            await handleDocument(item, snapshot, tabs[index]);
            log(`标签 ${index + 1}：文档已确认完成`);
          } else if (status === 'pending' && item.type === 'video') {
            log(`标签 ${index + 1}：视频播放中`);
            await handleVideo(item, snapshot, tabs[index]);
            log(`标签 ${index + 1}：视频已确认完成`);
          } else if (status === 'pending' && item.type === 'workid') {
            if (!await reportQuiz()) throw new Error('测验报告生成失败');
            const chapterId = new URL(location.href).searchParams.get('chapterId') || '';
            await waitForQuizCompletion(item.id, chapterId);
            log(`标签 ${index + 1}：测验已确认完成`);
          } else {
            throw new Error(`标签 ${index + 1} 的 ${item.type || '未知'} 任务状态不明确，需人工处理`);
          }
          verified.add(item.id);
        }
      }
      if (!verified.size) throw new Error('当前章节没有可核验的任务');
      if (!await finishChapter(chapter, verified.size)) return;
    }
  }

  const start = async () => {
    try {
      if (!navigator.locks?.request) throw new Error('浏览器不支持跨标签独占锁，已停止');
      await navigator.locks.request('cx-v3-single-tab', {mode:'exclusive', ifAvailable:true}, async lock => {
        if (!lock) throw new Error('另一个标签已有 v3 在运行');
        await run();
      });
    } catch (error) {
      if (stopped()) { setStatus('stopped'); log('已停止'); }
      else {
        state.incident = {chapterId:new URL(location.href).searchParams.get('chapterId') || '',
          message:String(error.message || error).slice(0, 500), at:new Date().toISOString()};
        setStatus('needs-review');
        log(`停下：${error.message}`);
      }
    } finally {
      state.active = false;
      box.dataset.active = 'false';
      persist();
    }
  };
  start();
})();
