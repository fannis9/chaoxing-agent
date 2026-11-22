// Discover only enrolled courses exposed by the logged-in site's own links.
export function inspectEnrollments(){
  const courses=new Map();let loginRequired=false;
  function walk(view,depth){
    if(depth>4)return;
    try{
      const doc=view.document;
      if(doc.querySelector('input[type="password"]'))loginRequired=true;
      for(const anchor of doc.querySelectorAll('a[href]')){
        let url;try{url=new URL(anchor.getAttribute('href'),doc.baseURI)}catch{continue}
        if(!/(^|\.)chaoxing\.com$/.test(url.hostname) || !/\/visit\/stucoursemiddle$/.test(url.pathname))continue;
        const courseId=url.searchParams.get('courseid'),clazzId=url.searchParams.get('clazzid'),cpi=url.searchParams.get('cpi');
        if(![courseId,clazzId,cpi].every(x=>/^\d+$/.test(x || '')))continue;
        const key=`${courseId}:${clazzId}`,text=(anchor.innerText || anchor.getAttribute('title') || '').trim();
        const row=courses.get(key) || {courseId,clazzId,cpi,url:url.href,name:'',ended:false};
        if(/课程已结束|已退课/.test(text))row.ended=true;
        else if(text)row.name=text.slice(0,200);
        courses.set(key,row);
      }
      for(const frame of doc.querySelectorAll('iframe'))walk(frame.contentWindow,depth+1);
    }catch{}
  }
  walk(window,0);
  return {loginRequired,courses:[...courses.values()]};
}

export function inspectDirectory(){
  const params=new URL(location.href).searchParams;
  const chapters=[...document.querySelectorAll('[id^="cur"]')].filter(n=>/^cur\d+$/.test(n.id))
    .map(n=>({id:n.id.slice(3),name:(n.querySelector('[title]')?.getAttribute('title') || n.innerText || '').trim().slice(0,200)}));
  const progress=[...(document.body?.innerText || '').matchAll(/已完成任务点\s*[:：]?\s*(\d+)\s*\/\s*(\d+)/g)]
    .map(m=>({done:Number(m[1]),total:Number(m[2])}));
  const old=String(window.toOld || '');
  const enc=old.match(/var\s+enc\s*=\s*["']([a-f0-9]+)["']/i)?.[1] || '';
  return {courseId:params.get('courseid') || params.get('courseId'),path:location.pathname,chapters,progress,enc,
    empty:/暂无章节|还没有章节|没有章节|暂无内容/.test(document.body?.innerText || ''),
    blocked:/验证码|人脸识别|身份核验|请.*登录/.test(document.body?.innerText || '')};
}

export async function readCourseDirectory(bridge,tab,course,active=()=>true){
  const assertActive=()=>{if(!active())throw new Error('自动发现已取消')};
  assertActive();await bridge.command('navigate',course.url,'--tab',String(tab));
  const deadline=Date.now()+30000;let directed=false;
  while(Date.now()<deadline){
    assertActive();
    const url=new URL(await bridge.url(String(tab)));
    if(/\/mycourse\/stu$/.test(url.pathname) && !directed){
      url.pathname=url.pathname.replace(/\/stu$/,'/studentcourse');
      await bridge.command('navigate',url.href,'--tab',String(tab));directed=true;
    }
    if(/\/mycourse\/studentcourse$/.test(url.pathname)){
      const result=JSON.parse(await bridge.command('eval',`(${inspectDirectory.toString()})()`,'--world','MAIN','--tab',String(tab)));
      if(result.blocked)throw new Error('课程目录需要登录或身份验证');
      if(result.courseId!==course.courseId)throw new Error('课程目录身份不匹配');
      if(result.chapters.length || result.empty)return result;
    }
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  throw new Error('课程目录加载超时');
}
