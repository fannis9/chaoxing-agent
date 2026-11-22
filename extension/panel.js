const $ = id => document.getElementById(id);
let activeTab = null;
let requestId = 0;
let consoleState = null;
const dirtyFields = new Set();
let sending = false;
let testingModel = false;
let conversationVersion = '';
let coursePreview = null;
const courseDraft = {schemaVersion:1,cpi:'',courses:[]};
function renderCourseDraft() {
  $('courseQueue').replaceChildren();
  courseDraft.courses.forEach((course,index)=>{
    const row=document.createElement('li');
    row.textContent=`${course.name} · ${course.expectedTasks} 个任务点 `;
    for(const [label,delta] of [['上移',-1],['下移',1],['移除',0]]) {
      const button=document.createElement('button');button.textContent=label;
      button.disabled=delta!==0 && !courseDraft.courses[index+delta];
      button.addEventListener('click',()=>{
        if(delta===0)courseDraft.courses.splice(index,1);
        else [courseDraft.courses[index],courseDraft.courses[index+delta]]=[courseDraft.courses[index+delta],courseDraft.courses[index]];
        if(!courseDraft.courses.length)courseDraft.cpi='';
        renderCourseDraft();
      });row.append(button);
    }
    $('courseQueue').append(row);
  });
}
for (const id of ['modelName','modelId','baseUrl','keyEnv','modelProtocol']) {
  $(id).addEventListener('input', () => dirtyFields.add(id));
}
let controlUrl = 'http://127.0.0.1:8788';
let consoleToken = '';
const credentialsReady = chrome.storage?.local.get(['consoleToken','consolePort']).then(value => {
  consoleToken = value.consoleToken || '';
  const port=Number(value.consolePort || 8788);
  if(Number.isInteger(port) && port>0 && port<65536) controlUrl=`http://127.0.0.1:${port}`;
  $('consolePort').value=String(port);
});
$('pairConsole').addEventListener('click', async () => {
  const token = $('consoleToken').value.trim();
  const port=Number($('consolePort').value || 8788);
  if(!Number.isInteger(port) || port<1 || port>65535) { $('message').textContent='端口必须是 1–65535';return; }
  if (!/^[a-f0-9]{64}$/.test(token)) { $('message').textContent = '请输入完整的 64 位配对令牌'; return; }
  await chrome.storage.local.set({consoleToken:token,consolePort:port});
  consoleToken = token;
  controlUrl=`http://127.0.0.1:${port}`;
  $('consoleToken').value = '';
  await refreshConsole();
});
async function control(path, data) {
  await credentialsReady;
  const response = await fetch(`${controlUrl}${path}`, {
    method:data ? 'POST' : 'GET',
    headers:{'X-CX-Console':'1','Content-Type':'application/json',Authorization:`Bearer ${consoleToken}`,
      'X-CX-Extension-Version':chrome.runtime?.getManifest?.().version || 'unknown'},
    body:data ? JSON.stringify(data) : undefined,
    signal:AbortSignal.timeout(path === '/status' ? 5000 : 65000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
  return result;
}
function renderConsole(state) {
  consoleState = state;
  const automation=state.automation || {};
  const automationNames={disabled:'未启用',paused:'已手动暂停',waiting:'等待启动','waiting-browser':'等待浏览器连接','waiting-login':'等待浏览器登录','waiting-user':'等待验证或登录','waiting-model':'等待模型配置',running:'自动运行中',retrying:'连接异常，稍后自动重试',complete:'队列已处理完毕'};
  $('automationStatus').textContent=automationNames[automation.status] || '未启用';
  $('toggleAutomation').textContent=automation.enabled?'自动刷课：开启':'自动刷课：关闭';
  $('toggleAnswer').textContent=state.autoAnswer!==false?'自动答题：开启':'自动答题：关闭';
  $('toggleAutomation').setAttribute('aria-pressed',String(Boolean(automation.enabled)));
  $('toggleAnswer').setAttribute('aria-pressed',String(state.autoAnswer!==false));
  const courseNames={pending:'待处理',complete:'已完成','processed-with-unresolved':'已处理，仍有未完成任务','no-tasks':'无章节任务',unavailable:'目录暂不可用'};
  $('automationSummary').textContent=(automation.courses || []).map(c=>`${c.name}：${courseNames[c.status] || c.status}`).join('\n')+`\n待补做章节：${automation.deferred?.length || 0}`;
  $('automationSummary').style && ($('automationSummary').style.whiteSpace='pre-wrap');
  $('setupChecklist').replaceChildren();
  for(const [ok,label] of [[true,'控制台已配对'],[state.setup?.bridgeInstalled,'Page Bridge 已安装'],
    [state.setup?.browserInstalled,'预览浏览器已找到'],[state.keyConfigured,'模型密钥已配置'],
    [state.modelCapabilities?.ok,'模型能力检测通过'],[state.setup?.coursesConfigured,'课程队列已保存（单课程可跳过）']]){
    const item=document.createElement('li');item.textContent=`${ok?'✓':'待处理'} ${label}`;$('setupChecklist').append(item);
  }
  const recovering=state.mode==='needs-review' && !automation.userPaused && ['recovery-check','recovery-action'].includes(state.event?.event);
  const mode = recovering ? '自动恢复中' : ({running:'运行中',paused:'已暂停',stopped:'已停止',pausing:'正在停止', 'needs-review':'需要检查'})[state.mode] || state.mode;
  $('connection').textContent = `本机控制端已连接 · 队列${mode}${state.error ? `\n${state.error}` : ''}`;
  $('runSummary').textContent = recovering ? `${events[state.event.event]} · ${state.event.reason || ''}` : state.mode === 'running'
    ? `助手运行中 · ${events[state.event?.event] || state.event?.event || '等待任务'}` : `队列${mode}`;
  if(state.targetTab) $('runSummary').textContent+=` · 控制标签 ${state.targetTab}${String(activeTab)!==String(state.targetTab) ? '（当前查看其他标签）' : ''}`;
  $('modelStatus').textContent = `${state.model.name || state.model.id} · ${state.keyConfigured ? '密钥已配置' : '密钥未配置'}`;
  for (const [id,value] of Object.entries({modelName:state.model.name,modelId:state.model.id,
    baseUrl:state.model.baseUrl,keyEnv:state.model.keyEnv,modelProtocol:state.model.protocol || 'responses'})) {
    if (!dirtyFields.has(id) && document.activeElement !== $(id)) $(id).value = value || '';
  }
  $('start').disabled = ['running','pausing','needs-review'].includes(state.mode);
  $('start').hidden = state.mode==='running' || state.mode==='paused';
  $('pause').hidden = state.mode!=='running' && !recovering;
  $('resume').hidden = recovering || !['paused','needs-review'].includes(state.mode);
  $('resume').disabled = recovering || !['paused','needs-review'].includes(state.mode);
  $('pause').disabled = state.mode !== 'running' && !recovering;
  $('stopAll').disabled = state.mode === 'stopped';
  $('testModel').disabled = testingModel;
  const capabilityNames={text:'文本',structured:'结构化输出','image-input':'图片输入'};
  $('modelCapabilities').textContent=(state.modelCapabilities?.results || []).map(result=>`${capabilityNames[result.name] || result.name}：${result.ok?'通过':result.error}`).join('\n');
  $('send').disabled = sending;
  const nextConversationVersion = JSON.stringify([state.model.name,state.messages,state.modelActivity,state.operations]);
  if (nextConversationVersion === conversationVersion) return;
  conversationVersion = nextConversationVersion;
  const conversation = $('conversation');
  const scrollTop = conversation.scrollTop;
  const expanded = new Set(Array.from(conversation.children)
    .filter(node => node.open).map(node => node.dataset?.key));
  conversation.replaceChildren();
  for(const op of state.operations || []){
    const group=document.createElement('details');
    group.dataset.key=`operation:${op.at}:${op.result}`;group.open=expanded.has(group.dataset.key);
    const summary=document.createElement('summary');
    const action={reload:'刷新章节',retry:'重新尝试',skip:'跳过章节','wait-user':'等待本人操作'}[op.action] || op.action;
    summary.textContent=`${op.source==='model'?'AI 操作':'自动处理'} · ${action} · ${op.result}`;
    const row=document.createElement('p');
    row.textContent=`时间：${op.at ? new Date(op.at).toLocaleString() : '未知'}\n课程：${op.courseId} · 章节：${op.chapterId}\n原因：${op.reason}`;
    group.append(summary,row);conversation.append(group);
  }
  for (const activity of (state.modelActivity || []).slice()
      .sort((left,right) => String(right.at).localeCompare(String(left.at)))) {
    const group = document.createElement('details');
    if (group.dataset) {
      group.dataset.key = activity.key || activity.at;
      group.open = expanded.has(group.dataset.key);
    }
    const summary = document.createElement('summary');
    const status = {ready:'可填写', submitted:'已提交', 'needs-review':'需复核'}[activity.status]
      || activity.status || '状态未知';
    summary.textContent = `自动答题 · ${activity.title} · ${activity.model} · ${status}`;
    group.append(summary);
    let capturedFont='';
    if(activity.fontDataUrl && typeof FontFace!=='undefined' && /^data:(?:application\/font-ttf|font\/ttf|application\/octet-stream)[;,]/.test(activity.fontDataUrl)){
      capturedFont='quiz'+String(activity.key || '').replace(/[^a-z0-9]/gi,'');
      if(![...document.fonts].some(face=>face.family===capturedFont)){
        const face=new FontFace(capturedFont,`url("${activity.fontDataUrl}")`);
        document.fonts.add(face);void face.load().catch(()=>{});
      }
    }
    for (const question of activity.questions || []) {
      const row = document.createElement('p');
      const stem=document.createElement('span');
      stem.textContent=`第 ${question.index} 题 ${question.fontObfuscated && !capturedFont?'原题字体缺失，请查看原页面':question.text}`;
      if(question.fontObfuscated && capturedFont)stem.style.fontFamily=`"${capturedFont}", sans-serif`;
      const response=document.createElement('span');
      response.textContent=`\n模型答案：${question.answer || '未作答'}\n${question.explanation}`;
      row.append(stem,response);
      group.append(row);
    }
    conversation.append(group);
  }
  for (const message of state.messages || []) {
    const row = document.createElement('p');
    row.textContent = `${message.role === 'user' ? '你' : state.model.name || '模型'}：${message.text}`;
    conversation.append(row);
  }
  conversation.scrollTop = scrollTop;
}
async function refreshConsole() {
  try { renderConsole(await control('/status')); }
  catch (error) {
    $('connection').textContent = `本机控制端未连接 · ${error.message}`;
    $('runSummary').textContent = '本机控制端未连接';
    $('modelStatus').textContent = `无法读取模型配置 · ${error.message}`;
    for (const id of ['start','pause','resume','stopAll','testModel','send']) $(id).disabled = true;
  }
}

function isChaoxing(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' &&
      (parsed.hostname === 'chaoxing.com' || parsed.hostname.endsWith('.chaoxing.com'));
  } catch { return false; }
}

const statuses = {
  starting:'启动中', running:'学习中', 'waiting-quiz':'等待测验处理',
  'course-boundary':'课程末章核验', complete:'已完成', stopped:'已停止',
  stopping:'正在停止', limit:'单节测试结束', 'needs-review':'需要检查',
};
const events = {started:'已启动',progress:'学习进度',quiz:'发现测验',
  'recovery-check':'AI 正在诊断故障','recovery-action':'正在执行恢复动作',
  'quiz-retry':'模型请求重试中','quiz-submitted':'测验已提交','quiz-deferred':'测验已暂缓，待补做','quiz-skip-check':'AI 正在判断是否跳过','needs-review':'需要人工检查',
  'schedule-complete':'课程队列完成'};

function reset(message) {
  $('page').textContent = message;
  $('chapter').textContent = '';
  $('status').textContent = '—';
  $('video').textContent = '无法读取当前章节的视频状态';
  $('videoProgress').hidden = true;
  $('automatic').textContent = '—';
  $('quiz').textContent = '—';
  $('log').textContent = '—';
  $('pulse').classList.remove('live');
}

function render(data) {
  const isStudy = /\/mycourse\/studentstudy\/?$/.test(new URL(data.page).pathname);
  $('page').textContent = isStudy ? `课程 ${data.courseId || '未知'} · 章节 ${data.chapterId || '未知'}` : data.pageTitle || '学习通页面';
  $('chapter').textContent = data.chapterTitle || (isStudy ? '正在读取章节标题…' : '当前不是章节学习页');
  const runtime = data.runtime;
  const currentRuntime = runtime && (!runtime.chapterId || runtime.chapterId === data.chapterId);
  const video = currentRuntime ? runtime.video : null;
  if (video?.duration) {
    const percent = Math.min(100, Math.round(video.time / video.duration * 100));
    $('video').textContent = `播放中 · ${percent}% · ${video.rate}×`;
    $('videoProgress').value = percent;
    $('videoProgress').hidden = false;
  } else {
    $('video').textContent = currentRuntime && runtime.status === 'waiting-quiz'
      ? '视频任务已结束，正在处理测验' : '当前没有播放中的视频';
    $('videoProgress').hidden = true;
  }
  if (runtime && runtime.chapterId && data.chapterId && runtime.chapterId !== data.chapterId) {
    $('status').textContent = '已切换章节，等待当前章节状态更新';
  } else if (runtime) {
    const lines = [
      `状态：${statuses[runtime.status] || runtime.status || '未知'}`,
      `本次运行已完成章节：${runtime.completed}`,
    ];
    if (runtime.source === 'checkpoint') lines.push('来源：上次运行记录');
    if (runtime.video?.duration) {
      const {time,duration,rate} = runtime.video;
      lines.push(`视频：${Math.floor(time / 60)}:${String(time % 60).padStart(2,'0')} / ${Math.floor(duration / 60)}:${String(duration % 60).padStart(2,'0')} · ${rate}×`);
    }
    if (runtime.incident) lines.push(`异常：${runtime.incident}`);
    if (data.taskPoints.length) lines.push(`本节任务点：${data.taskPoints.join('、')}`);
    $('status').textContent = lines.join('\n');
  } else {
    $('status').textContent = isStudy
      ? `等待章节脚本启动${data.taskPoints.length ? `\n本节任务点：${data.taskPoints.join('、')}` : ''}`
      : '打开章节学习页后显示任务状态';
  }
  const auto = data.automatic;
  $('automatic').textContent = auto
    ? `${auto.chapterId && data.chapterId && auto.chapterId !== data.chapterId ? '上一章节 · ' : ''}${events[auto.event] || auto.event || '调度事件'}${auto.status ? ` · ${statuses[auto.status] || auto.status}` : ''}${auto.reason ? `\n${auto.reason}` : ''}`
    : '尚无自动调度事件';
  const quizIssue = consoleState?.lastQuizIssue?.chapterId === data.chapterId
    ? consoleState.lastQuizIssue.reason : '';
  $('quiz').textContent = data.quiz && currentRuntime
    ? `${data.quiz.title} · ${data.quiz.questionCount} 题${quizIssue ? `\n${quizIssue}` : ' · 等待处理'}`
    : '当前没有待处理测验';
  $('log').textContent = runtime?.lastLog?.join('\n') || data.visibleLog || '暂无日志';
  $('pulse').classList.toggle('live', Boolean(runtime?.active && runtime.source === 'live'));
}

async function refresh() {
  const thisRequest = ++requestId;
  let tab;
  try { [tab] = await chrome.tabs.query({active:true,currentWindow:true}); }
  catch (error) { reset(`无法定位当前标签：${error.message}`); return; }
  if (thisRequest !== requestId) return;
  activeTab = tab?.id || null;
  if (!tab || !isChaoxing(tab.url)) { reset('请切换到学习通页面'); return; }
  try {
    const result = await chrome.scripting.executeScript({target:{tabId:tab.id},func:snapshotPage});
    if (thisRequest !== requestId) return;
    if (!result[0]?.result) throw new Error('页面没有返回状态');
    render(result[0].result);
  } catch (error) {
    if (thisRequest !== requestId) return;
    reset(`无法读取页面：${error.message}`);
  }
}

$('refresh').addEventListener('click', () => void refresh());
$('toggleAnswer').addEventListener('click',async()=>{
  $('toggleAnswer').disabled=true;
  try{await control('/auto-answer',{enabled:consoleState?.autoAnswer===false});await refreshConsole();}
  catch(error){$('message').textContent=error.message;}
  finally{$('toggleAnswer').disabled=false;}
});
$('toggleAutomation').addEventListener('click',async()=>{
  try{await control('/automation',{enabled:!consoleState?.automation?.enabled});await refreshConsole();}
  catch(error){$('message').textContent=error.message;}
});
$('stop').addEventListener('click', async () => {
  if (!activeTab) return;
  try {
    const result = await chrome.scripting.executeScript({target:{tabId:activeTab},world:'MAIN',
      func:() => {
        if (typeof window.__cxV3?.stop !== 'function') return {ok:false,reason:'当前页没有运行中的章节脚本'};
        window.__cxV3.stop();
        return {ok:true};
      }});
    const outcome = result[0]?.result;
    $('message').textContent = outcome?.ok ? '本页脚本已停止' : outcome?.reason || '停止失败';
  } catch (error) { $('message').textContent = `停止失败：${error.message}`; }
  await refresh();
});
chrome.tabs.onActivated.addListener(() => void refresh());
chrome.tabs.onUpdated.addListener((_id,info) => {if(info.status==='complete') void refresh();});
void refresh();
setInterval(() => void refresh(), 3000);
void refreshConsole();
setInterval(() => void refreshConsole(), 3000);
for (const action of ['start','pause','resume','stopAll']) {
  $(action).addEventListener('click', async () => {
    try {
      await control('/control',{action:action === 'stopAll' ? 'stop' : action,tab:activeTab});
      $('message').textContent = '操作已执行';
      await refreshConsole();
    } catch (error) { $('message').textContent = error.message; }
  });
}
$('saveModel').addEventListener('click', async () => {
  const draft = Object.fromEntries(['modelName','modelId','baseUrl','keyEnv','modelProtocol'].map(id => [id,$(id).value]));
  try {
    await control('/model',{name:draft.modelName,id:draft.modelId,
      baseUrl:draft.baseUrl,keyEnv:draft.keyEnv,protocol:draft.modelProtocol});
    $('message').textContent = '模型配置已保存';
    for (const [id,value] of Object.entries(draft)) if ($(id).value === value) dirtyFields.delete(id);
    await refreshConsole();
  } catch (error) { $('message').textContent = error.message; }
});
$('testModel').addEventListener('click', async () => {
  if(testingModel)return;
  testingModel=true;$('testModel').disabled=true;
  $('message').textContent = '正在检测文本、结构化输出和图片输入（最多三次请求）…';
  try { const result = await control('/test-model',{}); $('message').textContent = result.ok ? '模型能力检测通过；图片检测不代表解题准确率' : '部分能力检测失败，请查看结果';await refreshConsole(); }
  catch (error) { $('message').textContent = error.message; }
  finally {testingModel=false;$('testModel').disabled=false;}
});
$('send').addEventListener('click', async () => {
  const text = $('prompt').value.trim();
  if (!text || sending) return;
  sending = true;
  $('send').disabled = true;
  $('message').textContent = '模型正在回复…';
  try {
    await control('/chat',{text});
    if ($('prompt').value.trim() === text) $('prompt').value = '';
    $('message').textContent = '回复完成';
    await refreshConsole();
  } catch (error) { $('message').textContent = error.message; }
  finally { sending = false; $('send').disabled = false; }
});
$('clearChat').addEventListener('click', async () => {
  try { await control('/clear-chat',{}); await refreshConsole(); }
  catch (error) { $('message').textContent = error.message; }
});
$('importCourse').addEventListener('click',async()=>{
  try {
    const result=await control('/courses/preview',{tab:activeTab});
    coursePreview=result.preview;
    $('courseName').value=coursePreview.name || '';
    $('expectedTasks').value=coursePreview.expectedTasks || '';
    for(const id of ['firstChapter','lastChapter']) {
      $(id).replaceChildren();
      for(const chapter of coursePreview.chapters) {
        const option=document.createElement('option');option.value=chapter.id;option.textContent=chapter.name;$(id).append(option);
      }
      $(id).selectedIndex=-1;
    }
    $('coursePreview').hidden=false;
    $('message').textContent='已读取；请明确选择任务章节范围，并核实总任务点数';
  }catch(error){$('message').textContent=error.message;}
});
$('addCourse').addEventListener('click',()=>{
  if(!coursePreview)return;
  if(courseDraft.cpi && courseDraft.cpi!==coursePreview.cpi){$('message').textContent='队列不能混合不同学习身份';return;}
  const first=$('firstChapter').value,last=$('lastChapter').value,total=Number($('expectedTasks').value);
  if(!first || !last || !Number.isInteger(total) || total<1){$('message').textContent='请选择首末任务章节并填写任务点总数';return;}
  if(courseDraft.courses.some(course=>course.courseId===coursePreview.courseId && course.clazzId===coursePreview.clazzId)){
    $('message').textContent='该课程已在队列中';return;
  }
  courseDraft.cpi=coursePreview.cpi;
  courseDraft.courses.push({key:coursePreview.courseId,name:$('courseName').value,courseId:coursePreview.courseId,
    clazzId:coursePreview.clazzId,firstChapterId:first,finalChapterId:last,expectedTasks:total});
  renderCourseDraft();
  $('message').textContent='已加入草稿，保存后生效';
});
$('saveCourses').addEventListener('click',async()=>{
  try {const result=await control('/courses/save',{config:courseDraft});$('message').textContent=`已保存 ${result.saved} 门课程`;}
  catch(error){$('message').textContent=error.message;}
});
