import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AutomaticQueue} from '../lib/automatic-queue.mjs';
const dir=mkdtempSync(join(tmpdir(),'cx-autoqueue-'));
const courses=[{courseId:'1',clazzId:'11',cpi:'99',name:'one',url:'https://mooc1.chaoxing.com/visit/stucoursemiddle?courseid=1'},
 {courseId:'2',clazzId:'22',cpi:'99',name:'two',url:'https://mooc1.chaoxing.com/visit/stucoursemiddle?courseid=2'},
 {courseId:'3',clazzId:'33',cpi:'99',name:'ended',ended:true,url:'https://mooc1.chaoxing.com/visit/stucoursemiddle?courseid=3'}];
let id=80,selected='1',opens=0;const closed=[];
const bridge={url:async()=>`https://mooc2-ans.chaoxing.com/mooc2-ans/mycourse/studentcourse?courseid=${selected}`,
 command:async(command,arg)=>{
  if(command==='open'){opens++;return JSON.stringify({tabId:++id});}
  if(command==='close'){closed.push(arg);return '{}';}
  if(command==='navigate'){selected=new URL(arg).searchParams.get('courseid');return '{}';}
  if(command==='eval' && arg.includes('inspectEnrollments'))return JSON.stringify({courses,loginRequired:false});
  if(command==='eval' && arg.includes('inspectDirectory'))return JSON.stringify({courseId:selected,blocked:false,empty:false,
   chapters:[{id:selected+'01'},{id:selected+'02'}],progress:selected==='1'?[{done:2,total:3}]:[],enc:'abc'});
  throw new Error(command);
 }};
const queue=new AutomaticQueue(bridge,dir),result=await queue.discover([], '2');
assert.deepEqual(result.courses.map(c=>c.courseId),['2','1']);
assert.equal(result.excluded.length,1);assert.equal(result.courses[0].expectedTasks,null);
assert.equal(result.courses[1].expectedTasks,3);assert.equal(closed.length,2);
const config=JSON.parse(readFileSync(queue.configPath,'utf8'));assert.equal(config.autoDiscovered,true);
const before=opens;await queue.discover([{url:'https://mooc1.chaoxing.com/mycourse/studentstudy?cpi=99'}],'2');assert.equal(opens,before,'matching logged-in study reuses durable queue');
await queue.discover([],'2');assert.equal(opens,before+1,'without study tab, cached queue revalidates login via portal');
const cancelled=new AutomaticQueue(bridge,mkdtempSync(join(tmpdir(),'cx-autoqueue-cancel-')));
await assert.rejects(cancelled.discover([],null,()=>false),/取消/);
console.log('PASS: enrolled queue, ended exclusions, preferred course, unknown totals, persistence and cancellation');
