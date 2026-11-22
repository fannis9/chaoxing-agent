import {randomBytes, timingSafeEqual} from 'node:crypto';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

export function consoleAuth(directory) {
  mkdirSync(directory,{recursive:true,mode:0o700});
  const path = join(directory,'console-token');
  let token;
  try { token = readFileSync(path,'utf8').trim(); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    token = randomBytes(32).toString('hex');
    try { writeFileSync(path,token,{flag:'wx',mode:0o600}); }
    catch (writeError) {
      if (writeError.code !== 'EEXIST') throw writeError;
      token = readFileSync(path,'utf8').trim();
    }
  }
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('控制台令牌文件无效');
  return {path, token, accepts(header) {
    const supplied = Buffer.from(String(header || ''));
    const expected = Buffer.from(`Bearer ${token}`);
    return supplied.length === expected.length && timingSafeEqual(supplied,expected);
  }};
}
