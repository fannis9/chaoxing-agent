$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$nodePath = (Get-Command node -ErrorAction Stop).Source
# The Node launcher loads .env before starting the loopback-only console.
# No scheduled task or automatic course execution is installed.
$logDirectory = Join-Path $repoRoot 'quiz-reports\service'
New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$process = Start-Process -FilePath $nodePath -ArgumentList ('"' + (Join-Path $PSScriptRoot 'console.mjs') + '"') -WorkingDirectory $repoRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logDirectory "console-$stamp.out.log") -RedirectStandardError (Join-Path $logDirectory "console-$stamp.err.log") -PassThru
Start-Sleep -Seconds 2
if ($process.HasExited) {
    throw "控制台启动失败。请查看 $logDirectory\console-$stamp.err.log；若端口已占用，请使用已有控制台。"
}
Write-Output "控制台已在后台启动，PID=$($process.Id)。日志：$logDirectory"
