# 注册 chaoxing-agent:// 协议，让侧栏按钮可以直接拉起本机控制台。
# 只写 HKCU，不需要管理员权限；重复运行是安全的。
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$starter = Join-Path $PSScriptRoot 'start-console-if-needed.ps1'
if (-not (Test-Path $starter)) { throw "找不到启动脚本：$starter" }

$key = 'HKCU:\Software\Classes\chaoxing-agent'
New-Item -Path $key -Force | Out-Null
Set-ItemProperty -Path $key -Name '(Default)' -Value 'URL:Chaoxing Agent'
Set-ItemProperty -Path $key -Name 'URL Protocol' -Value ''

$commandKey = Join-Path $key 'shell\open\command'
New-Item -Path $commandKey -Force | Out-Null
$command = "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$starter`" `"%1`""
Set-ItemProperty -Path $commandKey -Name '(Default)' -Value $command

Write-Output "已注册协议 chaoxing-agent://"
Write-Output "启动命令：$command"

