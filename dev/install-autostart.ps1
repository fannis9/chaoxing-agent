$ErrorActionPreference = 'Stop'
$taskName = 'ChaoxingPageBridgeConsole'
$scriptPath = Join-Path $PSScriptRoot 'run-console.ps1'
$powershellPath = (Get-Command powershell.exe -ErrorAction Stop).Source
$repoRoot = Split-Path -Parent $PSScriptRoot
$nodePath = (Get-Command node -ErrorAction Stop).Source
$consolePath = Join-Path $PSScriptRoot 'console.mjs'
$logDirectory = Join-Path $repoRoot 'quiz-reports\service'
New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null
function Quote-Literal([string]$value) { return "'" + $value.Replace("'", "''") + "'" }
$command = '$run = Start-Process -FilePath ' + (Quote-Literal $nodePath) + ' -ArgumentList ' + (Quote-Literal ('"' + $consolePath + '"')) + ' -WorkingDirectory ' + (Quote-Literal $repoRoot) + ' -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput ' + (Quote-Literal (Join-Path $logDirectory 'startup.out.log')) + ' -RedirectStandardError ' + (Quote-Literal (Join-Path $logDirectory 'startup.err.log')) + '; exit $run.ExitCode'
$arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand ' + [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
$legacyArguments = $arguments
$hiddenHost = Join-Path $env:WINDIR 'System32\wscript.exe'
if (-not (Test-Path -LiteralPath $hiddenHost)) { throw 'Windows Script Host 不可用，未安装启动项。' }
$hiddenScript = Join-Path $PSScriptRoot 'run-console-hidden.vbs'
$arguments = '//B //Nologo "' + $hiddenScript + '" "' + $nodePath + '" "' + $consolePath + '" "' + $repoRoot + '"'
$oldArguments = '-NoProfile -NonInteractive -WindowStyle Hidden -File "' + $scriptPath + '"'
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing -and -not ($existing.Actions.Arguments -contains $arguments) -and -not ($existing.Actions.Arguments -contains $oldArguments) -and -not ($existing.Actions.Arguments -contains $legacyArguments)) {
    throw '同名计划任务指向其他程序，未覆盖。'
}
$action = New-ScheduledTaskAction -Execute $hiddenHost -Argument $arguments -WorkingDirectory (Split-Path -Parent $PSScriptRoot)
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $identity
$principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description '学习通本机控制台；登录后自动等待浏览器和课程，手动暂停优先。' -Force | Select-Object TaskName,State
Write-Output '已安装当前用户登录启动及失败重启；未立即启动第二个控制台。'
