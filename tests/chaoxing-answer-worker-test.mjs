import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {existsSync, mkdtempSync, readFileSync, statSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'cx-answer-worker-'));
const reportPath = join(dir, 'quiz-0123456789abcdef.json');
const report = {schemaVersion:1, kind:'quiz', id:'course:chapter:job', title:'测试',
  questions:[{index:1, questionId:'123', type:'单选题', heading:'1+1=?', text:'1+1=?',
    options:[{label:'A',value:'A',text:'1'},{label:'B',value:'B',text:'2'}],
    control:{kind:'choice',answerFieldId:'answer123'}, images:[], captureIssues:[]}]};
writeFileSync(reportPath, JSON.stringify(report));

let calls = 0;
let requestBody;
let invalid = false;
const server = createServer(async (req, res) => {
  calls++;
  assert.equal(req.url, '/v1/responses');
  assert.equal(req.headers.authorization, 'Bearer test-only');
  let raw = '';
  for await (const chunk of req) raw += chunk;
  requestBody = JSON.parse(raw);
  const answers = {answers:[{index:1, questionId:'123', answerValues:[invalid ? 'C' : 'B'],
    confidence:'high', explanation:'1+1=2'}]};
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({id:'resp_test', status:'completed',
    output:[{type:'message', content:[{type:'output_text', text:JSON.stringify(answers)}]}]}));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

async function run(extra = {}, args = []) {
  const child = spawn(process.execPath,
    [new URL('../chaoxing-answer-worker.mjs', import.meta.url).pathname, '--once', ...args],
    {env:{...process.env, CX_QUIZ_REPORT_DIR:dir, CX_OPENAI_BASE_URL:`http://127.0.0.1:${server.address().port}/v1`,
      OPENAI_API_KEY:'test-only', ...extra}});
  let out = '', err = '';
  child.stdout.on('data', chunk => out += chunk);
  child.stderr.on('data', chunk => err += chunk);
  const code = await new Promise(resolve => child.on('close', resolve));
  return {code, out, err};
}

try {
  const first = await run();
  assert.equal(first.code, 0, first.err);
  assert.equal(JSON.parse(first.out).event, 'answer-proposal');
  assert.equal(requestBody.model, 'gpt-6.1-sol');
  assert.equal(requestBody.store, false);
  assert.equal(requestBody.text.format.type, 'json_schema');
  const answerPath = join(dir, 'answer-0123456789abcdef.json');
  assert(existsSync(answerPath));
  const saved = JSON.parse(readFileSync(answerPath, 'utf8'));
  assert.equal(saved.status, 'ready');
  assert.deepEqual(saved.answers[0].answerValues, ['B']);
  assert.equal(statSync(answerPath).mode & 0o777, 0o600);

  const repeat = await run();
  assert.equal(repeat.code, 0, repeat.err);
  assert.equal(calls, 1, 'unchanged report should not call model twice');

  const selected = await run({CX_ANSWER_MODEL:'env-model', CX_OPENAI_BASE_URL:'https://invalid.invalid/v1',
    MY_TEST_API_KEY:'test-only', OPENAI_API_KEY:''},
    ['--model=chosen-model', `--base-url=http://127.0.0.1:${server.address().port}/v1`,
      '--api-key-env=MY_TEST_API_KEY']);
  assert.equal(selected.code, 0, selected.err);
  assert.equal(requestBody.model, 'chosen-model');
  assert.equal(JSON.parse(readFileSync(answerPath, 'utf8')).model, 'chosen-model');
  assert.equal(calls, 2, 'changing model should request a new answer');

  const selectedRepeat = await run({CX_ANSWER_MODEL:'env-model'}, ['--model=chosen-model']);
  assert.equal(selectedRepeat.code, 0, selectedRepeat.err);
  assert.equal(calls, 2);

  report.questions[0].heading = '再次计算 1+1';
  writeFileSync(reportPath, JSON.stringify(report));
  invalid = true;
  const rejected = await run();
  assert.notEqual(rejected.code, 0);
  assert.match(rejected.err, /选项值无效/);
  assert.equal(JSON.parse(readFileSync(answerPath, 'utf8')).sourceHash, saved.sourceHash,
    'invalid model output must not replace a good answer');
  console.log(JSON.stringify({worker:'verified', deduplicated:true, modelSelectable:true, invalidRejected:true}));
} finally { await new Promise(resolve => server.close(resolve)); }
