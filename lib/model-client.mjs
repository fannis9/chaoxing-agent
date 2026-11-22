export function validateModel(config) {
  if(!/^[A-Za-z0-9._:/-]{1,200}$/.test(config.id || ''))throw new Error('模型 ID 格式无效');
  if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(config.keyEnv || ''))throw new Error('密钥变量名无效');
  const url=new URL(config.baseUrl);
  if(url.username || url.password || url.search || url.hash ||
    (url.protocol!=='https:' && !(url.protocol==='http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname))))
    throw new Error('模型地址需使用 HTTPS 或本机 HTTP，且不能包含凭据、查询参数或片段');
  if(!['responses','chat-completions'].includes(config.protocol || 'responses'))throw new Error('模型协议不支持');
  return url;
}

export async function requestModel(config,{input,instructions,schema,name='result',timeout=60000,signal}={}) {
  const url=validateModel(config);
  const key=process.env[config.keyEnv];
  if(!key)throw new Error(`缺少模型密钥变量 ${config.keyEnv}`);
  const protocol=config.protocol || 'responses';
  const strict=config.strict ?? url.hostname!=='api.deepseek.com';
  const format=schema ? {type:'json_schema',name,schema,...(strict?{strict:true}:{})} : null;
  let body,path;
  if(protocol==='responses') {
    path='responses';body={model:config.id,store:false,input,...(instructions?{instructions}:{}),...(format?{text:{format}}:{})};
  } else {
    const entries=typeof input==='string'?[{role:'user',content:input}]:input;
    const messages=entries.map(entry=>({...entry,content:typeof entry.content==='string'?entry.content:entry.content.map(part=>{
      if(part.type==='input_text')return {type:'text',text:part.text};
      if(part.type==='input_image')return {type:'image_url',image_url:{url:part.image_url}};
      throw new Error('模型输入类型不支持');
    })}));
    if(instructions)messages.unshift({role:'system',content:instructions});
    path='chat/completions';body={model:config.id,messages,stream:false,
      ...(format?{response_format:{type:'json_schema',json_schema:{name,schema,...(strict?{strict:true}:{})}}}:{})};
  }
  const started=Date.now();
  const response=await fetch(`${config.baseUrl.replace(/\/$/,'')}/${path}`,{method:'POST',redirect:'error',
    headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify(body),
    signal:signal?AbortSignal.any([signal,AbortSignal.timeout(timeout)]):AbortSignal.timeout(timeout)});
  if(!response.ok)throw new Error(`模型接口 HTTP ${response.status}`);
  const data=await response.json();
  let text;
  if(protocol==='responses') {
    if(data.status!=='completed')throw new Error(`模型响应未完成：${data.status || 'unknown'}`);
    text=(data.output || []).flatMap(item=>item.content || []).filter(item=>item.type==='output_text').map(item=>item.text).join('');
  } else {
    const choice=data.choices?.[0];
    if(choice?.finish_reason!=='stop')throw new Error(`模型响应未完成：${choice?.finish_reason || 'unknown'}`);
    text=choice.message?.content;
  }
  if(typeof text!=='string' || !text.trim())throw new Error('模型未返回文本');
  const usage=data.usage || {};
  const finite=value=>Number.isSafeInteger(value) && value>=0?value:null;
  return {text,responseId:data.id || '',durationMs:Date.now()-started,
    usage:{inputTokens:finite(usage.input_tokens ?? usage.prompt_tokens),outputTokens:finite(usage.output_tokens ?? usage.completion_tokens)}};
}

export async function probeModel(config) {
  const results=[];
  const probe=async(name,options,verify)=>{
    try{const result=await requestModel(config,{...options,timeout:18000});
      if(verify && !verify(result.text))throw new Error('返回内容未通过能力校验');
      results.push({name,ok:true,durationMs:result.durationMs,usage:result.usage});
    }catch(error){results.push({name,ok:false,error:String(error.message).slice(0,300)});}
  };
  await probe('text',{input:'Reply OK.'},text=>text.includes('OK'));
  await probe('structured',{input:'Return JSON with ok true.',schema:{type:'object',additionalProperties:false,required:['ok'],properties:{ok:{type:'boolean'}}}},text=>JSON.parse(text).ok===true);
  await probe('image-input',{input:[{role:'user',content:[{type:'input_text',text:'An image is attached. Reply OK.'},
    {type:'input_image',image_url:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAJklEQVR4nO3NMQ0AAAwDoPo33anosQQMkI5FIBAIBAKBQCAQ9Elwi1X0pql03eYAAAAASUVORK5CYII='}]}]},text=>text.includes('OK'));
  return {ok:results.every(result=>result.ok),results,at:new Date().toISOString(),note:'图片检测仅确认接口接受图片输入，不代表解题准确率。'};
}
