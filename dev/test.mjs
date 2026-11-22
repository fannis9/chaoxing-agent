import {spawnSync} from 'node:child_process';
import {browserPath,root} from '../lib/config.mjs';
const tests=['operation-history-test.mjs','chaoxing-v3-smoke.cjs','chaoxing-quiz-control-test.mjs','chaoxing-schedule-test.mjs',
  'chaoxing-answer-worker-test.mjs','chaoxing-page-filler-test.cjs','chaoxing-auto-submit-test.cjs',
  'chaoxing-auto-discovery-test.mjs','chaoxing-extension-test.cjs','panel-refresh-test.cjs',
  'console-auth-test.mjs','run-scope-test.mjs','bridge-client-test.mjs','console-pause-test.mjs',
  'course-config-test.mjs','panel-browser-test.mjs','quiz-journal-test.mjs','model-client-test.mjs','review-store-test.mjs','maintenance-test.mjs',
  'submission-recovery-test.mjs','report-recapture-test.mjs','quiz-skip-test.mjs','incident-recovery-test.mjs','autopilot-test.mjs','automatic-queue-test.mjs','automation-console-test.mjs','schedule-recovery-suite.mjs'];
const executable=browserPath();
if(!executable)throw new Error('测试需要 Chrome/Edge，请设置 CHROME_PATH');
for(const test of tests){
  console.log(`TEST ${test}`);
  const result=spawnSync(process.execPath,[`tests/${test}`],{cwd:root,stdio:'inherit',
    env:{...process.env,CHROME_PATH:executable},timeout:180000});
  if(result.error)console.error(result.error);
  if(result.status!==0){process.exitCode=1;break;}
}
