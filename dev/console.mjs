import {existsSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const envPath=join(root,'.env');
if(existsSync(envPath))process.loadEnvFile(envPath);
await import('../chaoxing-console.mjs');
