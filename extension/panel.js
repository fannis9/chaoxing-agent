const $ = id => document.getElementById(id);
let activeTab = null;
let requestId = 0;
let consoleState = null;
const controlUrl = 'http://127.0.0.1:8788';
async function control(path, data) {
  const response = await fetch(`${controlUrl}${path}`, {
    method:data ? 'POST' : 'GET',
    headers:{'X-CX-Console':'1','Content-Type':'application/json'},
    body:data ? JSON.stringify(data) : undefined,
    signal:AbortSignal.timeout(path === '/status' ? 5000 : 65000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
  return result;
}
function renderConsole(state) {
  consoleState = state;
  const mode = ({running:'运行中',paused:'已暂停',stopped:'已停止'})[state.mode] || state.mode;
  $('connection').textContent = `本机控制端已连接 · 队列${mode}${state.error ? `\n${state.error}` : ''}`;
  $('runSummary').textContent = state.mode === 'running'
    ? `助手运行中 · ${events[state.event?.event] || state.event?.event || '等待任务'}` : `队列${mode}`;
  $('modelStatus').textContent = `${state.model.name || state.model.id} · ${state.keyConfigured ? '密钥已配置' : '密钥未配置'}`;
  for (const [id,value] of Object.entries({modelName:state.model.name,modelId:state.model.id,
    baseUrl:state.model.baseUrl,keyEnv:state.model.keyEnv})) {
    if (document.activeElement !== $(id)) $(id).value = value || '';
  }
  $('start').disabled = state.mode === 'running';
  $('resume').disabled = state.mode !== 'paused';
  $('pause').disabled = state.mode !== 'running';
  $('stopAll').disabled = state.mode === 'stopped';
  $('testModel').disabled = false;
  $('send').disabled = false;
  const conversation = $('conversation');
  conversation.replaceChildren();
  for (const message of state.messages || []) {
    const row = document.createElement('p');
    row.textContent = `${message.role === 'user' ? '你' : state.model.name || '模型'}：${message.text}`;
    conversation.append(row);
  }
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
  'quiz-retry':'模型请求重试中','quiz-submitted':'测验已提交','quiz-deferred':'测验已暂缓，待补做','needs-review':'需要人工检查',
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
  $('quiz').textContent = data.quiz && currentRuntime
    ? `${data.quiz.title} · ${data.quiz.questionCount} 题 · 等待处理`
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
      await control('/control',{action:action === 'stopAll' ? 'stop' : action});
      $('message').textContent = '操作已执行';
      await refreshConsole();
    } catch (error) { $('message').textContent = error.message; }
  });
}
$('saveModel').addEventListener('click', async () => {
  try {
    await control('/model',{name:$('modelName').value,id:$('modelId').value,
      baseUrl:$('baseUrl').value,keyEnv:$('keyEnv').value});
    $('message').textContent = '模型配置已保存';
    await refreshConsole();
  } catch (error) { $('message').textContent = error.message; }
});
$('testModel').addEventListener('click', async () => {
  $('message').textContent = '正在测试模型…';
  try { const result = await control('/test-model',{}); $('message').textContent = result.ok ? '模型连接成功' : '模型未返回内容'; }
  catch (error) { $('message').textContent = error.message; }
});
$('send').addEventListener('click', async () => {
  const text = $('prompt').value.trim();
  if (!text) return;
  $('send').disabled = true;
  $('message').textContent = '模型正在回复…';
  try {
    await control('/chat',{text});
    $('prompt').value = '';
    $('message').textContent = '回复完成';
    await refreshConsole();
  } catch (error) { $('message').textContent = error.message; }
  finally { $('send').disabled = false; }
});
$('clearChat').addEventListener('click', async () => {
  try { await control('/clear-chat',{}); await refreshConsole(); }
  catch (error) { $('message').textContent = error.message; }
});
