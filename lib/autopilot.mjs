// Durable intent is separate from transient process state. Manual pause wins.
export function initialAutomation(previous={},enabled=false){
  return {enabled,userPaused:false,status:'waiting',retryAt:0,failures:0,lastError:'',...previous};
}
export class Autopilot {
  busy=false;
  revision=0;
  constructor(state,hooks){this.state=state;this.hooks=hooks;}
  async persist(){await this.hooks.save(this.state);}
  async failed(error){
    const s=this.state;if(!s.enabled || s.userPaused || s.status==='complete')return;
    const now=this.hooks.now?.() ?? Date.now();
    s.failures=(s.failures || 0)+1;s.status='retrying';
    s.lastError=String(error.message || error).slice(0,400);
    s.retryAt=now+Math.min(300000,5000*2**Math.min(s.failures-1,6));
    await this.persist();
  }
  async setIntent(enabled,userPaused=false){
    this.revision++;
    Object.assign(this.state,{enabled,userPaused,status:!enabled?'disabled':userPaused?'paused':'waiting',retryAt:0,failures:0,lastError:''});
    await this.persist();
  }
  async tick(){
    const s=this.state,h=this.hooks,now=h.now?.() ?? Date.now();
    if(this.busy || !s.enabled || s.userPaused || s.status==='complete' || now<s.retryAt)return;
    this.busy=true;const revision=this.revision;
    const current=()=>revision===this.revision && s.enabled && !s.userPaused;
    try{
      if(h.running()) {s.status='running';if(s.launchedAt && now-s.launchedAt>60000)s.failures=0;return;}
      const ready=await h.prepare(current);
      if(!current())return;
      if(!ready || ready.wait){s.status=ready?.wait || 'waiting-login';s.retryAt=now+10000;return;}
      if(ready.complete){s.status='complete';s.summary=ready.summary;return;}
      await h.launch(ready,current);
      if(!current())return;
      Object.assign(s,{status:'running',launchedAt:now,retryAt:0,lastError:''});
    }catch(error){
      if(current()){
        s.failures=(s.failures || 0)+1;s.status='retrying';
        s.lastError=String(error.message || error).slice(0,400);
        s.retryAt=now+Math.min(300000,5000*2**Math.min(s.failures-1,6));
      }
    }finally{this.busy=false;await this.persist();}
  }
}
