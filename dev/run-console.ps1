$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
& (Get-Command node -ErrorAction Stop).Source (Join-Path $PSScriptRoot 'console.mjs')
exit $LASTEXITCODE
