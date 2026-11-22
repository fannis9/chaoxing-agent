import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const dir=mkdtempSync(join(tmpdir(),'cx-console-auth-'));
const child=spawn(process.execPath,[fileURLToPath(new URL('../chaoxing-console.mjs',import.meta.url))],
  {env:{...process.env,CX_CONSOLE_PORT:'0',CX_QUIZ_REPORT_DIR:dir},stdio:['ignore','pipe','pipe']});
const exited=new Promise(resolve=>child.once('exit',resolve));
let output='';
try {
  const port=await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(new Error('console startup timeout')),10000);
    child.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/127\.0\.0\.1:(\d+)/);
      if(match){clearTimeout(timeout);resolve(match[1]);}});
    child.once('error',reject);
  });
  const url=`http://127.0.0.1:${port}`;
  const token=readFileSync(join(dir,'console-token'),'utf8');
  const headers={'X-CX-Console':'1',Origin:`chrome-extension://${'a'.repeat(32)}`};
  assert.equal((await fetch(url+'/status',{headers})).status,401);
  assert.equal((await fetch(url+'/status',{headers:{...headers,Authorization:'Bearer wrong'}})).status,401);
  const authorized={...headers,Authorization:`Bearer ${token}`};
  const status=await fetch(url+'/status',{headers:authorized});
  assert.equal(status.status,200);
  assert(!(await status.text()).includes(token),'status must not leak credentials');
  const noOrigin={'X-CX-Console':'1','X-CX-Extension-Version':'0.3.3',Authorization:`Bearer ${token}`};
  const observed=await (await fetch(url+'/status',{headers:noOrigin})).json();
  assert.equal(observed.extensionClient.version,'0.3.3');
  assert.equal(observed.extensionClient.id,null,'version header cannot prove extension identity');
  assert.equal(observed.extensionClient.identification,'version-header');
  assert.equal((await fetch(url+'/status',{headers:{...noOrigin,Authorization:'Bearer wrong'}})).status,401);
  assert.equal((await fetch(url+'/status',{headers:{...authorized,Origin:'https://evil.example'}})).status,403);
  assert.equal((await fetch(url+'/control',{method:'POST',headers,body:'{"action":"start"}'})).status,401);
  console.log('PASS: console rejects unauthenticated control, wrong token and web origins');
} finally {child.kill();await exited;}
