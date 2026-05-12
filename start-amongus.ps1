$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root
$nodeDir = Join-Path (Split-Path -Parent $root) '.codex-tools\node-v22.22.2-win-x64'
$env:PATH = "$nodeDir;$env:PATH"
& (Join-Path $nodeDir 'npm.cmd') run start
