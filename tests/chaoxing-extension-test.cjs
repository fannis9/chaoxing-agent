const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const dir = path.join(__dirname,'..','extension');
const manifest = JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'),'utf8'));
assert.equal(manifest.manifest_version,3);
assert.deepEqual(manifest.host_permissions,
  ['https://chaoxing.com/*','https://*.chaoxing.com/*']);
assert.equal(manifest.content_scripts,undefined);
let updated;
const settings=[];
const chrome={
  sidePanel:{setOptions:async value => settings.push(value), setPanelBehavior:async () => {}},
  tabs:{query:async () => [],onUpdated:{addListener:listener => updated=listener}},
  runtime:{onInstalled:{addListener:() => {}},onStartup:{addListener:() => {}},
    onMessage:{addListener:() => {}}},
};
vm.runInNewContext(fs.readFileSync(path.join(dir,'background.js'),'utf8'),{chrome,URL});
(function testSnapshot() {
  const nodes = {
    cur937890675:{innerText:'7.1 可逆电池热力学及电动势产生的机理'},
    'cx-v3-status':{textContent:JSON.stringify({courseId:'249626764',chapterId:'937890675',
      status:'running',active:true,completed:[{chapterId:'1'}],lastLog:['播放中']})},
    'cx-auto-console-state':{textContent:'{"event":"progress","status":"running"}'},
  };
  const document = {
    title:'学生学习页面',getElementById:id => nodes[id] || null,
    querySelector:selector => selector === '.prev_title' ? {textContent:'可逆电池热力学及电动势产生的机理'} : null,
    querySelectorAll:() => [{innerText:'1 教案 PPT'},{innerText:'2 微课视频'}],
  };
  const context = {document,URL,location:{href:'https://mooc1.chaoxing.com/mycourse/studentstudy?chapterId=937890675&courseId=249626764',
    origin:'https://mooc1.chaoxing.com',pathname:'/mycourse/studentstudy'},
    sessionStorage:{getItem:() => null}};
  vm.runInNewContext(fs.readFileSync(path.join(dir,'snapshot.js'),'utf8'),context);
  const result = vm.runInNewContext('snapshotPage()',context);
  assert.equal(result.chapterTitle,'7.1 可逆电池热力学及电动势产生的机理');
  assert.equal(result.chapterId,'937890675');
  assert.equal(result.runtime.status,'running');
  assert.equal(result.runtime.source,'live');
  assert.equal(result.automatic.event,'progress');
  assert.equal(result.taskPoints.length,2);
  delete nodes.cur937890675;
  assert.equal(vm.runInNewContext('snapshotPage()',context).chapterTitle,
    '可逆电池热力学及电动势产生的机理');
})();
async function testPanelReadsExistingTab() {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id,{textContent:'',classList:{toggle:() => {},remove:() => {}},
      addEventListener:() => {}});
    return elements.get(id);
  };
  const calls=[];
  const panelChrome={
    tabs:{query:async () => [{id:12,url:'https://mooc1.chaoxing.com/mycourse/studentstudy?chapterId=937890675'}],
      onActivated:{addListener:() => {}},onUpdated:{addListener:() => {}}},
    scripting:{executeScript:async args => {
      calls.push(args);
      return [{result:{page:'https://mooc1.chaoxing.com/mycourse/studentstudy',
        chapterId:'937890675',courseId:'249626764',chapterTitle:'7.1 可逆电池热力学及电动势产生的机理',
        taskPoints:['1 教案 PPT'],runtime:{status:'running',chapterId:'937890675',completed:2,
          lastLog:['播放中'],active:true,source:'live'},automatic:null,quiz:null,visibleLog:''}}];
    }},
  };
  vm.runInNewContext(fs.readFileSync(path.join(dir,'panel.js'),'utf8'),
    {chrome:panelChrome,document:{getElementById:element},URL,snapshotPage:() => {},setInterval:() => {}});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls[0].target.tabId,12);
  assert.match(element('chapter').textContent,/7\.1 可逆电池/);
  assert.match(element('status').textContent,/学习中/);
}
(async () => {
  await testPanelReadsExistingTab();
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
