import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {chromium} from 'playwright-core';
import {root,browserPath} from '../lib/config.mjs';
const browser=await chromium.launch({executablePath:browserPath(),headless:true});
try {
 const page=await browser.newPage({viewport:{width:360,height:800}});
 await page.addInitScript(()=>{
   globalThis.chrome={storage:{local:{get:async()=>({consoleToken:'a'.repeat(64)}),set:async()=>{}}},
     tabs:{query:async()=>[{id:77,url:'https://mooc1.chaoxing.com/mycourse/studentstudy'}],onActivated:{addListener(){}},onUpdated:{addListener(){}}},
     scripting:{executeScript:async()=>[{result:{page:'https://mooc1.chaoxing.com/mycourse/studentstudy',taskPoints:[],runtime:null}}]}};
 });
 let saved,reviewSaved;
 await page.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.hostname==='panel.test') {
     const name=url.pathname.slice(1) || 'panel.html';
     if(!['panel.html','panel.js','panel.css','snapshot.js','review.js','maintenance.js'].includes(name))return route.abort();
     return route.fulfill({contentType:name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html',body:readFileSync(join(root,'extension',name),'utf8')});
   }
   if(url.hostname==='127.0.0.1') {
     const headers={'access-control-allow-origin':'*','access-control-allow-headers':'*'};
     if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
     let body={mode:'stopped',model:{id:'test',name:'Test',baseUrl:'https://example.com',keyEnv:'KEY'},messages:[],modelActivity:[]};
     if(url.pathname==='/courses/preview')body={preview:{name:'Physics',courseId:'11',clazzId:'22',cpi:'33',expectedTasks:null,chapters:[{id:'44',name:'First'},{id:'55',name:'Last'}]}};
     if(url.pathname==='/courses/save'){saved=route.request().postDataJSON();body={saved:1};}
     if(url.pathname==='/reviews')body={items:[{key:'0123456789abcdef',title:'Review test',count:1,status:'needs-review'}]};
     if(url.pathname==='/reviews/read')body={key:'0123456789abcdef',sourceHash:'source-hash',answer:null,report:{title:'Review test',questions:[{index:1,questionId:'123',type:'单选题',text:'Local question',control:{kind:'choice'},captureIssues:['image-not-embedded'],options:[{label:'A',value:'A',text:'First'},{label:'B',value:'B',text:'Second'}]}]}};
     if(url.pathname==='/reviews/save'){reviewSaved=route.request().postDataJSON();body={status:'ready'};}
     return route.fulfill({headers,contentType:'application/json',body:JSON.stringify(body)});
   }
   return route.abort();
 });
 await page.goto('http://panel.test/panel.html');
 await page.locator('#modelId').waitFor();
 await page.waitForFunction(()=>document.querySelector('#modelId').value==='test');
 await page.locator('#modelId').fill('unsaved-model');
 await page.locator('#baseUrl').focus();
 await page.waitForTimeout(3200);
 assert.equal(await page.locator('#modelId').inputValue(),'unsaved-model');
 await page.getByText('课程队列设置',{exact:true}).click();
 await page.locator('#importCourse').click();
 await page.locator('#coursePreview').waitFor({state:'visible'});
 assert.equal(await page.locator('#expectedTasks').inputValue(),'');
 await page.locator('#firstChapter').selectOption('44');await page.locator('#lastChapter').selectOption('55');
 await page.locator('#expectedTasks').fill('3');await page.locator('#addCourse').click();await page.locator('#saveCourses').click();
 await page.waitForFunction(()=>document.querySelector('#message').textContent.includes('已保存 1'));
 assert.equal(saved.config.courses[0].firstChapterId,'44');
 assert.equal(saved.config.courses[0].expectedTasks,3);
 await page.locator('#reviewSection summary').click();await page.locator('#loadReviews').click();
 await page.getByRole('button',{name:'Review test · 1 题 · needs-review'}).click();
 await page.locator('#reviewQuestions input[value="B"]').check();
 await page.locator('#reviewAcknowledge').check();await page.locator('#saveReview').click();
 await page.waitForFunction(()=>document.querySelector('#reviewMessage').textContent.includes('已保存人工复核'));
 assert.deepEqual(reviewSaved.answers,[{index:1,answerValues:['B']}]);
 assert.equal(reviewSaved.sourceHash,'source-hash');assert.equal(reviewSaved.acknowledgeMissing,true);
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'narrow panel must not overflow horizontally');
 console.log('PASS: browser preserves drafts across polling and imports reviewed course metadata');
} finally {await browser.close();}
