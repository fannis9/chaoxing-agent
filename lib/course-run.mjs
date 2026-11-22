// Course-boundary helpers: pure schedule math (testable offline) + entering a
// course's first chapter through the platform's own redirect (gets a fresh enc).
import {readFileSync, writeFileSync, renameSync, mkdirSync} from 'node:fs';
import {join} from 'node:path';

/** Record a finished course and return the next state (pure). */
export function advanceSchedule(schedule, course, {progress = null, status = null} = {}) {
  const next = {
    schemaVersion: schedule.schemaVersion ?? 1,
    tab: schedule.tab ?? null,
    index: Number.isInteger(schedule.index) ? schedule.index : 0,
    status: schedule.status ?? 'running',
    completed: [...(schedule.completed || [])],
  };
  const done = progress && progress.total ? progress.done === progress.total : false;
  next.completed.push({
    courseId: course.courseId,
    name: course.name || '',
    at: new Date().toISOString(),
    status: status || (done ? 'complete' : 'processed-with-unresolved'),
    tasks: progress?.total ?? null,
    done: progress?.done ?? null,
  });
  next.index += 1;
  next.status = 'running';
  return next;
}

/** Load schedule + course config from the env the console passes down. */
export function loadQueue() {
  const configPath = process.env.CX_COURSE_CONFIG;
  const schedulePath = process.env.CX_SCHEDULE_PATH;
  if (!configPath || !schedulePath) return null;
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  let schedule = null;
  try {
    schedule = JSON.parse(readFileSync(schedulePath, 'utf8'));
  } catch {
    schedule = {schemaVersion: 1, index: 0, status: 'running', completed: []};
  }
  return {configPath, schedulePath, config, schedule};
}

export function saveSchedule(schedulePath, schedule) {
  const temporary = `${schedulePath}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(schedule, null, 2), {mode: 0o600});
  renameSync(temporary, schedulePath);
}

/**
 * Enter a course's chapter the way the platform expects:
 *   stucoursemiddle -> /mycourse/stu (enc A) -> studentcourse (toOld enc B) -> studentstudy (enc B).
 * Using enc A directly on studentstudy fails with "enc校验失败".
 */
export async function enterCourse({bridge, tab, course, cpi, chapterId}) {
  const visit = new URL('https://mooc1.chaoxing.com/visit/stucoursemiddle');
  visit.search = new URLSearchParams({
    courseid: course.courseId, clazzid: course.clazzId, cpi, ismooc2: '1', v: '2',
  }).toString();
  await bridge.command('navigate', String(visit), '--tab', String(tab));

  let entryEnc = '';
  for (let attempt = 0; attempt < 30 && !entryEnc; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    try {
      const url = await bridge.url(String(tab));
      if (!/\/mycourse\/stu/.test(url) || !url.includes(String(course.courseId))) continue;
      const match = url.match(/[?&]enc=([a-f0-9]+)/i);
      if (match) entryEnc = match[1];
    } catch { /* tab still navigating */ }
  }
  if (!entryEnc) throw new Error('进入课程时没拿到入口 enc');

  const directory = new URL('https://mooc2-ans.chaoxing.com/mooc2-ans/mycourse/studentcourse');
  directory.search = new URLSearchParams({
    courseid: course.courseId, clazzid: course.clazzId, enc: entryEnc, cpi, v: '2',
  }).toString();
  await bridge.command('navigate', String(directory), '--tab', String(tab));

  let enc = '';
  for (let attempt = 0; attempt < 30 && !enc; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    try {
      const url = await bridge.url(String(tab));
      if (!/\/mycourse\/studentcourse/.test(url)) continue;
      const found = JSON.parse(await bridge.command('eval',
        "(()=>{const old=String(window.toOld||'');const m=old.match(/var\\s+enc\\s*=\\s*[\"']([a-f0-9]+)[\"']/i);return JSON.stringify({enc:m?m[1]:''})})()",
        '--world', 'MAIN', '--tab', String(tab)));
      if (found.enc) enc = found.enc;
    } catch { /* page still loading */ }
  }
  if (!enc) throw new Error('课程目录没有提供 enc');

  const study = new URL('https://mooc1.chaoxing.com/mycourse/studentstudy');
  study.search = new URLSearchParams({
    chapterId: String(chapterId || course.firstChapterId), courseId: course.courseId,
    clazzid: course.clazzId, cpi, enc, mooc2: '1',
  }).toString();
  await bridge.command('navigate', String(study), '--tab', String(tab));
  return {url: String(study), enc};
}
