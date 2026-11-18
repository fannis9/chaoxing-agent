const $ = id => document.getElementById(id);
let activeTab = null;

function isChaoxing(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' &&
      (parsed.hostname === 'chaoxing.com' || parsed.hostname.endsWith('.chaoxing.com'));
  } catch { return false; }
}

async function refresh() {
  const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
  activeTab = tab?.id || null;
  if (!tab || !isChaoxing(tab.url)) {
    $('page').textContent = '请切换到学习通页面';
    $('status').textContent = '未连接学习通标签';
    $('automatic').textContent = '—';
    $('quiz').textContent = '—';
    $('log').textContent = '—';
    $('pulse').classList.remove('live');
    return;
  }
  try {
    const data = await chrome.tabs.sendMessage(tab.id, {type:'snapshot'});
    $('page').textContent = `${data.title || '学习通'} · ${data.chapterId || '课程页面'}`;
    const runtime = data.runtime;
    $('status').textContent = runtime
      ? `状态：${runtime.status || '未知'}\n已完成章节：${runtime.completed}\n${runtime.incident ? `异常：${runtime.incident}` : ''}`
      : '等待章节脚本启动';
    $('automatic').textContent = data.automatic
      ? `${data.automatic.event}${data.automatic.status ? ` · ${data.automatic.status}` : ''}${data.automatic.reason ? `\n${data.automatic.reason}` : ''}`
      : '等待调度器';
    $('quiz').textContent = data.quiz ? `${data.quiz.title} · ${data.quiz.questionCount} 题` : '当前没有待处理测验';
    $('log').textContent = runtime?.lastLog?.join('\n') || data.visibleLog || '暂无日志';
    $('pulse').classList.toggle('live', Boolean(runtime?.active));
  } catch {
    $('page').textContent = tab.title || '学习通';
    $('status').textContent = '页面正在加载，稍后重试';
    $('automatic').textContent = '—';
    $('quiz').textContent = '—';
    $('log').textContent = '—';
    $('pulse').classList.remove('live');
  }
}

$('refresh').addEventListener('click', () => void refresh());
$('stop').addEventListener('click', async () => {
  if (!activeTab) return;
  try {
    const result = await chrome.tabs.sendMessage(activeTab, {type:'stop-page'});
    $('message').textContent = result.ok ? '本页脚本已停止' : result.reason || '停止失败';
  } catch { $('message').textContent = '页面未连接'; }
  await refresh();
});
chrome.tabs.onActivated.addListener(() => void refresh());
chrome.tabs.onUpdated.addListener((_id,info) => {if(info.status==='complete') void refresh();});
void refresh();
setInterval(() => void refresh(), 3000);
