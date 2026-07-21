param(
    [ValidateSet("Auto", "GPU", "CPU")]
    [string]$Mode = "Auto"
)

$ErrorActionPreference = "Stop"
$TaskName = "Futsi Face Station"
$BrowserTaskName = "Futsi Face Station - Panel"
$SourceRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$InstallBase = Join-Path $env:ProgramFiles "FutsiFaceStation"
$StationRoot = Join-Path $InstallBase "face_station"
$DataDir = Join-Path $env:ProgramData "FutsiFaceStation"
$ConfigPath = Join-Path $DataDir "config.json"
$Venv = Join-Path $InstallBase ".venv"

function Test-Administrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-Administrator)) {
    Write-Host "Se solicitara permiso de administrador para registrar el arranque automatico."
    $arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -Mode $Mode"
    Start-Process powershell.exe -Verb RunAs -ArgumentList $arguments -Wait
    exit $LASTEXITCODE
}

Write-Host ""
Write-Host "FUTSI FACE STATION - INSTALACION" -ForegroundColor Green
Write-Host "================================"
Write-Host "Los datos locales se guardaran en $DataDir"
Write-Host ""

$acknowledgement = Read-Host "Los pesos buffalo_l requieren licencia para uso comercial. Escribe ACEPTO para continuar"
if ($acknowledgement -ne "ACEPTO") {
    throw "Instalacion cancelada. Revisa face_station\MODEL_LICENSE.md."
}

New-Item -ItemType Directory -Path $InstallBase -Force | Out-Null
if ($SourceRoot -ne $StationRoot) {
    Write-Host "Copiando la aplicacion a $InstallBase..."
    & robocopy $SourceRoot $StationRoot /MIR /XD ".venv" "__pycache__" ".pytest_cache" /XF "*.pyc" /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "No se pudo copiar la aplicacion a Program Files." }
}

$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) {
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if (-not $winget) {
        throw "No se encontro Python ni winget. Instala Python 3.11 de 64 bits y vuelve a ejecutar este archivo."
    }
    Write-Host "Instalando Python 3.11..."
    winget install --id Python.Python.3.11 --exact --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) { throw "winget no pudo instalar Python 3.11." }
    $candidate = Join-Path $env:LocalAppData "Programs\Python\Python311\python.exe"
    if (-not (Test-Path $candidate)) { throw "Python se instalo, pero no se encontro python.exe. Reinicia Windows y vuelve a intentar." }
    $pythonPath = $candidate
} else {
    $pythonPath = $python.Source
}

$version = & $pythonPath -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"
if ([version]$version -lt [version]"3.10" -or [version]$version -ge [version]"3.13") {
    throw "Se requiere Python 3.10, 3.11 o 3.12 de 64 bits. Detectado: $version"
}

if (-not (Test-Path (Join-Path $Venv "Scripts\python.exe"))) {
    Write-Host "Creando entorno aislado..."
    & $pythonPath -m venv $Venv
    if ($LASTEXITCODE -ne 0) { throw "No se pudo crear el entorno de Python." }
}
$venvPython = Join-Path $Venv "Scripts\python.exe"
& $venvPython -m pip install --upgrade pip setuptools wheel
if ($LASTEXITCODE -ne 0) { throw "No se pudo actualizar pip." }

$hasNvidia = $null -ne (Get-Command nvidia-smi -ErrorAction SilentlyContinue)
if ($Mode -eq "Auto") { $Mode = if ($hasNvidia) { "GPU" } else { "CPU" } }
$requirements = if ($Mode -eq "GPU") { "requirements-gpu.txt" } else { "requirements-cpu.txt" }
Write-Host "Instalando motor $Mode. La primera instalacion puede tardar varios minutos..."
try {
    & $venvPython -m pip install -r (Join-Path $StationRoot $requirements)
    if ($LASTEXITCODE -ne 0) { throw "pip termino con codigo $LASTEXITCODE" }
} catch {
    Write-Host "InsightFace necesita herramientas de compilacion en algunas versiones de Windows." -ForegroundColor Yellow
    Write-Host "Instala Visual Studio Build Tools con Desarrollo para escritorio con C++ y ejecuta de nuevo el instalador."
    throw
}

New-Item -ItemType Directory -Path $DataDir -Force | Out-Null
$existing = [pscustomobject]@{}
if (Test-Path $ConfigPath) {
    try { $existing = Get-Content -Raw $ConfigPath | ConvertFrom-Json } catch { $existing = [pscustomobject]@{} }
}
$defaultApi = if ($existing.api_url) { $existing.api_url } else { "https://futsi.onrender.com" }
$defaultCamera = if ($existing.camera_url) { $existing.camera_url } else { "http://192.168.137.2:8080/stream" }
$apiUrl = Read-Host "URL de Futsi API [$defaultApi]"
if (-not $apiUrl) { $apiUrl = $defaultApi }
$cameraUrl = Read-Host "URL de la camara Raspberry [$defaultCamera]"
if (-not $cameraUrl) { $cameraUrl = $defaultCamera }
$secureToken = Read-Host "Token de la estacion (Enter conserva el actual o activa modo offline)" -AsSecureString
$tokenPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
try { $stationToken = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($tokenPointer) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($tokenPointer) }
if (-not $stationToken -and $existing.station_token) { $stationToken = $existing.station_token }

$config = @{
    api_url = $apiUrl.TrimEnd("/")
    station_token = $stationToken
    camera_url = $cameraUrl
    camera_id = if ($existing.camera_id) { $existing.camera_id } else { "cancha_1" }
    processing_device = if ($Mode -eq "GPU") { "auto" } else { "cpu" }
    model_name = "buffalo_l"
    detector_size = if ($existing.detector_size) { $existing.detector_size } else { 640 }
    processing_width = if ($existing.processing_width) { $existing.processing_width } else { 1280 }
    preview_width = 960
    preview_fps = 8
    target_fps = 0
    benchmark_seconds = 8
    known_threshold = if ($existing.known_threshold) { $existing.known_threshold } else { 0.45 }
    min_margin = 0.03
    unknown_threshold = if ($existing.unknown_threshold) { $existing.unknown_threshold } else { 0.55 }
    min_det_score = 0.65
    min_face_size = 70
    unknown_min_hits = 3
    detection_debounce_seconds = 2.0
    bootstrap_interval_seconds = 300
    sync_interval_seconds = 10
    retention_days = 90
    auto_start_engine = $true
    open_browser = $true
    host = "127.0.0.1"
    port = 8765
}
$configJson = $config | ConvertTo-Json -Depth 5
$utf8 = New-Object System.Text.UTF8Encoding($false)
[IO.File]::WriteAllText($ConfigPath, $configJson, $utf8)

$currentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls $DataDir /inheritance:r /grant:r "SYSTEM:(OI)(CI)F" "Administrators:(OI)(CI)F" "$currentIdentity`:(OI)(CI)F" | Out-Null

$serviceScript = Join-Path $StationRoot "windows\run-service.ps1"
$serviceAction = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$serviceScript`""
$serviceTrigger = New-ScheduledTaskTrigger -AtStartup
$serviceSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName $TaskName -Action $serviceAction -Trigger $serviceTrigger -Settings $serviceSettings -User "SYSTEM" -RunLevel Highest -Force | Out-Null

$browserScript = Join-Path $StationRoot "windows\open-dashboard.ps1"
$browserAction = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$browserScript`""
$browserTrigger = New-ScheduledTaskTrigger -AtLogOn -User $currentIdentity
Register-ScheduledTask -TaskName $BrowserTaskName -Action $browserAction -Trigger $browserTrigger -User $currentIdentity -RunLevel Limited -Force | Out-Null

Start-ScheduledTask -TaskName $TaskName
Write-Host "Esperando el servidor local..."
for ($attempt = 0; $attempt -lt 45; $attempt++) {
    try {
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:8765/health" -TimeoutSec 2
        if ($null -ne $health) { break }
    } catch { Start-Sleep -Seconds 1 }
}
Start-Process "http://127.0.0.1:8765"
Write-Host ""
Write-Host "Instalacion terminada." -ForegroundColor Green
Write-Host "Panel: http://127.0.0.1:8765"
Write-Host "Tarea automatica: $TaskName"
Write-Host "Diagnostico: face_station\windows\diagnose.ps1"
