let reviewPair=null;
const reviewInputs=new Map();
function showReview(pair){
  reviewPair=pair;reviewInputs.clear();
  $('reviewTitle').textContent=pair.report.title || '章节测验';
  $('reviewQuestions').replaceChildren();$('reviewAcknowledge').checked=false;
  for(const question of pair.report.questions){
    const section=document.createElement('fieldset');
    const legend=document.createElement('legend');legend.textContent=`第 ${question.index} 题 · ${question.type || ''}`;section.append(legend);
    const text=document.createElement('p');text.textContent=question.text || question.heading || '';section.append(text);
    for(const image of question.images || []){
      if(!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(image.dataUrl || '') || image.dataUrl.length>2_000_000)continue;
      const node=document.createElement('img');node.src=image.dataUrl;node.alt=image.alt || '题目图片';section.append(node);
    }
    const previous=pair.answer?.answers?.find(answer=>answer.index===question.index);
    const issue=document.createElement('p');issue.textContent=[...(question.captureIssues || []),previous?.explanation || ''].join(' · ');section.append(issue);
    const inputs=[];
    if(question.control?.kind==='choice'){
      for(const option of question.options || []){
        const label=document.createElement('label');label.className='check-line';
        const input=document.createElement('input');input.type=/单选|判断/.test(question.type || '')?'radio':'checkbox';
        input.name=`review-${question.index}`;input.value=option.value;input.checked=previous?.answerValues?.includes(option.value) || false;
        const caption=document.createElement('span');caption.textContent=`${option.label || option.value}：${option.text || ''}`;
        label.append(input,caption);section.append(label);inputs.push(input);
      }
    }else{
      const count=question.control?.kind==='fill'?Math.min(50,question.control.blankCount || 1):1;
      for(let i=0;i<count;i++){
        const label=document.createElement('label');label.textContent=count>1?`第 ${i+1} 空`:'答案';
        const input=document.createElement('textarea');input.rows=3;input.value=previous?.answerValues?.[i] || '';input.maxLength=4000;
        label.append(input);section.append(label);inputs.push(input);
      }
    }
    reviewInputs.set(question.index,{kind:question.control?.kind,inputs});$('reviewQuestions').append(section);
  }
  $('reviewEditor').hidden=false;
}
$('loadReviews').addEventListener('click',async()=>{
  try{
    const result=await control('/reviews');$('reviewList').replaceChildren();
    for(const item of result.items){
      const button=document.createElement('button');button.textContent=`${item.title} · ${item.count} 题 · ${item.status}`;
      button.addEventListener('click',async()=>{try{showReview(await control('/reviews/read',{key:item.key}));}
        catch(error){$('reviewMessage').textContent=error.message;}});$('reviewList').append(button);
    }
    $('reviewMessage').textContent=result.items.length?'请选择报告；复核草稿不会被状态刷新覆盖':'暂无报告';
  }catch(error){$('reviewMessage').textContent=error.message;}
});
$('saveReview').addEventListener('click',async()=>{
  if(!reviewPair)return;
  try{
    const answers=[...reviewInputs].map(([index,{kind,inputs}])=>({index,answerValues:kind==='choice'?inputs.filter(input=>input.checked).map(input=>input.value):inputs.map(input=>input.value)}));
    await control('/reviews/save',{key:reviewPair.key,sourceHash:reviewPair.sourceHash,answers,acknowledgeMissing:$('reviewAcknowledge').checked});
    $('reviewMessage').textContent='已保存人工复核；未操作页面。点击继续队列后会填写并提交。';
  }catch(error){$('reviewMessage').textContent=error.message;}
});
$('retryReview').addEventListener('click',async()=>{
  if(!reviewPair)return;
  try{await control('/reviews/retry',{key:reviewPair.key});$('reviewMessage').textContent='已请求重新处理当前测验，请查看任务状态';}
  catch(error){$('reviewMessage').textContent=error.message;}
});
$('deferReview').addEventListener('click',()=>{
  $('reviewEditor').hidden=true;$('reviewMessage').textContent='已收起，答案未改变；可稍后重新打开复核';
});
