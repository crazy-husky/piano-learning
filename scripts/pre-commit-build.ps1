$ErrorActionPreference = "Stop"

Set-Location (Split-Path -Parent $PSScriptRoot)
$env:GITHUB_PAGES = "true"
$env:GITHUB_REPOSITORY = "crazy-husky/piano-learning"
& cmd.exe /d /c "call C:\Dev\autostart.bat && call pnpm run build"
exit $LASTEXITCODE
