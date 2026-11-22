import {appendFileSync,existsSync,lstatSync,mkdirSync,readdirSync,readFileSync,realpathSync,renameSync,statSync,unlinkSync} from 'node:fs';
import {basename,dirname,join,resolve} from 'node:path';
import {QuizJournal} from './quiz-journal.mjs';

export function appendRotating(path,line,{maxBytes=5*1024*1024,backups=3}={}){
  mkdirSync(dirname(path),{recursive:true,mode:0o700});
  if(existsSync(path) && statSync(path).size+Buffer.byteLength(line)>maxBytes){
    if(existsSync(`${path}.${backups}`))unlinkSync(`${path}.${backups}`);
    for(let i=backups-1;i>=1;i--)if(existsSync(`${path}.${i}`))renameSync(`${path}.${i}`,`${path}.${i+1}`);
    renameSync(path,`${path}.1`);
  }
  appendFileSync(path,line,{mode:0o600});
}

export function archivePlan(directory,days=30,now=Date.now()){
  if(!Number.isInteger(days) || days<1 || days>3650)throw new Error('保留天数应为 1–3650');
  const cutoff=now-days*86400000,journal=new QuizJournal(directory),files=[];
  for(const name of readdirSync(directory)){
    if(!/^quiz-[a-f0-9]{16}\.json$/.test(name))continue;
    const path=join(directory,name);
    if(lstatSync(path).isSymbolicLink() || statSync(path).mtimeMs>=cutoff)continue;
    let report;try{report=JSON.parse(readFileSync(path,'utf8'));if(journal.read(report.id)?.phase!=='submitted')continue;}catch{continue;}
    const key=name.slice(5,-5);
    for(const candidate of [`quiz-${key}.json`,`quiz-${key}.html`,`quiz-${key}.png`,`answer-${key}.json`,`fill-${key}.json`,`quiz-${key}-questions`]){
      const target=join(directory,candidate);
      if(existsSync(target) && !lstatSync(target).isSymbolicLink())files.push(candidate);
    }
  }
  return {days,files};
}
export function archiveReports(directory,days=30){
  const root=realpathSync(directory),plan=archivePlan(root,days);
  if(!plan.files.length)return {count:0,archive:null};
  const archive=join(root,'archive');
  if(existsSync(archive) && (lstatSync(archive).isSymbolicLink() || realpathSync(archive)!==resolve(archive)))throw new Error('归档目录无效');
  mkdirSync(archive,{recursive:true,mode:0o700});
  const folder=join(archive,`${Date.now()}-${process.pid}`);mkdirSync(folder,{mode:0o700});
  for(const file of plan.files){
    const source=join(root,file);
    if(dirname(source)!==root || basename(source)!==file || lstatSync(source).isSymbolicLink())throw new Error('归档路径无效');
    renameSync(source,join(folder,file));
  }
  return {count:plan.files.length,archive:basename(folder)};
}
export function diagnostics(directory,state={}){
  const files=readdirSync(directory).filter(name=>!lstatSync(join(directory,name)).isSymbolicLink());
  return {schemaVersion:1,at:new Date().toISOString(),platform:process.platform,node:process.version,
    mode:state.mode || 'unknown',modelProtocol:state.model?.protocol || 'responses',
    keyConfigured:Boolean(process.env[state.model?.keyEnv || 'OPENAI_API_KEY']),
    reportCount:files.filter(name=>/^quiz-[a-f0-9]{16}\.json$/.test(name)).length,
    eventBytes:files.filter(name=>/^(auto-)?events\.jsonl(?:\.\d+)?$/.test(name)).reduce((sum,name)=>sum+statSync(join(directory,name)).size,0),
    modelCapabilities:(state.modelCapabilities?.results || []).map(({name,ok})=>({name,ok})),
    note:'不含题目、答案、聊天、课程编号、文件路径、URL 或密钥。'};
}
