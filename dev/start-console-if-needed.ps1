# 幂等启动本机控制台：已经在监听就直接退出，否则用隐藏的 wscript 拉起。
$ErrorActionPreference = 'SilentlyContinue'
$root = Split-Path -Parent $PSScriptRoot          # 仓库根目录
$port = 8788

$listening = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if ($listening) { exit 0 }

$node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if (-not $node) { exit 1 }

$vbs = Join-Path $PSScriptRoot 'run-console-hidden.vbs'
$console = Join-Path $PSScriptRoot 'console.mjs'
Start-Process -FilePath 'wscript.exe' `
  -ArgumentList @('//B', '//Nologo', "`"$vbs`"", "`"$node`"", "`"$console`"", "`"$root`"") `
  -WindowStyle Hidden | Out-Null
exit 0

