import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,renameSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
const stages=new Set(['solving','ready','filling','filled','submitting','submitted','needs-review']);
export class QuizJournal {
  constructor(directory) {this.directory=directory;}
  path(id) {return join(this.directory,`phase-${createHash('sha256').update(id).digest('hex').slice(0,32)}.json`);}
  read(id) {
    let raw;try{raw=readFileSync(this.path(id),'utf8');}catch(error){if(error.code==='ENOENT')return null;throw error;}
    const state=JSON.parse(raw);
    if(state.schemaVersion!==1 || state.reportId!==id || !stages.has(state.phase))throw new Error('测验阶段记录损坏，需要人工检查');
    return state;
  }
  write(reportId,phase,extra={}) {
    if(!stages.has(phase))throw new Error('未知测验阶段');
    mkdirSync(this.directory,{recursive:true,mode:0o700});
    const path=this.path(reportId),temp=`${path}.${process.pid}.tmp`;
    writeFileSync(temp,JSON.stringify({...extra,schemaVersion:1,reportId,phase,at:new Date().toISOString()},null,2),{mode:0o600});
    renameSync(temp,path);
  }
}
