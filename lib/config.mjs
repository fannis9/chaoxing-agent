import {existsSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

export const root = dirname(dirname(fileURLToPath(import.meta.url)));
export const dataDir = resolve(process.env.CX_QUIZ_REPORT_DIR || join(root, 'quiz-reports'));
export function browserPath() {
  let bundled;
  try{bundled=createRequire(import.meta.url)('playwright-core').chromium.executablePath();}catch{}
  const candidates = [process.env.CHROME_PATH,
    process.env.PROGRAMFILES && join(process.env.PROGRAMFILES,'Google/Chrome/Application/chrome.exe'),
    process.env['PROGRAMFILES(X86)'] && join(process.env['PROGRAMFILES(X86)'],'Microsoft/Edge/Application/msedge.exe'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser',bundled];
  return candidates.find(path => path && existsSync(path));
}
