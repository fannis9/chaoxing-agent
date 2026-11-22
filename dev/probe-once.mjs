// 对指定标签跑一次探针，只打印摘要（只读，不动作）。
import {readScene} from '../lib/probe.mjs';
import {detectPlatform} from '../platforms/registry.mjs';
import {BridgeClient} from '../lib/bridge-client.mjs';

const bridge = new BridgeClient();
const tab = process.argv[2];
if (!tab) throw new Error('用法: node dev/probe-once.mjs <tabId>');
const url = await bridge.url(String(tab));
const platform = detectPlatform(url);
const scene = await readScene(bridge, tab, platform);
console.log(JSON.stringify({
  url: scene.url,
  platform: platform?.id || null,
  pageKind: scene.pageKind,
  chapter: scene.chapter,
  tasks: scene.tasks,
  allTasksDone: scene.allTasksDone,
  nextAvailable: scene.nextAvailable,
  player: scene.player,
  progress: scene.progress,
  blocked: scene.blocked,
  readError: scene.readError,
}, null, 2));
