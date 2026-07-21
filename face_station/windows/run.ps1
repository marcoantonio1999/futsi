$ErrorActionPreference = "Stop"
$StationRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$RepoRoot = (Resolve-Path (Join-Path $StationRoot "..")).Path
$SourceVenvPython = Join-Path $StationRoot ".venv\Scripts\python.exe"
$InstalledVenvPython = Join-Path $RepoRoot ".venv\Scripts\python.exe"
$Python = if (Test-Path $SourceVenvPython) { $SourceVenvPython } else { $InstalledVenvPython }
if (-not (Test-Path $Python)) { throw "Primero ejecuta install.bat como administrador." }
$env:FUTSI_FACE_DATA_DIR = Join-Path $env:ProgramData "FutsiFaceStation"
$env:FUTSI_FACE_MODEL_DIR = Join-Path $env:ProgramData "FutsiFaceStation"
Set-Location $RepoRoot
& $Python -m face_station.app.main
