import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {bridgePath} from './config.mjs';

export class BridgeClient {
  constructor(execute=promisify(execFile)) {this.execute=execute;}
  async command(...args) {
    const {stdout}=await this.execute(process.execPath,[bridgePath,...args],
      {timeout:20000,maxBuffer:4*1024*1024,windowsHide:true});
    return stdout.trim();
  }
  async tabs() {
    let raw;
    try{raw=await this.command('tabs','--json');}
    catch(error){
      // Older Page Bridge versions require an active tab even for enumeration.
      if(String(error.stderr || error.message).includes('找不到目标标签页：完全接管模式下默认用当前活动标签页'))return [];
      throw error;
    }
    let tabs;
    try {tabs=JSON.parse(raw);} catch {
      throw new Error('Page Bridge 不支持 tabs --json，请更新桥接 CLI 后重试');
    }
    if(!Array.isArray(tabs) || tabs.some(tab=>!Number.isSafeInteger(tab.id) || tab.id<0 || typeof tab.url!=='string'))
      throw new Error('Page Bridge 标签协议不兼容：需要含整数 id 和字符串 url 的数组');
    return tabs.map(tab=>({...tab,id:String(tab.id)}));
  }
  async url(tab) {return (await this.tabs()).find(row=>row.id===String(tab))?.url || '';}
}
