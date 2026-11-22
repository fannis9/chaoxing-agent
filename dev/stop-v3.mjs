import {BridgeClient} from '../lib/bridge-client.mjs';

const bridge = new BridgeClient();
const tab = process.argv[2] || (await bridge.tabs()).find(row => /studentstudy/.test(row.url))?.id;
if (!tab) throw new Error('没有学习章节页，传入标签 id');
const result = await bridge.command('eval',
  "(()=>{const s=window.__cxV3;if(!s)return 'no-v3';s.stop();return 'stopped:'+s.status})()",
  '--world', 'MAIN', '--tab', String(tab));
console.log(`${tab}: ${result}`);
