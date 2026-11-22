import {readFileSync,existsSync,mkdirSync,writeFileSync,renameSync} from 'node:fs';
import {join} from 'node:path';
import {inspectEnrollments,readCourseDirectory} from './course-discovery.mjs';

export class AutomaticQueue {
  constructor(bridge,directory){this.bridge=bridge;this.directory=directory;this.path=join(directory,'automation-queue.json');this.configPath=join(directory,'automation-courses.json');}
  read(){try{return JSON.parse(readFileSync(this.path,'utf8'))}catch(error){if(error.code==='ENOENT')return null;throw error}}
  save(queue){mkdirSync(this.directory,{recursive:true,mode:0o700});const tmp=this.path+'.tmp';writeFileSync(tmp,JSON.stringify(queue,null,2),{mode:0o600});renameSync(tmp,this.path);}
  async discover(tabs,preferredCourseId,active=()=>true){
    const previous=this.read();
    const cached=previous?.status!=='discovering' && previous?.courses?.length && existsSync(this.configPath);
    const matchingStudy=tabs.some(tab=>{
      try{const url=new URL(tab.url);return /\/mycourse\/studentstudy$/.test(url.pathname) && url.searchParams.get('cpi')===previous?.cpi;}catch{return false;}
    });
    if(cached && matchingStudy)return previous;
    let ownedPortal=null,inspectionTab=null,list;
    try{
      // A fresh portal also recovers from a stale/discarded logged-in tab.
      const opened=JSON.parse(await this.bridge.command('open','https://i.chaoxing.com/base?ws=3','--background','--json'));
      ownedPortal=String(opened.tabId);
      const deadline=Date.now()+20000;
      do{
        if(!active())throw new Error('自动发现已取消');
        list=JSON.parse(await this.bridge.command('eval',`(${inspectEnrollments.toString()})()`,'--world','MAIN','--tab',ownedPortal));
        if(list.loginRequired)return {waitingLogin:true};
        if(list.courses.length)break;
        await new Promise(resolve=>setTimeout(resolve,500));
      }while(Date.now()<deadline);
      if(!list.courses.length)return {waitingLogin:true};
      if(cached){
        const identities=new Set(list.courses.map(c=>c.cpi));
        if(identities.size!==1 || !identities.has(previous.cpi))throw new Error('当前登录账号与已保存课程队列不同，等待核验');
        return previous;
      }
      const candidates=list.courses.filter(c=>!c.ended);
      if(new Set(candidates.map(c=>c.cpi)).size>1)throw new Error('课程列表包含多个账号身份，等待核验');
      candidates.sort((a,b)=>Number(b.courseId===preferredCourseId)-Number(a.courseId===preferredCourseId));
      if(!candidates.length){const q={schemaVersion:1,courses:[],excluded:list.courses,status:'complete',at:new Date().toISOString()};this.save(q);return q;}
      const openedCourse=JSON.parse(await this.bridge.command('open',candidates[0].url,'--background','--json'));inspectionTab=String(openedCourse.tabId);
      const queue={schemaVersion:1,cpi:candidates[0].cpi,courses:[],excluded:list.courses.filter(c=>c.ended),status:'discovering',at:new Date().toISOString()};
      for(const course of candidates){
        if(!active())throw new Error('自动发现已取消');
        try{
          let dir;
          for(let attempt=0;attempt<3;attempt++){
            try{dir=await readCourseDirectory(this.bridge,inspectionTab,course,active);break;}
            catch(error){
              if(!active() || /登录|身份|核验/.test(String(error.message)) || attempt===2)throw error;
              await new Promise(resolve=>setTimeout(resolve,1000*2**attempt));
            }
          }
          const totals=[...new Set(dir.progress.map(p=>p.total))];
          queue.courses.push({...course,status:dir.chapters.length?'pending':'no-tasks',firstChapterId:dir.chapters[0]?.id,finalChapterId:dir.chapters.at(-1)?.id,
            expectedTasks:totals.length===1?totals[0]:null,initialProgress:dir.progress});
        }catch(error){
          if(!active())throw error;
          if(/需要登录或身份验证/.test(String(error.message)))return {waitingLogin:true};
          queue.courses.push({...course,status:'unavailable',reason:String(error.message).slice(0,300)});
        }
        this.save(queue);
      }
      if(!active())throw new Error('自动发现已取消');
      const ready=queue.courses.filter(c=>c.status==='pending');
      const config={schemaVersion:1,autoDiscovered:true,cpi:queue.cpi,courses:ready};
      const temp=this.configPath+'.tmp';writeFileSync(temp,JSON.stringify(config,null,2),{mode:0o600});renameSync(temp,this.configPath);
      queue.status=ready.length?'ready':'complete-with-unresolved';this.save(queue);return queue;
    }finally{
      for(const tab of [inspectionTab,ownedPortal].filter(Boolean))try{await this.bridge.command('close',tab)}catch{}
    }
  }
}
