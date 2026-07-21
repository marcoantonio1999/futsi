$ErrorActionPreference = "Stop"
$StationRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$RepoRoot = (Resolve-Path (Join-Path $StationRoot "..")).Path
$Python = Join-Path $RepoRoot ".venv\Scripts\python.exe"
$env:FUTSI_FACE_DATA_DIR = Join-Path $env:ProgramData "FutsiFaceStation"
$env:FUTSI_FACE_MODEL_DIR = Join-Path $env:ProgramData "FutsiFaceStation"
$env:FUTSI_FACE_NO_BROWSER = "1"
Set-Location $RepoRoot
& $Python -m face_station.app.main --no-browser
exit $LASTEXITCODE
