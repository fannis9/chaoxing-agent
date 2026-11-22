import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
for(const args of [['--deferred'],['--complete'],['--complete','--deferred'],['--recover']]){
 const r=spawnSync(process.execPath,[fileURLToPath(new URL('./chaoxing-schedule-test.mjs',import.meta.url)),...args],{encoding:'utf8',timeout:20000});
 assert.equal(r.status,0,`${args.join(' ')}: ${r.stderr} ${r.stdout}`);
}
console.log('PASS: deferred last chapter, final completion, unresolved summary and interrupted course audit recovery');
