// P1 harness: probe a real page, let the agent decide, and (optionally) act.
// Default is dry-run: no clicks, only observation + decision logging.
import {existsSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {BridgeClient} from '../lib/bridge-client.mjs';
import {step} from '../lib/agent-loop.mjs';
import {detectPlatform} from '../platforms/registry.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const envFile = join(ROOT, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const PORT = Number(process.env.CX_CONSOLE_PORT || 8788);
const token = (await import('node:fs')).readFileSync(join(ROOT, 'quiz-reports', 'console-token'), 'utf8').trim();
const headers = {'X-CX-Console': '1', Authorization: `Bearer ${token}`};
const status = await (await fetch(`http://127.0.0.1:${PORT}/status`, {headers})).json();
if (!status.agent?.agent) {
  console.log('扩展未连接，先按侧栏提示填好令牌');
  process.exit(1);
}
const model = status.model;
if (!process.env[model.keyEnv]) {
  console.log(`缺少 ${model.keyEnv}，模型慢路径不可用（规则路径仍可跑）`);
}

const bridge = new BridgeClient();
const tabs = await bridge.tabs();
const tabArg = process.argv.find(arg => arg.startsWith('--tab='))?.slice(6);
const study = tabArg ? tabs.find(tab => tab.id === tabArg) : tabs.find(tab => /studentstudy/.test(tab.url));
if (!study) {
  console.log('没有找到学习章节页；可用 --tab=<id> 指定');
  process.exit(1);
}

const act = process.argv.includes('--act');
const rounds = Number(process.argv.find(arg => arg.startsWith('--rounds='))?.slice(9) || 3);
console.log(`标签 ${study.id} · 模式 ${act ? '执行' : 'dry-run'} · ${rounds} 轮\n`);

const history = [];
for (let round = 1; round <= rounds; round += 1) {
  const started = Date.now();
  const forced = process.argv.includes('--force-model');
  const platform = detectPlatform(await bridge.url(String(tab)).catch(() => ''));
  const {scene, decision, result, check} = await step({
    platform,
    bridge, tab: study.id, model, dataDir: join(ROOT, 'quiz-reports'), history, dryRun: !act, forceModel: forced,
  });
  const brief = {
    kind: scene.pageKind,
    chapter: scene.chapter,
    tasks: scene.tasks.map(task => `${task.type || '?'}:${task.state}`).join(',') || '(none)',
    player: scene.player ? `t=${scene.player.currentTime}/${scene.player.duration ?? '?'} paused=${scene.player.paused}` : null,
    progress: scene.progress,
    blocked: scene.blocked,
    next: scene.nextAvailable,
  };
  console.log(`#${round} 场景 ${JSON.stringify(brief)}`);
  console.log(`  决策 [${decision.by}] ${decision.action} — ${decision.think}` +
    (decision.durationMs ? ` (${decision.durationMs}ms)` : ''));
  if (result) console.log(`  执行 ${JSON.stringify(result)}`);
  if (check) console.log(`  验证 ${check.ok ? '通过' : '未观察到预期变化'} 用时 ${Date.now() - started}ms`);
  history.push({scene: brief, decision: {action: decision.action, think: decision.think}});
  if (!act && round < rounds) await new Promise(resolve => setTimeout(resolve, 3000));
  await new Promise(resolve => setTimeout(resolve, 2000));
}
