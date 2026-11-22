const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const nodes = new Map();
const node = () => ({value:'',children:[],dataset:{},listeners:{},scrollTop:0,
  append(...items){this.children.push(...items)},replaceChildren(){this.children=[]},
  addEventListener(event,handler){this.listeners[event]=handler},
  setAttribute(name,value){this[name]=value},
  classList:{remove(){},toggle(){}}});
const get = id => {if(!nodes.has(id))nodes.set(id,node());return nodes.get(id)};
const state = {mode:'stopped',model:{id:'old',name:'Model',baseUrl:'https://example.com',keyEnv:'KEY'},messages:[],modelActivity:[]};
const context = vm.createContext({document:{getElementById:get,createElement:node},URL,AbortSignal,
  chrome:{tabs:{query:async()=>[],onActivated:{addListener(){}},onUpdated:{addListener(){}}}},
  setInterval(){},fetch:async()=>({ok:true,json:async()=>state})});
vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../extension/panel.js'),'utf8'),context);
(async()=>{
  await new Promise(resolve=>setImmediate(resolve));
  get('modelId').value='draft'; get('modelId').listeners.input();
  vm.runInContext('renderConsole(consoleState)',context);
  assert.equal(get('modelId').value,'draft');
  vm.runInContext('sending=true; renderConsole(consoleState)',context);
  assert.equal(get('send').disabled,true);
  const marker=node(); get('conversation').append(marker);
  vm.runInContext('renderConsole(consoleState)',context);
  assert.equal(get('conversation').children[0],marker);
  console.log('PASS: draft preservation, pending send, stable conversation');
})().catch(error=>{console.error(error);process.exitCode=1});
