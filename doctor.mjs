import {existsSync,readFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const envFile=join(dirname(fileURLToPath(import.meta.url)),'.env');
if(existsSync(envFile))process.loadEnvFile(envFile);
const {root,dataDir,bridgePath,browserPath}=await import('./lib/config.mjs');

const checks=[];
const add=(name,ok,detail)=>checks.push({name,ok,detail});
add('Node',Number(process.versions.node.split('.')[0])>=22,process.version);
add('Page Bridge',existsSync(bridgePath),bridgePath);
add('浏览器',Boolean(browserPath()),browserPath() || '请设置 CHROME_PATH');
add('模型密钥',Boolean(process.env[process.env.CX_ANSWER_API_KEY_ENV || 'OPENAI_API_KEY']),
  '仅检查是否配置，不输出密钥');
add('配对令牌文件',existsSync(join(dataDir,'console-token')),'只检查令牌文件存在；扩展是否已连接需查看侧栏连接状态');
const coursePath=process.env.CX_COURSE_CONFIG || join(root,'chaoxing-courses.json');
try {
  const courses=JSON.parse(readFileSync(coursePath,'utf8'));
  add('课程队列',courses.schemaVersion===1 && courses.courses?.length>0,`${courses.courses?.length || 0} 门课程`);
} catch {add('课程队列',false,'尚未配置；单课程模式可不提供队列');}
if(process.argv.includes('--bridge') && existsSync(bridgePath)) {
  const result=spawnSync(process.execPath,[bridgePath,'status','--no-autostart','--json'],
    {encoding:'utf8',timeout:15000,windowsHide:true});
  try {const status=JSON.parse(result.stdout);add('浏览器连接',Boolean(status.connected),
    status.connected ? '桥接已连接' : '请启动浏览器并检查 Page Bridge 授权');}
  catch {add('浏览器连接',false,'无法取得桥接状态，请检查本机服务');}
}
console.log(JSON.stringify({checks},null,2));
