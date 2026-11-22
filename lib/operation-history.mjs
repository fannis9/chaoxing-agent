import {readFileSync} from 'node:fs';
import {join} from 'node:path';
export function operationHistory(directory){
  const rows=[];
  for(const name of ['recovery-events.jsonl','skipped-quizzes.jsonl'])for(const suffix of ['.3','.2','.1','']){
    let text;try{text=readFileSync(join(directory,name+suffix),'utf8');}catch{continue;}
    for(const line of text.split('\n'))try{
      const r=JSON.parse(line);
      rows.push({at:r.at,courseId:r.courseId,chapterId:r.chapterId,action:r.action || 'skip',
        reason:r.reason || '',source:r.source || 'policy',
        result:r.status==='deferred'?(r.courseBoundary?'已记录待补做，进入课程审计':'已进入下一节'):r.status==='skip-intent'?'准备跳过':'已选择动作，等待后续核验'});
    }catch{}
  }
  return rows.sort((a,b)=>String(b.at).localeCompare(String(a.at))).slice(0,50);
}
