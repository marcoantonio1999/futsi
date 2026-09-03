[CmdletBinding()]
param(
    [switch]$CheckOnly,
    [switch]$CheckDnsOnly,
    [switch]$CheckTunnelOnly,
    [string]$EnvFile
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$backDir = Join-Path $repoRoot "back"
$frontDir = Join-Path $repoRoot "front"
$pythonExe = Join-Path $backDir ".venv\Scripts\python.exe"
$managePy = Join-Path $backDir "manage.py"
$viteCli = Join-Path $frontDir "node_modules\vite\bin\vite.js"
$demoDatabase = Join-Path $backDir ".voice-demo.sqlite3"
$twilioCommand = Join-Path $backDir "core\management\commands\twilio_local_demo.py"
$twilioBackupPath = Join-Path $backDir ".twilio-local-demo-backup.json"
$openAiRealtimeProbe = Join-Path $repoRoot "scripts\check-openai-realtime.py"
if ([string]::IsNullOrWhiteSpace($EnvFile)) {
    $credentialEnvFile = Join-Path $backDir ".env"
}
elseif ([IO.Path]::IsPathRooted($EnvFile)) {
    $credentialEnvFile = [IO.Path]::GetFullPath($EnvFile)
}
else {
    $credentialEnvFile = [IO.Path]::GetFullPath((Join-Path $repoRoot $EnvFile))
}

$environmentNames = @(
    "OPENAI_API_KEY",
    "OPENAI_REALTIME_MODEL",
    "OPENAI_TRANSCRIPTION_MODEL",
    "OPENAI_REALTIME_VOICE",
    "OPENAI_REALTIME_VAD_THRESHOLD",
    "OPENAI_REALTIME_VAD_PREFIX_PADDING_MS",
    "OPENAI_REALTIME_VAD_SILENCE_DURATION_MS",
    "TWILIO_ACCOUNT_SID",
    "TWILIO_AUTH_TOKEN",
    "TWILIO_PHONE_NUMBER",
    "TWILIO_WHATSAPP_NUMBER",
    "TWILIO_WHATSAPP_INTERACTIVE",
    "TWILIO_PUBLIC_BASE_URL",
    "TWILIO_STREAM_URL",
    "TWILIO_VALIDATE_SIGNATURES",
    "DJANGO_ALLOWED_HOSTS",
    "DJANGO_DEBUG",
    "DJANGO_SECRET_KEY",
    "DJANGO_SECURE_HSTS_SECONDS",
    "DJANGO_SECURE_SSL_REDIRECT",
    "FUTSI_ENV",
    "DB_ENGINE",
    "ALLOW_SQLITE",
    "SQLITE_DATABASE_PATH",
    "ALLOW_DESTRUCTIVE_SEED",
    "FUTSI_DEMO_ADMIN_PASSWORD",
    "VITE_API_URL",
    "VITE_BACKEND_URL",
    "VITE_DEV_HOST"
)

$originalEnvironment = @{}
foreach ($name in $environmentNames) {
    $originalEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, "Process")
}

$createdProcesses = [System.Collections.Generic.List[System.Diagnostics.Process]]::new()
$runtimeFiles = [System.Collections.Generic.List[string]]::new()
$runtimeDir = $null
$twilioAuthToken = $null
$twilioAccountSid = $null
$twilioPhoneNumber = $null
$twilioWhatsAppNumber = $null
$twilioRestoreNeeded = $false
$runFailed = $false
$restoreFailed = $false

function Set-ProcessEnvironment {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [AllowNull()][string]$Value
    )

    [Environment]::SetEnvironmentVariable($Name, $Value, "Process")
}

function Read-DemoCredentialEnv {
    param([Parameter(Mandatory = $true)][string]$Path)

    $values = @{}
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return $values
    }

    $allowedNames = @(
        "OPENAI_API_KEY",
        "TWILIO_AUTH_TOKEN",
        "TWILIO_ACCOUNT_SID",
        "TWILIO_PHONE_NUMBER",
        "TWILIO_WHATSAPP_NUMBER"
    )
    $lineNumber = 0
    foreach ($rawLine in Get-Content -LiteralPath $Path -Encoding UTF8) {
        $lineNumber++
        $line = $rawLine.Trim()
        if ([string]::IsNullOrWhiteSpace($line) -or $line.StartsWith("#")) {
            continue
        }
        if ($line.StartsWith("export ")) {
            $line = $line.Substring(7).TrimStart()
        }
        if ($line -notmatch "^([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$") {
            continue
        }

        $name = $Matches[1]
        if ($name -notin $allowedNames) {
            continue
        }
        $value = $Matches[2].Trim()
        if (
            $value.Length -ge 2 -and
            (
                ($value.StartsWith('"') -and $value.EndsWith('"')) -or
                ($value.StartsWith("'") -and $value.EndsWith("'"))
            )
        ) {
            $value = $value.Substring(1, $value.Length - 2)
        }
        if ($values.ContainsKey($name)) {
            throw "$Path contiene $name más de una vez (última aparición: línea $lineNumber)."
        }
        $values[$name] = $value
    }
    return $values
}

function ConvertFrom-DemoSecureString {
    param([Parameter(Mandatory = $true)][Security.SecureString]$SecureValue)

    $pointer = [IntPtr]::Zero
    try {
        $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureValue)
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    }
    finally {
        if ($pointer -ne [IntPtr]::Zero) {
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
        }
    }
}

function Set-SecureProcessEnvironment {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][Security.SecureString]$SecureValue,
        [Parameter(Mandatory = $true)][scriptblock]$IsValid,
        [Parameter(Mandatory = $true)][string]$ValidationMessage
    )

    $plainValue = ConvertFrom-DemoSecureString $SecureValue
    try {
        if (-not (& $IsValid $plainValue)) {
            throw $ValidationMessage
        }
        Set-ProcessEnvironment -Name $Name -Value $plainValue
    }
    finally {
        $plainValue = $null
    }
}

function Invoke-Django {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)

    Push-Location $backDir
    try {
        & $pythonExe $managePy @Arguments
        if ($LASTEXITCODE -ne 0) {
            throw "Falló: manage.py $($Arguments -join ' ')"
        }
    }
    finally {
        Pop-Location
    }
}

function Invoke-TwilioPreflightWithRetry {
    param([int]$MaxAttempts = 4)

    for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
        try {
            Invoke-Django @("twilio_local_demo", "preflight")
            return
        }
        catch {
            if ($attempt -eq $MaxAttempts) {
                throw (
                    "No se pudo validar Twilio después de $MaxAttempts intentos. " +
                    "La conexión o el DNS siguen inestables. Prueba configurar los DNS " +
                    "del adaptador Wi-Fi como 1.1.1.1 y 1.0.0.1."
                )
            }
            Write-Warning (
                "Twilio no respondió en el intento $attempt de $MaxAttempts. " +
                "Se limpiará la caché DNS y se volverá a intentar."
            )
            Clear-DnsClientCache -ErrorAction SilentlyContinue
            Start-Sleep -Seconds (2 * $attempt)
        }
    }
}

function Read-TwilioBackup {
    param([Parameter(Mandatory = $true)][string]$Path)

    try {
        $backup = Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
    }
    catch {
        throw "El respaldo pendiente de Twilio no contiene JSON válido: $Path"
    }

    foreach ($propertyName in @(
        "version",
        "created_at",
        "account_sid",
        "phone_number",
        "demo_configuration"
    )) {
        if ($null -eq $backup.PSObject.Properties[$propertyName]) {
            throw "El respaldo pendiente de Twilio tiene una estructura inválida: $Path"
        }
    }
    return $backup
}

function Resolve-PendingTwilioBackup {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$CurrentAccountSid
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return
    }

    $backup = Read-TwilioBackup -Path $Path
    if ([string]$backup.account_sid -eq $CurrentAccountSid) {
        throw (
            "Existe un respaldo pendiente de esta cuenta en $Path. " +
            "Ejecuta restore con las credenciales de esta misma cuenta antes de iniciar otra demo."
        )
    }

    Write-Warning (
        "Hay un respaldo pendiente de otra cuenta de Twilio. La cuenta anterior NO se " +
        "restaurará con estas credenciales; el respaldo se conservará en el archivo histórico."
    )
    $confirmation = (Read-Host "Escribe AISLAR para conservarlo y continuar con la cuenta actual").Trim()
    if ($confirmation -cne "AISLAR") {
        throw "Operación cancelada. No se modificó Twilio ni el respaldo pendiente."
    }
    Invoke-Django @("twilio_local_demo", "archive-other-account-backup")
    if (Test-Path -LiteralPath $Path -PathType Leaf) {
        throw "El respaldo de la cuenta anterior no pudo aislarse; no se modificó Twilio."
    }
}

function Test-TwilioBackupMatchesRun {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$AccountSid,
        [Parameter(Mandatory = $true)][string]$PhoneNumber,
        [Parameter(Mandatory = $true)][string]$BaseUrl,
        [Parameter(Mandatory = $true)][DateTimeOffset]$ConfigureStartedAt
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return $false
    }

    try {
        $backup = Read-TwilioBackup -Path $Path
        $demoConfiguration = $backup.demo_configuration
        if ($null -eq $demoConfiguration) {
            return $false
        }
        $voiceUrlProperty = $demoConfiguration.PSObject.Properties["voice_url"]
        $voiceMethodProperty = $demoConfiguration.PSObject.Properties["voice_method"]
        $statusCallbackProperty = $demoConfiguration.PSObject.Properties["status_callback"]
        $statusCallbackMethodProperty = $demoConfiguration.PSObject.Properties["status_callback_method"]
        if (
            $null -eq $voiceUrlProperty -or
            $null -eq $voiceMethodProperty -or
            $null -eq $statusCallbackProperty -or
            $null -eq $statusCallbackMethodProperty
        ) {
            return $false
        }

        $createdAt = [DateTimeOffset]::MinValue
        $createdAtIsValid = [DateTimeOffset]::TryParse(
            [string]$backup.created_at,
            [Globalization.CultureInfo]::InvariantCulture,
            [Globalization.DateTimeStyles]::AssumeUniversal,
            [ref]$createdAt
        )
        if (
            -not $createdAtIsValid -or
            $createdAt -lt $ConfigureStartedAt.AddSeconds(-2) -or
            $createdAt -gt [DateTimeOffset]::UtcNow.AddMinutes(2)
        ) {
            return $false
        }

        $expectedVoiceUrl = $BaseUrl.TrimEnd("/") + "/api/voice/twilio/incoming/"
        $expectedStatusCallback = $BaseUrl.TrimEnd("/") + "/api/voice/twilio/status/"
        return (
            [int]$backup.version -eq 1 -and
            [string]$backup.account_sid -eq $AccountSid -and
            [string]$backup.phone_number -eq $PhoneNumber -and
            [string]$voiceUrlProperty.Value -eq $expectedVoiceUrl -and
            [string]$voiceMethodProperty.Value -eq "POST" -and
            [string]$statusCallbackProperty.Value -eq $expectedStatusCallback -and
            [string]$statusCallbackMethodProperty.Value -eq "POST"
        )
    }
    catch {
        Write-Warning (
            "No se pudo validar si el respaldo fue creado por esta ejecución. " +
            "No se intentará una restauración automática."
        )
        return $false
    }
}

function Test-VoiceDemoDataReady {
    $checkCode = "from core.models import TrialAvailabilityRule, User; raise SystemExit(0 if User.objects.filter(username='admin').exists() and TrialAvailabilityRule.objects.filter(is_active=True).exists() else 1)"

    Push-Location $backDir
    try {
        & $pythonExe $managePy "shell" "-c" $checkCode *> $null
        return $LASTEXITCODE -eq 0
    }
    finally {
        Pop-Location
    }
}

function Test-DemoAdminPasswordReady {
    $checkCode = "from django.contrib.auth import get_user_model; U=get_user_model(); u=U.objects.filter(username='admin').first(); raise SystemExit(0 if u and u.is_active and u.has_usable_password() and not u.check_password('admin12345') else 1)"

    Push-Location $backDir
    try {
        & $pythonExe $managePy "shell" "-c" $checkCode *> $null
        return $LASTEXITCODE -eq 0
    }
    finally {
        Pop-Location
    }
}

function Test-LocalPortAvailable {
    param([Parameter(Mandatory = $true)][int]$Port)

    $listener = $null
    try {
        $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $Port)
        $listener.Start()
        return $true
    }
    catch {
        return $false
    }
    finally {
        if ($null -ne $listener) {
            $listener.Stop()
        }
    }
}

function Assert-Prerequisites {
    $missing = [System.Collections.Generic.List[string]]::new()

    foreach ($path in @($pythonExe, $managePy, $twilioCommand, $openAiRealtimeProbe, (Join-Path $frontDir "package.json"))) {
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
            $missing.Add($path)
        }
    }
    if (Test-Path -LiteralPath $pythonExe -PathType Leaf) {
        & $pythonExe -c "import django, twilio, uvicorn, websockets" *> $null
        if ($LASTEXITCODE -ne 0) {
            $missing.Add("dependencias Python django, twilio, uvicorn y websockets en back/.venv")
        }
    }

    $cloudflared = Get-Command "cloudflared.exe" -ErrorAction SilentlyContinue
    if ($null -eq $cloudflared) {
        $bundledCloudflared = Join-Path $repoRoot "tools\cloudflared.exe"
        if (Test-Path -LiteralPath $bundledCloudflared -PathType Leaf) {
            $cloudflaredPath = $bundledCloudflared
        }
        else {
            $missing.Add("cloudflared.exe")
            $cloudflaredPath = $null
        }
    }
    else {
        $cloudflaredPath = $cloudflared.Source
    }

    $node = Get-Command "node.exe" -ErrorAction SilentlyContinue
    if ($null -eq $node) {
        $missing.Add("node.exe")
        $nodePath = $null
    }
    else {
        $nodePath = $node.Source
    }

    if (-not (Test-Path -LiteralPath $viteCli -PathType Leaf)) {
        $missing.Add("$viteCli (ejecuta npm.cmd install en front)")
    }

    if ($missing.Count -gt 0) {
        throw "Faltan prerrequisitos:`n - $($missing -join "`n - ")"
    }

    $cloudflareConfigPaths = @(
        (Join-Path $env:USERPROFILE ".cloudflared\config.yml"),
        (Join-Path $env:USERPROFILE ".cloudflared\config.yaml")
    )
    $activeCloudflareConfig = $cloudflareConfigPaths | Where-Object {
        Test-Path -LiteralPath $_ -PathType Leaf
    }
    if ($activeCloudflareConfig) {
        throw "Cloudflare Quick Tunnel puede fallar porque existe $($activeCloudflareConfig -join ', '). Muévelo temporalmente y restáuralo al terminar."
    }

    $busyPorts = @(
        @(8000, 5173) | Where-Object { -not (Test-LocalPortAvailable $_) }
    )
    if ($busyPorts.Count -gt 0) {
        throw "Los puertos $($busyPorts -join ', ') ya están ocupados. Detén únicamente los servidores locales anteriores y vuelve a ejecutar."
    }

    return [PSCustomObject]@{
        Cloudflared = $cloudflaredPath
        Node = $nodePath
    }
}

function Start-HiddenDemoProcess {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [Parameter(Mandatory = $true)][string]$WorkingDirectory
    )

    $stdoutPath = Join-Path $runtimeDir "$Name.out.log"
    $stderrPath = Join-Path $runtimeDir "$Name.err.log"
    $runtimeFiles.Add($stdoutPath)
    $runtimeFiles.Add($stderrPath)

    $process = Start-Process `
        -FilePath $FilePath `
        -ArgumentList $Arguments `
        -WorkingDirectory $WorkingDirectory `
        -WindowStyle Hidden `
        -RedirectStandardOutput $stdoutPath `
        -RedirectStandardError $stderrPath `
        -PassThru
    $createdProcesses.Add($process)
    return $process
}

function Wait-ForTunnelUrl {
    param(
        [Parameter(Mandatory = $true)][Diagnostics.Process]$Process,
        [Parameter(Mandatory = $true)][string[]]$LogPaths
    )

    $deadline = [DateTime]::UtcNow.AddSeconds(60)
    while ([DateTime]::UtcNow -lt $deadline) {
        $text = ""
        foreach ($path in $LogPaths) {
            if (Test-Path -LiteralPath $path) {
                $text += [Environment]::NewLine + (Get-Content -LiteralPath $path -Raw -ErrorAction SilentlyContinue)
            }
        }
        $match = [regex]::Match($text, "https://[a-z0-9-]+\.trycloudflare\.com")
        if ($match.Success) {
            return $match.Value.TrimEnd("/")
        }
        if ($Process.HasExited) {
            throw "cloudflared terminó antes de crear el Quick Tunnel. Revisa tu conexión y la configuración de Cloudflare."
        }
        Start-Sleep -Milliseconds 500
    }
    throw "cloudflared no entregó una URL pública después de 60 segundos."
}

function Wait-ForReadyHealth {
    param(
        [Parameter(Mandatory = $true)][string]$Url,
        [Parameter(Mandatory = $true)][int]$TimeoutSeconds
    )

    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    $lastObservation = "sin respuesta"
    while ([DateTime]::UtcNow -lt $deadline) {
        try {
            $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 8
            $payload = $response.Content | ConvertFrom-Json -ErrorAction Stop
            $lastObservation = "HTTP $($response.StatusCode), status=$($payload.status)"
            if ($response.StatusCode -eq 200 -and $payload.status -eq "ready") {
                return
            }
        }
        catch {
            $lastObservation = $_.Exception.Message
            $webResponse = $_.Exception.Response
            if ($null -ne $webResponse) {
                try {
                    $statusCode = [int]$webResponse.StatusCode
                    $reader = [IO.StreamReader]::new($webResponse.GetResponseStream())
                    try {
                        $responseBody = $reader.ReadToEnd()
                    }
                    finally {
                        $reader.Dispose()
                    }
                    if ($responseBody.Length -gt 500) {
                        $responseBody = $responseBody.Substring(0, 500)
                    }
                    $lastObservation = "HTTP ${statusCode}: $responseBody"
                }
                catch {
                    # Conserva el mensaje original si la respuesta no se puede leer.
                }
            }
        }
        Start-Sleep -Seconds 1
    }
    throw "La validación de salud no llegó a 'ready': $Url. Última respuesta: $lastObservation"
}

function Wait-ForHttp200 {
    param(
        [Parameter(Mandatory = $true)][string]$Url,
        [Parameter(Mandatory = $true)][int]$TimeoutSeconds
    )

    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    while ([DateTime]::UtcNow -lt $deadline) {
        try {
            $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5
            if ($response.StatusCode -eq 200) {
                return
            }
        }
        catch {
            # Vite todavía puede estar iniciando.
        }
        Start-Sleep -Seconds 1
    }
    throw "No se pudo abrir $Url"
}

function Assert-StableVoiceDns {
    $hosts = @(
        "api.twilio.com",
        "api.openai.com",
        "region1.v2.argotunnel.com"
    )
    for ($round = 1; $round -le 6; $round++) {
        foreach ($hostName in $hosts) {
            try {
                $addresses = @([Net.Dns]::GetHostAddresses($hostName))
                if ($addresses.Count -eq 0) {
                    throw "sin direcciones"
                }
            }
            catch {
                $configuredDns = @(
                    Get-DnsClientServerAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
                        Where-Object { $_.ServerAddresses.Count -gt 0 } |
                        ForEach-Object {
                            "$($_.InterfaceAlias): $($_.ServerAddresses -join ', ')"
                        }
                ) -join "; "
                throw (
                    "Falló la resolución de $hostName en la ronda $round de 6. " +
                    "Servidores DNS configurados: $configuredDns. No se habilitó el " +
                    "número de Twilio. Configura el Wi-Fi con DNS 1.1.1.1 y 1.0.0.1 " +
                    "antes de volver a iniciar."
                )
            }
        }
        if ($round -lt 6) {
            Start-Sleep -Seconds 1
        }
    }
    Write-Host "DNS_STABLE_OK" -ForegroundColor Green
}

function Assert-OpenAiRealtimeAccess {
    for ($round = 1; $round -le 2; $round++) {
        & $pythonExe $openAiRealtimeProbe
        if ($LASTEXITCODE -ne 0) {
            throw (
                "La prueba real $round de 2 de OpenAI Realtime falló. " +
                "Revisa DNS, clave, permisos, modelo, cuota y facturación. " +
                "El número de Twilio todavía no fue habilitado."
            )
        }
        if ($round -lt 2) {
            Start-Sleep -Seconds 2
        }
    }
}

function Get-DemoProcessTreeIds {
    param([Parameter(Mandatory = $true)][int]$RootProcessId)

    $processSnapshot = @(Get-CimInstance Win32_Process -ErrorAction Stop)
    $pending = [System.Collections.Generic.Queue[int]]::new()
    $treeIds = [System.Collections.Generic.List[int]]::new()
    $pending.Enqueue($RootProcessId)
    $treeIds.Add($RootProcessId)

    while ($pending.Count -gt 0) {
        $parentId = $pending.Dequeue()
        foreach ($child in @($processSnapshot | Where-Object { $_.ParentProcessId -eq $parentId })) {
            $childId = [int]$child.ProcessId
            if (-not $treeIds.Contains($childId)) {
                $treeIds.Add($childId)
                $pending.Enqueue($childId)
            }
        }
    }

    return @($treeIds)
}

function Stop-CreatedDemoProcesses {
    for ($index = $createdProcesses.Count - 1; $index -ge 0; $index--) {
        $process = $createdProcesses[$index]
        try {
            if (-not $process.HasExited) {
                $treeIds = @(Get-DemoProcessTreeIds -RootProcessId $process.Id)
                [array]::Reverse($treeIds)
                foreach ($treeId in $treeIds) {
                    if (Get-Process -Id $treeId -ErrorAction SilentlyContinue) {
                        # A sibling such as conhost can exit between the read and
                        # the stop. Ignore that race and verify the whole tree below.
                        Stop-Process -Id $treeId -Force -ErrorAction SilentlyContinue
                    }
                }
                $null = $process.WaitForExit(5000)
                $stopDeadline = [DateTime]::UtcNow.AddSeconds(5)
                do {
                    $survivors = @(
                        $treeIds | Where-Object {
                            $null -ne (Get-Process -Id $_ -ErrorAction SilentlyContinue)
                        }
                    )
                    if ($survivors.Count -gt 0) {
                        Start-Sleep -Milliseconds 100
                    }
                } while ($survivors.Count -gt 0 -and [DateTime]::UtcNow -lt $stopDeadline)
                if ($survivors.Count -gt 0) {
                    throw "quedaron procesos hijos activos: $($survivors -join ', ')"
                }
            }
        }
        catch {
            Write-Warning "No se pudo detener el proceso creado PID $($process.Id): $($_.Exception.Message)"
        }
        finally {
            $process.Dispose()
        }
    }
}

try {
    Write-Host "Comprobando demo local de voz..." -ForegroundColor Cyan
    $tools = Assert-Prerequisites

    if ($CheckOnly) {
        Write-Host "CHECK OK: dependencias, archivos y puertos listos; no se pidieron credenciales ni se usó la red." -ForegroundColor Green
        return
    }
    if ($CheckDnsOnly) {
        Write-Host "Validando estabilidad de DNS sin iniciar servicios ni modificar Twilio..."
        Assert-StableVoiceDns
        Write-Host "CHECK DNS OK: seis rondas completas; Twilio no fue modificado." -ForegroundColor Green
        return
    }

    # Evita que procesos auxiliares hereden por accidente credenciales que ya
    # existieran en la sesión desde la que se invoca el script.
    Set-ProcessEnvironment "OPENAI_API_KEY" $null
    Set-ProcessEnvironment "TWILIO_AUTH_TOKEN" $null
    Set-ProcessEnvironment "TWILIO_ACCOUNT_SID" $null
    Set-ProcessEnvironment "TWILIO_PHONE_NUMBER" $null
    Set-ProcessEnvironment "TWILIO_WHATSAPP_NUMBER" $null

    Write-Host "Validando estabilidad de DNS antes de iniciar servicios..."
    Assert-StableVoiceDns

    Write-Host "Preparando la base aislada back/.voice-demo.sqlite3..."
    Set-ProcessEnvironment "FUTSI_ENV" "demo"
    Set-ProcessEnvironment "DJANGO_DEBUG" "false"
    Set-ProcessEnvironment "DJANGO_SECURE_SSL_REDIRECT" "false"
    Set-ProcessEnvironment "DJANGO_SECURE_HSTS_SECONDS" "0"
    Set-ProcessEnvironment "DJANGO_SECRET_KEY" (([Guid]::NewGuid().ToString("N")) + ([Guid]::NewGuid().ToString("N")))
    Set-ProcessEnvironment "DB_ENGINE" "sqlite"
    Set-ProcessEnvironment "ALLOW_SQLITE" "true"
    Set-ProcessEnvironment "SQLITE_DATABASE_PATH" $demoDatabase

    Invoke-Django @("migrate", "--noinput")
    if (Test-VoiceDemoDataReady) {
        Write-Host "La base demo ya contiene disponibilidad; se reutilizará sin volver a cargarla."
    }
    else {
        Set-ProcessEnvironment "ALLOW_DESTRUCTIVE_SEED" "true"
        try {
            Invoke-Django @("seed_demo", "--reset")
        }
        finally {
            Set-ProcessEnvironment "ALLOW_DESTRUCTIVE_SEED" $null
        }
    }

    $adminPasswordConfigured = Test-DemoAdminPasswordReady
    if ($adminPasswordConfigured) {
        Write-Host "Se conserva la contraseña segura existente del usuario admin."
        $revokeAdminTokensCode = "from django.contrib.auth import get_user_model; from rest_framework.authtoken.models import Token; U=get_user_model(); Token.objects.filter(user=U.objects.get(username='admin')).delete()"
        Invoke-Django @("shell", "-c", $revokeAdminTokensCode)
    }
    while (-not $adminPasswordConfigured) {
        $adminPassword = $null
        $adminPasswordConfirmation = $null
        $plainAdminPassword = $null
        $plainAdminPasswordConfirmation = $null
        try {
            Write-Host "La contraseña temporal debe tener al menos 12 caracteres." -ForegroundColor Yellow
            $adminPassword = Read-Host "Nueva contraseña temporal para el usuario admin" -AsSecureString
            $adminPasswordConfirmation = Read-Host "Confirma la contraseña temporal de admin" -AsSecureString
            $plainAdminPassword = ConvertFrom-DemoSecureString $adminPassword
            $plainAdminPasswordConfirmation = ConvertFrom-DemoSecureString $adminPasswordConfirmation

            if ($plainAdminPassword -cne $plainAdminPasswordConfirmation) {
                Write-Warning "Las contraseñas no coinciden. Inténtalo nuevamente."
                continue
            }
            if ($plainAdminPassword.Length -lt 12) {
                Write-Warning "Debe contener al menos 12 caracteres. Inténtalo nuevamente."
                continue
            }

            Set-ProcessEnvironment "FUTSI_DEMO_ADMIN_PASSWORD" $plainAdminPassword
            $passwordCode = "import os; from django.contrib.auth import get_user_model; from django.contrib.auth.password_validation import validate_password; from rest_framework.authtoken.models import Token; User=get_user_model(); user=User.objects.get(username='admin'); password=os.environ['FUTSI_DEMO_ADMIN_PASSWORD']; validate_password(password, user); user.set_password(password); user.save(update_fields=['password']); Token.objects.filter(user=user).delete()"
            try {
                Invoke-Django @("shell", "-c", $passwordCode)
                $adminPasswordConfigured = $true
            }
            catch {
                Write-Warning "Django no aceptó esa contraseña. Usa una combinación menos común e inténtalo nuevamente."
            }
        }
        finally {
            Set-ProcessEnvironment "FUTSI_DEMO_ADMIN_PASSWORD" $null
            $plainAdminPassword = $null
            $plainAdminPasswordConfirmation = $null
            if ($null -ne $adminPassword) {
                $adminPassword.Dispose()
            }
            if ($null -ne $adminPasswordConfirmation) {
                $adminPasswordConfirmation.Dispose()
            }
        }
    }

    $runtimeDir = Join-Path ([IO.Path]::GetTempPath()) ("futsi-voice-demo-" + [Guid]::NewGuid().ToString("N"))
    $null = New-Item -ItemType Directory -Path $runtimeDir

    Write-Host "Creando Quick Tunnel temporal..."
    $cloudflaredProcess = Start-HiddenDemoProcess `
        -Name "cloudflared" `
        -FilePath $tools.Cloudflared `
        -Arguments @("tunnel", "--url", "http://127.0.0.1:8000", "--no-autoupdate") `
        -WorkingDirectory $repoRoot
    $publicBaseUrl = Wait-ForTunnelUrl `
        -Process $cloudflaredProcess `
        -LogPaths @((Join-Path $runtimeDir "cloudflared.out.log"), (Join-Path $runtimeDir "cloudflared.err.log"))
    $publicHost = ([Uri]$publicBaseUrl).Host
    $publicStreamUrl = ($publicBaseUrl -replace "^https://", "wss://") + "/ws/voice/twilio/"

    $credentialValues = Read-DemoCredentialEnv -Path $credentialEnvFile
    if (Test-Path -LiteralPath $credentialEnvFile -PathType Leaf) {
        Write-Host "Buscando credenciales en $credentialEnvFile..."
    }
    else {
        Write-Host "No existe $credentialEnvFile; se pedirán las credenciales necesarias." -ForegroundColor Yellow
    }

    $openAiApiKeyValue = [string]$credentialValues["OPENAI_API_KEY"]
    if ($openAiApiKeyValue -match "^sk-" -and $openAiApiKeyValue.Length -ge 20) {
        Set-ProcessEnvironment "OPENAI_API_KEY" $openAiApiKeyValue
        Write-Host "OPENAI_API_KEY cargada desde .env."
    }
    else {
        if (-not [string]::IsNullOrWhiteSpace($openAiApiKeyValue)) {
            Write-Warning "OPENAI_API_KEY en $credentialEnvFile no tiene un formato válido; se solicitará otra."
        }
        $openAiApiKey = Read-Host "OPENAI_API_KEY" -AsSecureString
        Set-SecureProcessEnvironment `
            -Name "OPENAI_API_KEY" `
            -SecureValue $openAiApiKey `
            -IsValid { param($value) $value -match "^sk-" -and $value.Length -ge 20 } `
            -ValidationMessage "OPENAI_API_KEY no tiene un formato válido."
        $openAiApiKey.Dispose()
        $openAiApiKey = $null
    }
    $openAiApiKeyValue = $null

    $twilioAuthTokenValue = [string]$credentialValues["TWILIO_AUTH_TOKEN"]
    if ($twilioAuthTokenValue -match "^[0-9a-fA-F]{32}$") {
        $twilioAuthToken = ConvertTo-SecureString $twilioAuthTokenValue -AsPlainText -Force
        Set-SecureProcessEnvironment `
            -Name "TWILIO_AUTH_TOKEN" `
            -SecureValue $twilioAuthToken `
            -IsValid { param($value) $value -match "^[0-9a-fA-F]{32}$" } `
            -ValidationMessage "TWILIO_AUTH_TOKEN debe contener 32 caracteres hexadecimales."
        Write-Host "TWILIO_AUTH_TOKEN cargado desde .env."
    }
    else {
        if (-not [string]::IsNullOrWhiteSpace($twilioAuthTokenValue)) {
            Write-Warning "TWILIO_AUTH_TOKEN en $credentialEnvFile no tiene un formato válido; se solicitará otro."
        }
        $twilioAuthToken = Read-Host "TWILIO_AUTH_TOKEN" -AsSecureString
        Set-SecureProcessEnvironment `
            -Name "TWILIO_AUTH_TOKEN" `
            -SecureValue $twilioAuthToken `
            -IsValid { param($value) $value -match "^[0-9a-fA-F]{32}$" } `
            -ValidationMessage "TWILIO_AUTH_TOKEN debe contener 32 caracteres hexadecimales."
    }
    $twilioAuthTokenValue = $null

    $twilioAccountSid = ([string]$credentialValues["TWILIO_ACCOUNT_SID"]).Trim()
    if ([string]::IsNullOrWhiteSpace($twilioAccountSid)) {
        $twilioAccountSid = (Read-Host "TWILIO_ACCOUNT_SID").Trim()
    }
    else {
        Write-Host "TWILIO_ACCOUNT_SID cargado desde .env."
    }
    if ($twilioAccountSid -notmatch "^AC[0-9a-fA-F]{32}$") {
        throw "TWILIO_ACCOUNT_SID debe empezar con AC y contener 34 caracteres."
    }
    $twilioPhoneNumber = ([string]$credentialValues["TWILIO_PHONE_NUMBER"]).Trim()
    if ([string]::IsNullOrWhiteSpace($twilioPhoneNumber)) {
        $twilioPhoneNumber = (Read-Host "TWILIO_PHONE_NUMBER en formato E.164").Trim()
    }
    else {
        Write-Host "TWILIO_PHONE_NUMBER cargado desde .env."
    }
    if ($twilioPhoneNumber -notmatch "^\+[1-9][0-9]{7,14}$") {
        throw "TWILIO_PHONE_NUMBER debe estar en formato E.164, por ejemplo +14015550123."
    }
    $twilioWhatsAppNumber = ([string]$credentialValues["TWILIO_WHATSAPP_NUMBER"]).Trim()
    if ([string]::IsNullOrWhiteSpace($twilioWhatsAppNumber)) {
        $twilioWhatsAppNumber = "+14155238886"
        Write-Host "TWILIO_WHATSAPP_NUMBER no está en .env; se usará el Sandbox +14155238886."
    }
    else {
        Write-Host "TWILIO_WHATSAPP_NUMBER cargado desde .env."
    }
    if ($twilioWhatsAppNumber -notmatch "^\+[1-9][0-9]{7,14}$") {
        throw "TWILIO_WHATSAPP_NUMBER debe estar en formato E.164, por ejemplo +14155238886."
    }
    $credentialValues.Clear()

    Set-ProcessEnvironment "TWILIO_ACCOUNT_SID" $twilioAccountSid
    Set-ProcessEnvironment "TWILIO_PHONE_NUMBER" $twilioPhoneNumber
    Set-ProcessEnvironment "TWILIO_WHATSAPP_NUMBER" $twilioWhatsAppNumber
    Set-ProcessEnvironment "TWILIO_WHATSAPP_INTERACTIVE" "true"
    Set-ProcessEnvironment "TWILIO_PUBLIC_BASE_URL" $publicBaseUrl
    Set-ProcessEnvironment "TWILIO_STREAM_URL" $publicStreamUrl
    Set-ProcessEnvironment "TWILIO_VALIDATE_SIGNATURES" "true"
    Set-ProcessEnvironment "DJANGO_ALLOWED_HOSTS" "localhost,127.0.0.1,$publicHost"
    Set-ProcessEnvironment "OPENAI_REALTIME_MODEL" "gpt-realtime-2.1"
    Set-ProcessEnvironment "OPENAI_TRANSCRIPTION_MODEL" "gpt-realtime-whisper"
    Set-ProcessEnvironment "OPENAI_REALTIME_VOICE" "cedar"
    Set-ProcessEnvironment "OPENAI_REALTIME_VAD_THRESHOLD" "0.75"
    Set-ProcessEnvironment "OPENAI_REALTIME_VAD_PREFIX_PADDING_MS" "400"
    Set-ProcessEnvironment "OPENAI_REALTIME_VAD_SILENCE_DURATION_MS" "700"

    Write-Host "Validando la cuenta y el número de Twilio sin modificarlos..."
    Invoke-TwilioPreflightWithRetry

    Resolve-PendingTwilioBackup `
        -Path $twilioBackupPath `
        -CurrentAccountSid $twilioAccountSid

    Write-Host "Arrancando backend ASGI..."
    $uvicornProcess = Start-HiddenDemoProcess `
        -Name "uvicorn" `
        -FilePath $pythonExe `
        -Arguments @("-m", "uvicorn", "futsi_api.asgi:application", "--host", "127.0.0.1", "--port", "8000", "--timeout-keep-alive", "75") `
        -WorkingDirectory $backDir

    Wait-ForReadyHealth -Url "http://127.0.0.1:8000/health/voice/" -TimeoutSeconds 30
    Wait-ForReadyHealth -Url "$publicBaseUrl/health/voice/" -TimeoutSeconds 120
    Wait-ForReadyHealth -Url "http://127.0.0.1:8000/health/whatsapp/" -TimeoutSeconds 30
    Wait-ForReadyHealth -Url "$publicBaseUrl/health/whatsapp/" -TimeoutSeconds 120

    if ($CheckTunnelOnly) {
        Write-Host "CHECK TUNNEL OK: backend y webhook accesibles por HTTPS; Twilio no fue modificado." -ForegroundColor Green
        Write-Host "Webhook WhatsApp: $publicBaseUrl/api/whatsapp/twilio/incoming/"
        return
    }

    Write-Host "Preparando listas y botones interactivos de WhatsApp..."
    Invoke-Django @("twilio_whatsapp_content", "setup", "--max-list-options", "6")

    Write-Host "Validando acceso real a OpenAI Realtime..."
    Assert-OpenAiRealtimeAccess

    Write-Host "Confirmando nuevamente la estabilidad de DNS antes de habilitar Twilio..."
    Assert-StableVoiceDns

    Write-Host "Configurando temporalmente el número de Twilio..."
    $configureStartedAt = [DateTimeOffset]::UtcNow
    try {
        Invoke-Django @("twilio_local_demo", "configure", "--base-url", $publicBaseUrl)
        $twilioRestoreNeeded = Test-TwilioBackupMatchesRun `
            -Path $twilioBackupPath `
            -AccountSid $twilioAccountSid `
            -PhoneNumber $twilioPhoneNumber `
            -BaseUrl $publicBaseUrl `
            -ConfigureStartedAt $configureStartedAt
        if (-not $twilioRestoreNeeded) {
            throw (
                "Twilio respondió a configure, pero no se encontró el respaldo verificable " +
                "de esta ejecución. No se mostrará LISTO PARA LLAMAR."
            )
        }
    }
    catch {
        if (-not $twilioRestoreNeeded) {
            $twilioRestoreNeeded = Test-TwilioBackupMatchesRun `
                -Path $twilioBackupPath `
                -AccountSid $twilioAccountSid `
                -PhoneNumber $twilioPhoneNumber `
                -BaseUrl $publicBaseUrl `
                -ConfigureStartedAt $configureStartedAt
        }
        throw
    }

    # Uvicorn ya heredó las credenciales. Se quitan del proceso padre antes de
    # arrancar Vite para que nunca entren en el entorno del frontend.
    Set-ProcessEnvironment "OPENAI_API_KEY" $null
    Set-ProcessEnvironment "TWILIO_AUTH_TOKEN" $null
    Set-ProcessEnvironment "TWILIO_ACCOUNT_SID" $null
    Set-ProcessEnvironment "TWILIO_PHONE_NUMBER" $null
    Set-ProcessEnvironment "TWILIO_WHATSAPP_NUMBER" $null

    Set-ProcessEnvironment "VITE_API_URL" "http://127.0.0.1:8000/api"
    Set-ProcessEnvironment "VITE_BACKEND_URL" "http://127.0.0.1:8000"
    Set-ProcessEnvironment "VITE_DEV_HOST" "127.0.0.1"
    Write-Host "Arrancando Dashboard local..."
    $viteProcess = Start-HiddenDemoProcess `
        -Name "vite" `
        -FilePath $tools.Node `
        -Arguments @($viteCli, "--host", "127.0.0.1", "--port", "5173", "--strictPort") `
        -WorkingDirectory $frontDir
    Wait-ForHttp200 -Url "http://127.0.0.1:5173/" -TimeoutSeconds 30

    Write-Host ""
    Write-Host "LISTO PARA LLAMAR Y PROBAR WHATSAPP" -ForegroundColor Green
    Write-Host "Número Twilio: $twilioPhoneNumber"
    Write-Host "WhatsApp Sandbox: $twilioWhatsAppNumber"
    Write-Host "Webhook WhatsApp anterior (Twilio): $publicBaseUrl/api/whatsapp/twilio/incoming/"
    Write-Host "Webhook WhatsApp Cloud API (Meta): $publicBaseUrl/api/whatsapp/meta/webhook/"
    Write-Host "En Meta pega este último como Callback URL y suscribe el campo 'messages'."
    Write-Host "Dashboard: http://127.0.0.1:5173/"
    Write-Host "Salud pública: $publicBaseUrl/health/voice/"
    Write-Host "Salud WhatsApp: $publicBaseUrl/health/whatsapp/"
    Write-Host "Salud WhatsApp Meta: $publicBaseUrl/health/whatsapp/meta/"
    Write-Host "Mantén esta ventana abierta. Al terminar y sin una llamada activa, presiona Ctrl+C."

    while ($true) {
        foreach ($process in $createdProcesses) {
            if ($process.HasExited) {
                throw "El proceso local PID $($process.Id) terminó inesperadamente."
            }
        }
        Start-Sleep -Seconds 2
    }
}
catch {
    $runFailed = $true
    Write-Error $_.Exception.Message
}
finally {
    if ($twilioRestoreNeeded) {
        Write-Host "Restaurando la configuración anterior de Twilio..." -ForegroundColor Yellow
        try {
            Set-ProcessEnvironment "TWILIO_ACCOUNT_SID" $twilioAccountSid
            Set-ProcessEnvironment "TWILIO_PHONE_NUMBER" $twilioPhoneNumber
            Set-SecureProcessEnvironment `
                -Name "TWILIO_AUTH_TOKEN" `
                -SecureValue $twilioAuthToken `
                -IsValid { param($value) $value -match "^[0-9a-fA-F]{32}$" } `
                -ValidationMessage "No fue posible recuperar TWILIO_AUTH_TOKEN para restaurar."
            Invoke-Django @("twilio_local_demo", "restore")
            Write-Host "Twilio restaurado." -ForegroundColor Green
        }
        catch {
            $restoreFailed = $true
            Write-Warning "NO se pudo confirmar la restauración de Twilio: $($_.Exception.Message)"
            Write-Warning "El respaldo queda en back/.twilio-local-demo-backup.json. Restaura el número desde Twilio Console antes de volver a usarlo."
        }
        finally {
            Set-ProcessEnvironment "TWILIO_AUTH_TOKEN" $null
        }
    }

    Stop-CreatedDemoProcesses

    if ($runFailed -and $null -ne $runtimeDir) {
        Write-Warning "Se conservaron los registros de diagnóstico en $runtimeDir"
    }
    else {
        foreach ($path in $runtimeFiles) {
            Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
        }
        if ($null -ne $runtimeDir -and (Test-Path -LiteralPath $runtimeDir -PathType Container)) {
            Remove-Item -LiteralPath $runtimeDir -Force -ErrorAction SilentlyContinue
        }
    }

    if ($null -ne $twilioAuthToken) {
        $twilioAuthToken.Dispose()
    }

    foreach ($name in $environmentNames) {
        Set-ProcessEnvironment -Name $name -Value $originalEnvironment[$name]
    }
}

if ($runFailed -or $restoreFailed) {
    exit 1
}
