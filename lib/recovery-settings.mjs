export function recoverySettings(input={}){
 const result={videoLoadSeconds:60,videoStallSeconds:180,retryLimit:2,skipVideo:false,...input};
 for(const [key,min,max] of [['videoLoadSeconds',15,600],['videoStallSeconds',30,1800],['retryLimit',1,5]])
  if(!Number.isInteger(result[key]) || result[key]<min || result[key]>max)throw new Error(`${key} 必须为 ${min}–${max} 的整数`);
 if(typeof result.skipVideo!=='boolean')throw new Error('视频跳过开关无效');
 return Object.fromEntries(['videoLoadSeconds','videoStallSeconds','retryLimit','skipVideo'].map(k=>[k,result[k]]));
}
