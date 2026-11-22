import {existsSync,readFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const envFile = join(root, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);
const {dataDir,browserPath} = await import('./lib/config.mjs');

const port = Number(process.env.CX_CONSOLE_PORT || 8788);
const tokenPath = join(dataDir,'console-token');
const token = existsSync(tokenPath) ? readFileSync(tokenPath,'utf8').trim() : '';

const checks = [];
const add = (name, ok, detail) => checks.push({name, ok: Boolean(ok), detail});

add('Node', Number(process.versions.node.split('.')[0]) >= 22, process.version);
add('浏览器', Boolean(browserPath()), browserPath() || '请设置 CHROME_PATH');
add('模型密钥', Boolean(process.env[process.env.CX_ANSWER_API_KEY_ENV || 'OPENAI_API_KEY']),
  '仅检查是否配置，不输出密钥');
add('配对令牌文件', Boolean(token), tokenPath);
add('控制台端口', true, `http://127.0.0.1:${port}`);

try {
  const queue = JSON.parse(readFileSync(join(dataDir,'automation-courses.json'),'utf8'));
  add('课程队列', queue.schemaVersion === 1 && queue.courses?.length > 0, `${queue.courses?.length || 0} 门课程`);
} catch {
  add('课程队列', false, '尚未配置；单课程模式可不提供队列');
}

if (token) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/status`, {
      headers: {'X-CX-Console': '1', Authorization: `Bearer ${token}`},
      signal: AbortSignal.timeout(5000),
    });
    const status = await response.json();
    add('控制台', true, `模式 ${status.mode}`);
    add('扩展连接', Boolean(status.agent?.agent),
      status.agent?.agent ? '浏览器代理已连接' : '请在侧栏填好配对令牌（扩展徽标应为 ON）');
    add('模型能力', Boolean(status.modelCapabilities?.ok),
      status.modelCapabilities?.ok ? '已通过文本/结构化/图片检测' : '尚未检测，可在侧栏点「检测模型」');
  } catch (error) {
    add('控制台', false, `未响应：${String(error.message || error).slice(0,80)}`);
  }
}

process.stdout.write(`${JSON.stringify({checks},null,2)}\n`);
