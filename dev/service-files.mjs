// Generates platform-specific user-service definitions; does not register them.
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {root,dataDir} from '../lib/config.mjs';
const output=join(dataDir,'service');mkdirSync(output,{recursive:true,mode:0o700});
const xml=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[char]));
const quote=value=>'"'+value.replace(/\\/g,'\\\\').replace(/"/g,'\\"').replace(/%/g,'%%')+'"';
const script=join(root,'dev','console.mjs');
const systemd=`[Unit]\nDescription=Chaoxing local console\nAfter=graphical-session.target\n\n[Service]\nType=simple\nWorkingDirectory=${quote(root)}\nExecStart=${quote(process.execPath)} ${quote(script)}\nRestart=on-failure\nRestartSec=5\n\n[Install]\nWantedBy=default.target\n`;
const plist=`<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>Label</key><string>local.chaoxing.console</string><key>ProgramArguments</key><array><string>${xml(process.execPath)}</string><string>${xml(script)}</string></array><key>WorkingDirectory</key><string>${xml(root)}</string><key>RunAtLoad</key><true/><key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict></dict></plist>\n`;
const task=`<?xml version="1.0" encoding="UTF-16"?>\n<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task"><RegistrationInfo><Description>Chaoxing local console; does not start courses automatically</Description></RegistrationInfo><Triggers><LogonTrigger><Enabled>true</Enabled></LogonTrigger></Triggers><Principals><Principal id="Author"><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals><Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><ExecutionTimeLimit>PT0S</ExecutionTimeLimit></Settings><Actions Context="Author"><Exec><Command>${xml(process.execPath)}</Command><Arguments>&quot;${xml(script)}&quot;</Arguments><WorkingDirectory>${xml(root)}</WorkingDirectory></Exec></Actions></Task>\n`;
writeFileSync(join(output,'chaoxing-console.service'),systemd,{mode:0o600});
writeFileSync(join(output,'local.chaoxing.console.plist'),plist,{mode:0o600});
writeFileSync(join(output,'chaoxing-console.xml'),'\uFEFF'+task,{encoding:'utf16le',mode:0o600});
console.log(`服务定义已生成：${output}。尚未注册任何开机启动项。`);
