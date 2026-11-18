const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const dir = path.join(__dirname,'..','extension');
const manifest = JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'),'utf8'));
assert.equal(manifest.manifest_version,3);
assert.deepEqual(manifest.host_permissions,
  ['https://chaoxing.com/*','https://*.chaoxing.com/*']);
assert(manifest.content_scripts[0].matches.every(value => value.includes('chaoxing.com')));
let updated;
const settings=[];
const chrome={
  sidePanel:{setOptions:async value => settings.push(value), setPanelBehavior:async () => {}},
  tabs:{query:async () => [],onUpdated:{addListener:listener => updated=listener}},
  runtime:{onInstalled:{addListener:() => {}},onStartup:{addListener:() => {}},
    onMessage:{addListener:() => {}}},
};
vm.runInNewContext(fs.readFileSync(path.join(dir,'background.js'),'utf8'),{chrome,URL});
(async () => {
  updated(1,{url:'https://mooc1.chaoxing.com/mycourse/studentstudy'},
    {url:'https://mooc1.chaoxing.com/mycourse/studentstudy'});
  updated(2,{url:'https://platform.deepseek.com/'},{url:'https://platform.deepseek.com/'});
  updated(3,{url:'https://fakechaoxing.com/'},{url:'https://fakechaoxing.com/'});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settings.find(item => item.tabId===1).enabled,true);
  assert.equal(settings.find(item => item.tabId===2).enabled,false);
  assert.equal(settings.find(item => item.tabId===3).enabled,false);
  console.log(JSON.stringify({sidePanel:'domain-scoped',nonChaoxingDisabled:true}));
})().catch(error => {console.error(error);process.exitCode=1;});
