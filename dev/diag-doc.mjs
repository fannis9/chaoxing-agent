import {BridgeClient} from '../lib/bridge-client.mjs';
import {readScene} from '../lib/probe.mjs';

const bridge = new BridgeClient();
const tab = process.argv[2] || (await bridge.tabs()).find(row => /studentstudy/.test(row.url))?.id;
const scene = await readScene(bridge, tab);
console.log('scene:', JSON.stringify({
  chapter: scene.chapter, defaults: scene.defaults,
  tasks: scene.tasks.map(task => ({id: task.id, type: task.type, state: task.state, token: task.token ? 'yes' : ''})),
}, null, 1));
const doc = await bridge.command('eval', 'JSON.stringify(window.__cxDoc||null)', '--world', 'MAIN', '--tab', String(tab));
console.log('__cxDoc:', doc);
const href = await bridge.command('eval',
  "JSON.stringify({url:location.href, hasDoc:!!document.getElementById('prevNextFocusNext')})",
  '--world', 'MAIN', '--tab', String(tab));
console.log('page:', href);
