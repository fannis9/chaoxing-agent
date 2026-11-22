import {createHash} from 'node:crypto';
import {readdirSync,readFileSync,writeFileSync,renameSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {QuizJournal} from './quiz-journal.mjs';

export class ReviewStore {
  constructor(directory){this.directory=directory;}
  read(key){
    if(!/^[a-f0-9]{16}$/.test(key || ''))throw new Error('报告编号无效');
    const raw=readFileSync(join(this.directory,`quiz-${key}.json`),'utf8');
    if(raw.length>5_000_000)throw new Error('报告过大');
    const report=JSON.parse(raw),sourceHash=createHash('sha256').update(raw).digest('hex');
    let answer=null;
    try{answer=JSON.parse(readFileSync(join(this.directory,`answer-${key}.json`),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
    if(!Array.isArray(report.questions) || report.questions.length>100)throw new Error('题目报告无效');
    return {key,report,sourceHash,answer:answer?.sourceHash===sourceHash?answer:null};
  }
  list(){
    return readdirSync(this.directory).filter(name=>/^quiz-[a-f0-9]{16}\.json$/.test(name))
      .sort((a,b)=>statSync(join(this.directory,b)).mtimeMs-statSync(join(this.directory,a)).mtimeMs).slice(0,30)
      .map(name=>{try{const pair=this.read(name.slice(5,-5));return {key:pair.key,title:pair.report.title || '章节测验',
        status:pair.answer?.status || 'pending',count:pair.report.questions.length};}catch{return null;}}).filter(Boolean);
  }
  save({key,sourceHash,answers,acknowledgeMissing=false}){
    const pair=this.read(key);
    if(pair.sourceHash!==sourceHash)throw new Error('报告已更新，请重新载入后复核');
    const phase=new QuizJournal(this.directory).read(pair.report.id)?.phase;
    if(['submitting','submitted'].includes(phase))throw new Error('该测验可能已提交，请先在平台核验，不允许覆盖重试');
    if(!Array.isArray(answers) || answers.length!==pair.report.questions.length)throw new Error('请复核全部题目');
    const reviewed=pair.report.questions.map(question=>{
      const matching=answers.filter(answer=>answer.index===question.index);
      if(matching.length!==1)throw new Error('题目映射不一致');
      const values=matching[0].answerValues;
      if(!Array.isArray(values) || !values.length || values.some(value=>typeof value!=='string' || !value.trim() || value.length>4000))
        throw new Error(`第 ${question.index} 题答案为空或格式无效`);
      const issues=question.captureIssues || [];
      if(issues.some(issue=>!['image-not-embedded','font-unavailable'].includes(issue)))throw new Error('题目控件不完整，需重新读取页面');
      if(issues.length && !acknowledgeMissing)throw new Error('请确认已在原页面核对缺失素材');
      const kind=question.control?.kind;
      if(kind==='choice'){
        if(values.some(value=>!question.options?.some(option=>option.value===value)) || new Set(values).size!==values.length)
          throw new Error(`第 ${question.index} 题选项无效`);
        if(/单选|判断/.test(question.type || '') && values.length!==1)throw new Error('单选题只能选择一个选项');
      }else if(kind==='fill'){
        if(values.length!==question.control.blankCount)throw new Error('填空答案数量不符');
      }else if(kind==='editor'){
        if(values.length!==1)throw new Error('简答题需要一个答案');
      }else throw new Error('题目控件不支持');
      return {index:question.index,questionId:question.questionId,answerValues:values,confidence:'high',needsReview:false,
        explanation:'用户已在控制台复核',reviewedSourceHash:sourceHash,captureAcknowledged:Boolean(acknowledgeMissing)};
    });
    const answer={schemaVersion:1,kind:'answer-proposal',reportId:pair.report.id,sourceHash,answers:reviewed,
      status:'ready',model:pair.answer?.model || 'human-review',humanReviewed:true,createdAt:new Date().toISOString()};
    const path=join(this.directory,`answer-${key}.json`),temp=`${path}.${process.pid}.tmp`;
    writeFileSync(temp,JSON.stringify(answer,null,2),{mode:0o600});renameSync(temp,path);
    return {reportId:pair.report.id,status:'ready'};
  }
}
