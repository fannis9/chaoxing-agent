// Pure read-only discovery; missing metadata must be confirmed by the user.
export function inspectCoursePage() {
  if(!/(^|\.)chaoxing\.com$/.test(location.hostname))throw new Error('请切换到学习通页面');
  const params=new URL(location.href).searchParams;
  const value=(...names)=>names.map(name=>params.get(name)).find(Boolean) || '';
  const chapters=[...document.querySelectorAll('[id^="cur"]')].filter(node=>/^cur\d+$/.test(node.id))
    .map(node=>({id:node.id.slice(3),name:(node.querySelector('[title]')?.getAttribute('title') || node.innerText || '').trim().slice(0,200)}));
  const totals=[...(document.body?.innerText || '').matchAll(/已完成任务点\s*[:：]?\s*(\d+)\s*\/\s*(\d+)/g)].map(match=>Number(match[2]));
  return {courseId:value('courseId','courseid') || document.getElementById('curCourseId')?.value || '',
    clazzId:value('clazzid','classId') || document.getElementById('curClazzId')?.value || '',
    cpi:value('cpi') || document.getElementById('curCpi')?.value || '',
    name:document.querySelector('.courseName')?.textContent?.trim() || document.title,
    chapters,expectedTasks:totals.length && new Set(totals).size===1 ? totals[0] : null};
}

export function inspectAutomationReadiness(){
  let requiresUser=false;
  const walk=(view,depth)=>{
    if(depth>5)return;
    try{
      const doc=view.document,text=doc.body?.innerText || '';
      if(doc.querySelector('input[type="password"]') || /操作异常，请输入|人脸识别|身份核验|请输入验证码|请先登录|登录已失效/.test(text))requiresUser=true;
      for(const frame of doc.querySelectorAll('iframe'))if(frame.getClientRects().length)walk(frame.contentWindow,depth+1);
    }catch{}
  };
  walk(window,0);
  return {courseId:new URL(location.href).searchParams.get('courseId'),requiresUser};
}
