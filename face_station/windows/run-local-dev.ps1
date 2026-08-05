param(
    [ValidateRange(1, 65535)]
    [int]$HealthPort = 8765,

    [ValidateRange(1, 60)]
    [int]$ProbeIntervalSeconds = 10,

    [ValidateRange(1, 30)]
    [int]$ProbeTimeoutSeconds = 4,

    [ValidateRange(30, 900)]
    [int]$StartupTimeoutSeconds = 240,

    [ValidateRange(2, 20)]
    [int]$FailureThreshold = 4,

    [ValidateRange(1, 300)]
    [int]$RestartBackoffSeconds = 10
)

$ErrorActionPreference = "Stop"

$StationRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$RepoRoot = (Resolve-Path (Join-Path $StationRoot "..")).Path
$WorkspaceRoot = (Resolve-Path (Join-Path $RepoRoot "..")).Path
$Python = Join-Path $StationRoot ".venv\Scripts\python.exe"
$DataDir = Join-Path $WorkspaceRoot "futsi-face-station-data"
$ModelDir = Join-Path $env:USERPROFILE ".insightface"
$LogDir = Join-Path $DataDir "logs"
$WatchdogLog = Join-Path $LogDir "face-station-watchdog.log"
$StatePath = Join-Path $DataDir "face-station-watchdog.json"
$HealthUrl = "http://127.0.0.1:$HealthPort/health"
$MutexName = "Local\FutsiFaceStationLocalWatchdog"

if (-not (Test-Path -LiteralPath $Python)) {
    throw "No se encontro el entorno Python de FaceGuard: $Python"
}
if (-not (Test-Path -LiteralPath (Join-Path $DataDir "station.sqlite3"))) {
    throw "No se encontro la base local de FaceGuard: $DataDir"
}

New-Item -ItemType Directory -Path $LogDir -Force | Out-Null

function Write-WatchdogLog {
    param([Parameter(Mandatory = $true)][string]$Message)

    try {
        if ((Test-Path -LiteralPath $WatchdogLog) -and
            (Get-Item -LiteralPath $WatchdogLog).Length -ge 5MB) {
            $PreviousLog = "$WatchdogLog.1"
            Remove-Item -LiteralPath $PreviousLog -Force -ErrorAction SilentlyContinue
            Move-Item -LiteralPath $WatchdogLog -Destination $PreviousLog -Force
        }
        $Timestamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss.fff zzz")
        Add-Content -LiteralPath $WatchdogLog -Value "$Timestamp $Message" -Encoding UTF8
    }
    catch {
        # A logging failure must never disable the service supervisor.
    }
}

function Test-LocalHealth {
    try {
        $Response = Invoke-WebRequest `
            -Uri $HealthUrl `
            -UseBasicParsing `
            -DisableKeepAlive `
            -TimeoutSec $ProbeTimeoutSeconds `
            -ErrorAction Stop
        return [int]$Response.StatusCode -eq 200
    }
    catch {
        return $false
    }
}

function Test-LocalPortOwned {
    try {
        $Connection = Get-NetTCPConnection `
            -LocalPort $HealthPort `
            -ErrorAction Stop `
            | Where-Object {
                $_.LocalAddress -in @("127.0.0.1", "::1") -and
                $_.OwningProcess -gt 0 -and
                $_.State -notin @("Closed", "TimeWait")
            } `
            | Select-Object -First 1
        return $null -ne $Connection
    }
    catch {
        return $false
    }
}

function Get-UntrackedLauncherProcesses {
    $ExpectedPath = [IO.Path]::GetFullPath($Python)
    $Matches = @()
    foreach ($Process in @(Get-Process -Name "python" -ErrorAction SilentlyContinue)) {
        try {
            $ActualPath = [IO.Path]::GetFullPath($Process.Path)
            if ($ActualPath.Equals($ExpectedPath, [StringComparison]::OrdinalIgnoreCase)) {
                $Matches += $Process
            }
        }
        catch {
        }
    }
    return $Matches
}

function Test-ProcessAlive {
    param([Parameter(Mandatory = $true)][System.Diagnostics.Process]$Process)

    try {
        $Process.Refresh()
        return -not $Process.HasExited
    }
    catch {
        return $false
    }
}

function Write-WatchdogState {
    param([Parameter(Mandatory = $true)][System.Diagnostics.Process]$Process)

    $Payload = [ordered]@{
        schema_version = 1
        supervisor_pid = $PID
        child_pid = $Process.Id
        child_start_time_utc_ticks = $Process.StartTime.ToUniversalTime().Ticks
        python_path = $Python
        health_url = $HealthUrl
        updated_at = [DateTimeOffset]::Now.ToString("o")
    }
    $TemporaryPath = "$StatePath.$PID.tmp"
    try {
        $Json = $Payload | ConvertTo-Json -Depth 3
        [IO.File]::WriteAllText($TemporaryPath, $Json, [Text.UTF8Encoding]::new($false))
        Move-Item -LiteralPath $TemporaryPath -Destination $StatePath -Force
    }
    finally {
        Remove-Item -LiteralPath $TemporaryPath -Force -ErrorAction SilentlyContinue
    }
}

function Remove-WatchdogState {
    param([int]$ExpectedChildPid = 0)

    if (-not (Test-Path -LiteralPath $StatePath)) {
        return
    }
    if ($ExpectedChildPid -gt 0) {
        try {
            $State = Get-Content -Raw -LiteralPath $StatePath | ConvertFrom-Json
            if ([int]$State.child_pid -ne $ExpectedChildPid) {
                return
            }
        }
        catch {
            return
        }
    }
    Remove-Item -LiteralPath $StatePath -Force -ErrorAction SilentlyContinue
}

function Get-TrackedProcess {
    if (-not (Test-Path -LiteralPath $StatePath)) {
        return $null
    }

    try {
        $State = Get-Content -Raw -LiteralPath $StatePath | ConvertFrom-Json
        $ChildPid = [int]$State.child_pid
        $ExpectedTicks = [long]$State.child_start_time_utc_ticks
        $Process = Get-Process -Id $ChildPid -ErrorAction Stop
        $ActualPath = [IO.Path]::GetFullPath($Process.Path)
        $ExpectedPath = [IO.Path]::GetFullPath($Python)
        $ActualTicks = $Process.StartTime.ToUniversalTime().Ticks

        if (-not $ActualPath.Equals($ExpectedPath, [StringComparison]::OrdinalIgnoreCase)) {
            return $null
        }
        if ([Math]::Abs($ActualTicks - $ExpectedTicks) -gt [TimeSpan]::TicksPerSecond) {
            return $null
        }
        return $Process
    }
    catch {
        return $null
    }
}

function Stop-TrackedProcessTree {
    param([Parameter(Mandatory = $true)][System.Diagnostics.Process]$Process)

    if (-not (Test-ProcessAlive -Process $Process)) {
        return
    }

    Write-WatchdogLog "Deteniendo el arbol FaceGuard con PID raiz $($Process.Id)."
    try {
        & taskkill.exe /PID $Process.Id /T /F 2>&1 | Out-Null
    }
    catch {
        Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue
    }

    $Exited = $false
    try {
        $Exited = $Process.WaitForExit(15000)
    }
    catch {
    }
    if (-not $Exited -and (Test-ProcessAlive -Process $Process)) {
        Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue
    }
}

function Start-FaceGuardProcess {
    $Stamp = (Get-Date).ToString("yyyyMMdd-HHmmss")
    $StdoutPath = Join-Path $LogDir "face-station-$Stamp.stdout.log"
    $StderrPath = Join-Path $LogDir "face-station-$Stamp.stderr.log"

    $Process = $null
    try {
        $Process = Start-Process `
            -FilePath $Python `
            -ArgumentList @("-m", "face_station.app.main", "--no-browser") `
            -WorkingDirectory $RepoRoot `
            -WindowStyle Hidden `
            -RedirectStandardOutput $StdoutPath `
            -RedirectStandardError $StderrPath `
            -PassThru

        Write-WatchdogState -Process $Process
    }
    catch {
        if ($null -ne $Process) {
            Stop-TrackedProcessTree -Process $Process
        }
        throw
    }
    Write-WatchdogLog "FaceGuard iniciado con PID raiz $($Process.Id); logs: $StdoutPath y $StderrPath."
    return $Process
}

function Wait-ForHealthyStartup {
    param([Parameter(Mandatory = $true)][System.Diagnostics.Process]$Process)

    $Deadline = [DateTimeOffset]::Now.AddSeconds($StartupTimeoutSeconds)
    while ([DateTimeOffset]::Now -lt $Deadline) {
        if (-not (Test-ProcessAlive -Process $Process)) {
            Write-WatchdogLog "FaceGuard termino durante el arranque."
            return $false
        }
        if (Test-LocalHealth) {
            Write-WatchdogLog "FaceGuard respondio correctamente en $HealthUrl."
            return $true
        }
        Start-Sleep -Seconds $ProbeIntervalSeconds
    }

    Write-WatchdogLog "FaceGuard no respondio en los $StartupTimeoutSeconds segundos permitidos para el arranque."
    return $false
}

$env:FUTSI_FACE_DATA_DIR = $DataDir
$env:FUTSI_FACE_MODEL_DIR = $ModelDir
$env:FUTSI_FACE_NO_BROWSER = "1"

$Mutex = [Threading.Mutex]::new($false, $MutexName)
$OwnsMutex = $false
$ManagedProcess = $null

try {
    try {
        $OwnsMutex = $Mutex.WaitOne(0)
    }
    catch [Threading.AbandonedMutexException] {
        $OwnsMutex = $true
    }

    if (-not $OwnsMutex) {
        Write-WatchdogLog "Otro supervisor FaceGuard ya esta activo; esta instancia termina sin crear duplicados."
        exit 0
    }

    Write-WatchdogLog "Supervisor FaceGuard iniciado con PID $PID."

    $ManagedProcess = Get-TrackedProcess
    if ($null -ne $ManagedProcess) {
        Write-WatchdogLog "Se adopto el proceso FaceGuard registrado con PID raiz $($ManagedProcess.Id)."
    }
    else {
        $LegacyProcesses = @(Get-UntrackedLauncherProcesses)
        if ($LegacyProcesses.Count -eq 1) {
            $LegacyProcess = $LegacyProcesses[0]
            Write-WatchdogState -Process $LegacyProcess
            $ManagedProcess = $LegacyProcess
            Write-WatchdogLog "Se adopto una instancia FaceGuard anterior con PID raiz $($ManagedProcess.Id)."
        }
        elseif ($LegacyProcesses.Count -gt 1) {
            Write-WatchdogLog "Se encontraron $($LegacyProcesses.Count) procesos FaceGuard no administrados; no se creara otro."
            exit 1
        }
        elseif ((Test-LocalHealth) -or (Test-LocalPortOwned)) {
            Write-WatchdogLog "El puerto $HealthPort pertenece a una instancia no administrada; no se creara un duplicado."
            exit 1
        }
    }

    while ($true) {
        if ($null -eq $ManagedProcess) {
            $OtherLaunchers = @(Get-UntrackedLauncherProcesses)
            if ($OtherLaunchers.Count -gt 0 -or (Test-LocalPortOwned)) {
                Write-WatchdogLog "Aun existe un proceso o socket FaceGuard no administrado; se pospone el arranque para evitar duplicados."
                Start-Sleep -Seconds $ProbeIntervalSeconds
                continue
            }

            try {
                $ManagedProcess = Start-FaceGuardProcess
            }
            catch {
                Write-WatchdogLog "No se pudo iniciar FaceGuard: $($_.Exception.Message)"
                $ManagedProcess = $null
                Start-Sleep -Seconds $RestartBackoffSeconds
                continue
            }
            if (-not (Wait-ForHealthyStartup -Process $ManagedProcess)) {
                Stop-TrackedProcessTree -Process $ManagedProcess
                Remove-WatchdogState -ExpectedChildPid $ManagedProcess.Id
                $ManagedProcess = $null
                Start-Sleep -Seconds $RestartBackoffSeconds
                continue
            }
        }

        $ConsecutiveFailures = 0
        while ($true) {
            Start-Sleep -Seconds $ProbeIntervalSeconds
            if (-not (Test-ProcessAlive -Process $ManagedProcess)) {
                Write-WatchdogLog "FaceGuard termino inesperadamente."
                Remove-WatchdogState -ExpectedChildPid $ManagedProcess.Id
                $ManagedProcess = $null
                break
            }

            if (Test-LocalHealth) {
                if ($ConsecutiveFailures -gt 0) {
                    Write-WatchdogLog "FaceGuard recupero la salud despues de $ConsecutiveFailures fallo(s) consecutivo(s)."
                }
                $ConsecutiveFailures = 0
                continue
            }

            $ConsecutiveFailures++
            Write-WatchdogLog "Fallo de salud $ConsecutiveFailures de $FailureThreshold en $HealthUrl."
            if ($ConsecutiveFailures -lt $FailureThreshold) {
                continue
            }

            Write-WatchdogLog "FaceGuard sigue vivo pero no responde; el supervisor lo reiniciara."
            Stop-TrackedProcessTree -Process $ManagedProcess
            Remove-WatchdogState -ExpectedChildPid $ManagedProcess.Id
            $ManagedProcess = $null
            break
        }

        Start-Sleep -Seconds $RestartBackoffSeconds
    }
}
finally {
    if ($null -ne $ManagedProcess) {
        Stop-TrackedProcessTree -Process $ManagedProcess
        Remove-WatchdogState -ExpectedChildPid $ManagedProcess.Id
    }
    if ($OwnsMutex) {
        try {
            $Mutex.ReleaseMutex()
        }
        catch {
        }
    }
    $Mutex.Dispose()
    Write-WatchdogLog "Supervisor FaceGuard detenido."
}
