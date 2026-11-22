import assert from 'node:assert/strict';
import {validateCourses} from '../lib/course-config.mjs';
import {inspectCoursePage} from '../platforms/chaoxing.mjs';
import vm from 'node:vm';
const config={schemaVersion:1,cpi:'333',courses:[{name:'Course',courseId:'11',clazzId:'22',firstChapterId:'44',finalChapterId:'55',expectedTasks:3}]};
assert.equal(validateCourses(config),config);
assert.throws(()=>validateCourses({...config,courses:[{...config.courses[0],firstChapterId:"1');danger()"}]}),/数字编号/);
assert.throws(()=>validateCourses({...config,courses:[config.courses[0],config.courses[0]]}),/重复/);
assert.throws(()=>validateCourses({...config,courses:[{...config.courses[0],expectedTasks:0}]}),/总数/);
const context={URL,location:{hostname:'mooc1.chaoxing.com',href:'https://mooc1.chaoxing.com/mycourse/studentstudy?courseId=11&clazzid=22&cpi=333'},
 document:{title:'Course',body:{innerText:'章节目录'},querySelector:()=>null,getElementById:()=>null,
 querySelectorAll:()=>[{id:'cur44',innerText:'First',querySelector:()=>null},{id:'curCourseId',innerText:'',querySelector:()=>null}]}};
const result=vm.runInNewContext(`(${inspectCoursePage.toString()})()`,context);
assert.equal(result.courseId,'11');assert.equal(result.chapters.length,1);assert.equal(result.expectedTasks,null);
console.log('PASS: course discovery preserves unknown totals and validates queue identity');
