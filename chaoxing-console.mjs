#!/usr/bin/env node
import {createServer} from 'node:http';
import {spawn, execFile} from 'node:child_process';
import {readFileSync, writeFileSync, existsSync, mkdirSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';

const root = dirname(fileURLToPath(import.meta.url));
const dataDir = join(root, 'quiz-reports');
const statePath = join(dataDir, 'console-state.json');
const port = Number(process.env.CX_CONSOLE_PORT || 8788);
const allowedOrigin = /^chrome-extension:\/\/[a-z]{32}$/;
const initial = {mode:'stopped', model:{name:'默认模型', id:process.env.CX_ANSWER_MODEL || '',
  baseUrl:process.env.CX_OPENAI_BASE_URL || '', keyEnv:process.env.CX_ANSWER_API_KEY_ENV || 'OPENAI_API_KEY'},
  messages:[], updatedAt:new Date().toISOString()};
let state = initial;
try { state = {...initial, ...JSON.parse(readFileSync(statePath, 'utf8'))}; } catch {}
if (state.mode === 'running' || state.mode === 'pausing') state.mode = 'stopped';
let child = null;
let stopping = false;
let outputBuffer = '';
let errorBuffer = '';
const exec = promisify(execFile);

function save() {
  mkdirSync(dataDir, {recursive:true, mode:0o700});
  state.updatedAt = new Date().toISOString();
  writeFileSync(statePath, JSON.stringify(state, null, 2), {mode:0o600});
}
function launch() {
  if (child) return;
  const env = {...process.env, CX_ANSWER_MODEL:state.model.id,
    CX_OPENAI_BASE_URL:state.model.baseUrl, CX_ANSWER_API_KEY_ENV:state.model.keyEnv};
  child = spawn(process.execPath, [join(root, 'chaoxing-auto.mjs')],
    {cwd:root,env,stdio:['ignore','pipe','pipe']});
  state.mode = 'running';
  state.error = '';
  save();
  child.stdout.on('data', chunk => {
    outputBuffer += String(chunk);
    const lines = outputBuffer.split('\n');
    outputBuffer = lines.pop();
    for (const line of lines) {
      try { const event = JSON.parse(line); state.event = event; save(); } catch {}
    }
  });
  child.stderr.on('data', chunk => {
    errorBuffer = (errorBuffer + String(chunk)).slice(-2000);
    state.error = errorBuffer;
    save();
  });
  child.on('exit', code => {
    child = null;
    if (!stopping) {
      state.mode = 'stopped';
      state.error = `${errorBuffer || '控制进程退出'}（代码 ${code}）`.slice(-2000);
    }
    stopping = false;
    save();
  });
}
async function halt(mode) {
  const tab = state.event?.tab;
  if (tab) {
    const bridge = process.env.CX_PAGE_BRIDGE || '/home/fannis/dsh_workspace/pagebridge/page.mjs';
    try {
      await exec(process.execPath,[bridge,'eval','window.__cxV3?.stop(); true','--world','MAIN','--tab',String(tab)],
        {timeout:10000});
    } catch (error) { state.error = `页面停止指令未确认：${error.message}`.slice(0,500); }
  }
  if (child) {
    stopping = true;
    child.kill('SIGTERM');
    await new Promise(resolve => child?.once('exit', resolve) || resolve());
  }
  state.mode = mode;
  save();
}
function json(response, status, data) {
  response.writeHead(status, {'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':'no-store'});
  response.end(JSON.stringify(data));
}
async function body(request) {
  let raw = '';
  for await (const part of request) {
    raw += part;
    if (raw.length > 100000) throw new Error('请求过大');
  }
  return raw ? JSON.parse(raw) : {};
}
async function modelCall(input) {
  const {baseUrl,id,keyEnv} = state.model;
  const key = process.env[keyEnv];
  if (!key) throw new Error(`缺少模型密钥变量 ${keyEnv}`);
  const endpoint = new URL(baseUrl);
  if (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && ['localhost','127.0.0.1'].includes(endpoint.hostname)))
    throw new Error('模型接口地址无效');
  const response = await fetch(`${baseUrl.replace(/\/$/,'')}/responses`, {method:'POST',
    headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},
    body:JSON.stringify({model:id,store:false,input}),signal:AbortSignal.timeout(60000)});
  if (!response.ok) throw new Error(`模型接口 HTTP ${response.status}`);
  const result = await response.json();
  return (result.output || []).flatMap(item => item.content || [])
    .filter(item => item.type === 'output_text').map(item => item.text).join('');
}
const server = createServer(async (request,response) => {
  const origin = request.headers.origin || '';
  if (!allowedOrigin.test(origin) ||
      (request.method !== 'OPTIONS' && request.headers['x-cx-console'] !== '1')) {
    json(response,403,{error:'扩展来源无效'}); return;
  }
  response.setHeader('Access-Control-Allow-Origin',origin);
  response.setHeader('Vary','Origin');
  response.setHeader('Access-Control-Allow-Headers','Content-Type, X-CX-Console');
  response.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Private-Network','true');
  if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
  try {
    const route = new URL(request.url,'http://localhost').pathname;
    if (route === '/status' && request.method === 'GET') {
      json(response,200,{...state,connected:true,keyConfigured:Boolean(process.env[state.model.keyEnv]),pid:child?.pid || null}); return;
    }
    if (request.method !== 'POST') { json(response,404,{error:'未知接口'}); return; }
    const input = await body(request);
    if (route === '/control') {
      if (input.action === 'start' || input.action === 'resume') launch();
      else if (input.action === 'pause') await halt('paused');
      else if (input.action === 'stop') await halt('stopped');
      else throw new Error('未知操作');
      json(response,200,{mode:state.mode}); return;
    }
    if (route === '/model') {
      if (child) throw new Error('请先暂停运行再切换模型');
      const next = {name:String(input.name || input.id || '').slice(0,80),
        id:String(input.id || ''),baseUrl:String(input.baseUrl || ''),keyEnv:String(input.keyEnv || '')};
      if (!/^[A-Za-z0-9._:/-]{1,200}$/.test(next.id) || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(next.keyEnv))
        throw new Error('模型配置格式无效');
      new URL(next.baseUrl);
      state.model = next; save(); json(response,200,{model:next}); return;
    }
    if (route === '/test-model') {
      const text = await modelCall('请回复 OK');
      json(response,200,{ok:Boolean(text),text:text.slice(0,100)}); return;
    }
    if (route === '/chat') {
      const question = String(input.text || '').slice(0,10000);
      if (!question) throw new Error('消息为空');
      const answer = await modelCall([...state.messages.slice(-12).map(message => ({role:message.role,content:message.text})),
        {role:'user',content:question}]);
      state.messages.push({role:'user',text:question},{role:'assistant',text:answer});
      state.messages = state.messages.slice(-40); save();
      json(response,200,{answer}); return;
    }
    if (route === '/clear-chat') {
      state.messages = []; save(); json(response,200,{ok:true}); return;
    }
    json(response,404,{error:'未知接口'});
  } catch (error) { json(response,400,{error:String(error.message || error)}); }
});
save();
server.listen(port,'127.0.0.1',() => console.log(`学习通控制台监听 127.0.0.1:${port}`));
