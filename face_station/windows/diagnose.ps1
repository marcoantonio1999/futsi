$StationRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$InstallBase = (Resolve-Path (Join-Path $StationRoot "..")).Path
$SourceVenvPython = Join-Path $StationRoot ".venv\Scripts\python.exe"
$InstalledVenvPython = Join-Path $InstallBase ".venv\Scripts\python.exe"
$Python = if (Test-Path $SourceVenvPython) { $SourceVenvPython } else { $InstalledVenvPython }
Write-Host "Futsi Face Station - diagnostico" -ForegroundColor Green
Write-Host "Python: $Python"
if (-not (Test-Path $Python)) { Write-Error "El entorno no esta instalado."; exit 1 }
& $Python -c "import sys, cv2, onnxruntime as ort; print('Python', sys.version); print('OpenCV', cv2.__version__); print('ONNX providers', ort.get_available_providers())"
try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:8765/health" -TimeoutSec 5
    Write-Host "Servidor local:" ($health | ConvertTo-Json -Compress)
} catch { Write-Warning "El servidor local no responde: $($_.Exception.Message)" }
Get-ScheduledTask -TaskName "Futsi Face Station*" -ErrorAction SilentlyContinue | Select-Object TaskName, State
$log = Join-Path $env:ProgramData "FutsiFaceStation\logs\face-station.log"
if (Test-Path $log) { Write-Host "Ultimas lineas del log:"; Get-Content $log -Tail 20 }
