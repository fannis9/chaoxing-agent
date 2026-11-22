import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {requestModel,probeModel,validateModel} from '../lib/model-client.mjs';
let failImage=false;
function verifyPng(raw){
 const match=raw.match(/data:image\/png;base64,([A-Za-z0-9+/=]+)/);
 if(!match)return;
 const png=Buffer.from(match[1],'base64');
 assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
 for(let offset=8;offset<png.length;){
  const length=png.readUInt32BE(offset),end=offset+8+length;
  let crc=0xffffffff;
  for(const byte of png.subarray(offset+4,end)){
   crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);
  }
  assert.equal((crc^0xffffffff)>>>0,png.readUInt32BE(end),'probe PNG chunk CRC must be valid');
  offset=end+4;
 }
}
const server=createServer(async(req,res)=>{
 let raw='';for await(const chunk of req)raw+=chunk;
 const data=JSON.parse(raw),chat=req.url.endsWith('/chat/completions');
 assert.equal(req.headers.authorization,'Bearer test-only');
 verifyPng(raw);
 if(failImage && raw.includes('data:image')){res.writeHead(400);res.end();return;}
 const text=data.text?.format || data.response_format ? '{"ok":true}' : 'OK';
 res.setHeader('Content-Type','application/json');
 res.end(JSON.stringify(chat?{id:'chat',choices:[{finish_reason:'stop',message:{content:text}}],usage:{prompt_tokens:3,completion_tokens:2}}:
 {id:'resp',status:'completed',output:[{content:[{type:'output_text',text}]}],usage:{input_tokens:3,output_tokens:2}}));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
process.env.CX_TEST_MODEL_KEY='test-only';
try {
 const config={id:'mock',keyEnv:'CX_TEST_MODEL_KEY',baseUrl:`http://127.0.0.1:${server.address().port}/v1`};
 for(const protocol of ['responses','chat-completions']) {
   const result=await requestModel({...config,protocol},{input:'Reply OK'});
   assert.equal(result.text,'OK');assert.deepEqual(result.usage,{inputTokens:3,outputTokens:2});
   assert.equal((await probeModel({...config,protocol})).ok,true);
 }
 failImage=true;const partial=await probeModel(config);
 assert.equal(partial.ok,false);assert.equal(partial.results[2].ok,false);assert.equal(partial.results[1].ok,true);
 assert.throws(()=>validateModel({...config,baseUrl:'https://user:secret@example.com'}),/凭据/);
 assert.throws(()=>validateModel({...config,protocol:'unknown'}),/协议/);
 console.log('PASS: both model adapters, capability failures, token accounting and endpoint validation');
}finally{delete process.env.CX_TEST_MODEL_KEY;await new Promise(resolve=>server.close(resolve));}
