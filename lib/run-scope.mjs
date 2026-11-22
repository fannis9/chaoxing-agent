import {spawn} from 'node:child_process';

// Cooperative IPC works on Windows too; OS signals are only the bounded fallback.
export class RunScope {
  aborted = false;
  children = new Set();
  assertActive() { if(this.aborted) throw new Error('任务已取消'); }
  async drain() {
    await Promise.all([...this.children].map(child=>new Promise(resolve=>child.once('close',resolve))));
  }
  track(child) {
    this.children.add(child);
    child.once('close',()=>this.children.delete(child));
    return child;
  }
  cancel() {
    if(this.aborted) return;
    this.aborted=true;
    for(const child of this.children) {
      if(child.connected) child.send({type:'cancel'},()=>{});
      else child.kill();
      const timeout=setTimeout(()=>{if(this.children.has(child))child.kill('SIGKILL');},3000);
      timeout.unref();
      child.once('close',()=>clearTimeout(timeout));
    }
  }
  exec(file,args,{timeout=20000,maxBuffer=4*1024*1024,env=process.env}={}) {
    this.assertActive();
    return new Promise((resolve,reject)=>{
      const child=this.track(spawn(file,args,{env,windowsHide:true,stdio:['ignore','pipe','pipe','ipc']}));
      let stdout='',stderr='',failure;
      let forceTimer;
      const terminate=error=>{
        if(failure)return;
        failure=error;
        if(child.connected)child.send({type:'cancel'},()=>{});
        child.kill();
        forceTimer=setTimeout(()=>{if(this.children.has(child))child.kill('SIGKILL');},3000);
        forceTimer.unref();
      };
      const timer=setTimeout(()=>terminate(new Error('任务执行超时')),timeout);
      const capture=key=>chunk=>{
        if(failure)return;
        if(key==='stdout')stdout+=chunk;else stderr+=chunk;
        if(Buffer.byteLength(stdout)+Buffer.byteLength(stderr)>maxBuffer)terminate(new Error('子进程输出超限'));
      };
      child.stdout.on('data',capture('stdout'));child.stderr.on('data',capture('stderr'));
      child.once('error',error=>{failure=error;});
      child.once('close',code=>{
        clearTimeout(timer);
        clearTimeout(forceTimer);
        if(this.aborted)reject(new Error('任务已取消'));
        else if(failure)reject(failure);
        else if(code!==0)reject(new Error(stderr || `子进程退出：${code}`));
        else resolve({stdout,stderr});
      });
    });
  }
}
export function bindCancellation(scope) {
  const cancel=()=>scope.cancel();
  process.on('SIGINT',cancel);process.on('SIGTERM',cancel);
  process.on('message',message=>{if(message?.type==='cancel')cancel();});
  if(process.connected)process.on('disconnect',cancel);
}
