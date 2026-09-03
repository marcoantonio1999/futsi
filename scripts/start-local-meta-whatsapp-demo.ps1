[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$backDir = Join-Path $repoRoot "back"
$frontDir = Join-Path $repoRoot "front"
$pythonExe = Join-Path $backDir ".venv\Scripts\python.exe"
$managePy = Join-Path $backDir "manage.py"
$viteCli = Join-Path $frontDir "node_modules\vite\bin\vite.js"
$demoDatabase = Join-Path $backDir ".voice-demo.sqlite3"
$runtimeDir = Join-Path $env:TEMP ("futsi-meta-" + [DateTime]::UtcNow.ToString("yyyyMMddHHmmss"))
$processes = [System.Collections.Generic.List[System.Diagnostics.Process]]::new()

function Wait-Http200 {
    param(
        [Parameter(Mandatory = $true)][string]$Url,
        [int]$Seconds = 30
    )
    $deadline = [DateTime]::UtcNow.AddSeconds($Seconds)
    while ([DateTime]::UtcNow -lt $deadline) {
        try {
            $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5
            if ($response.StatusCode -eq 200) {
                return
            }
        }
        catch {
        }
        Start-Sleep -Milliseconds 500
    }
    throw "No respondió correctamente: $Url"
}

function Wait-PublicHttp200 {
    param(
        [Parameter(Mandatory = $true)][string]$Url,
        [int]$Seconds = 90
    )
    $uri = [Uri]$Url
    $deadline = [DateTime]::UtcNow.AddSeconds($Seconds)
    while ([DateTime]::UtcNow -lt $deadline) {
        try {
            $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5
            if ($response.StatusCode -eq 200) {
                return
            }
        }
        catch {
        }
        try {
            $publicAddress = Resolve-DnsName `
                -Name $uri.Host `
                -Type A `
                -Server "1.1.1.1" `
                -DnsOnly `
                -ErrorAction Stop |
                Where-Object { $_.IPAddress } |
                Select-Object -ExpandProperty IPAddress -First 1
            if ($publicAddress) {
                $resolve = "{0}:443:{1}" -f $uri.Host, $publicAddress
                $statusCode = & curl.exe `
                    --silent `
                    --show-error `
                    --output NUL `
                    --write-out "%{http_code}" `
                    --resolve $resolve `
                    $Url
                if ($statusCode -eq "200") {
                    return
                }
            }
        }
        catch {
        }
        Start-Sleep -Seconds 1
    }
    throw "La URL pública no respondió correctamente: $Url"
}

function Start-HiddenProcess {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [Parameter(Mandatory = $true)][string]$WorkingDirectory,
        [Parameter(Mandatory = $true)][string]$Name
    )
    $process = Start-Process `
        -FilePath $FilePath `
        -ArgumentList $Arguments `
        -WorkingDirectory $WorkingDirectory `
        -WindowStyle Hidden `
        -PassThru `
        -RedirectStandardOutput (Join-Path $runtimeDir "$Name.out.log") `
        -RedirectStandardError (Join-Path $runtimeDir "$Name.err.log")
    $processes.Add($process)
    return $process
}

function Get-LocalProcessTreeIds {
    param([Parameter(Mandatory = $true)][int[]]$RootProcessIds)

    $knownIds = @($RootProcessIds | Select-Object -Unique)
    $snapshot = @(
        Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
            Select-Object ProcessId, ParentProcessId, Name, CommandLine
    )
    do {
        $foundChild = $false
        foreach ($item in $snapshot) {
            $processId = [int]$item.ProcessId
            $parentProcessId = [int]$item.ParentProcessId
            if (($knownIds -contains $parentProcessId) -and ($knownIds -notcontains $processId)) {
                $knownIds += $processId
                $foundChild = $true
            }
        }
    } while ($foundChild)

    return @($knownIds | Select-Object -Unique)
}

function Stop-LocalProcessTree {
    param([Parameter(Mandatory = $true)][int[]]$RootProcessIds)

    $treeIds = @(Get-LocalProcessTreeIds -RootProcessIds $RootProcessIds)
    foreach ($processId in ($treeIds | Sort-Object -Descending)) {
        if ($processId -ne $PID) {
            Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
        }
    }
}

function Test-IsFutsiListener {
    param(
        [Parameter(Mandatory = $true)][int]$Port,
        [Parameter(Mandatory = $true)][int[]]$RootProcessIds
    )

    if ($Port -eq 8000) {
        try {
            $health = Invoke-RestMethod `
                -Uri "http://127.0.0.1:8000/health/whatsapp/meta/" `
                -TimeoutSec 3
            if ($health.webhook_path -eq "/api/whatsapp/meta/webhook/") {
                return $true
            }
        }
        catch {
        }
    }

    $treeIds = @(Get-LocalProcessTreeIds -RootProcessIds $RootProcessIds)
    $descriptions = @(
        Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
            Where-Object { $treeIds -contains [int]$_.ProcessId } |
            ForEach-Object { "{0} {1}" -f $_.ExecutablePath, $_.CommandLine }
    ) -join "`n"
    if ($Port -eq 8000) {
        return $descriptions -match "futsi_api\.asgi:application"
    }
    if ($Port -eq 5173) {
        return (
            $descriptions -match "node_modules[\\/]vite[\\/]bin[\\/]vite\.js" -and
            $descriptions -match [regex]::Escape($repoRoot)
        )
    }
    return $false
}

function Clear-StaleFutsiPort {
    param([Parameter(Mandatory = $true)][int]$Port)

    $connections = @(
        Get-NetTCPConnection `
            -LocalPort $Port `
            -State Listen `
            -ErrorAction SilentlyContinue
    )
    if ($connections.Count -eq 0) {
        return
    }

    $ownerIds = @(
        $connections |
            Select-Object -ExpandProperty OwningProcess -Unique |
            ForEach-Object { [int]$_ }
    )
    if (-not (Test-IsFutsiListener -Port $Port -RootProcessIds $ownerIds)) {
        throw "El puerto local $Port está ocupado por otra aplicación; no se cerró nada."
    }

    Write-Host "Cerrando un servicio local anterior de FUTSI en el puerto $Port..."
    Stop-LocalProcessTree -RootProcessIds $ownerIds
    $deadline = [DateTime]::UtcNow.AddSeconds(8)
    while ([DateTime]::UtcNow -lt $deadline) {
        if (-not (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)) {
            Write-Host "Puerto $Port liberado."
            return
        }
        Start-Sleep -Milliseconds 250
    }
    throw "No fue posible liberar el puerto local $Port."
}

function Read-TunnelUrl {
    param([Parameter(Mandatory = $true)][System.Diagnostics.Process]$Process)
    $deadline = [DateTime]::UtcNow.AddSeconds(60)
    $outputPath = Join-Path $runtimeDir "cloudflared.out.log"
    $errorPath = Join-Path $runtimeDir "cloudflared.err.log"
    while ([DateTime]::UtcNow -lt $deadline) {
        $text = ""
        if (Test-Path -LiteralPath $outputPath) {
            $text += Get-Content -LiteralPath $outputPath -Raw -ErrorAction SilentlyContinue
        }
        if (Test-Path -LiteralPath $errorPath) {
            $text += Get-Content -LiteralPath $errorPath -Raw -ErrorAction SilentlyContinue
        }
        $match = [regex]::Match($text, "https://[a-z0-9-]+\.trycloudflare\.com")
        if ($match.Success) {
            return $match.Value
        }
        if ($Process.HasExited) {
            throw "Cloudflare terminó antes de entregar una URL pública."
        }
        Start-Sleep -Milliseconds 500
    }
    throw "Cloudflare no entregó una URL pública después de 60 segundos."
}

try {
    foreach ($requiredPath in @($pythonExe, $managePy, $viteCli)) {
        if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
            throw "Falta el archivo requerido: $requiredPath"
        }
    }
    foreach ($port in @(8000, 5173)) {
        Clear-StaleFutsiPort -Port $port
    }

    $cloudflared = Get-Command "cloudflared.exe" -ErrorAction SilentlyContinue
    $cloudflaredPath = if ($cloudflared) {
        $cloudflared.Source
    }
    else {
        Join-Path $repoRoot "tools\cloudflared.exe"
    }
    if (-not (Test-Path -LiteralPath $cloudflaredPath -PathType Leaf)) {
        throw "No se encontró cloudflared.exe."
    }
    $nodeExe = (Get-Command "node.exe" -ErrorAction Stop).Source

    New-Item -ItemType Directory -Path $runtimeDir | Out-Null
    $env:DB_ENGINE = "sqlite"
    $env:ALLOW_SQLITE = "true"
    $env:SQLITE_DATABASE_PATH = $demoDatabase
    $env:DJANGO_DEBUG = "true"
    $env:FUTSI_ENV = "local"
    $env:DJANGO_ALLOWED_HOSTS = "localhost,127.0.0.1,.trycloudflare.com,testserver"
    $env:DJANGO_SECURE_SSL_REDIRECT = "false"
    $env:DJANGO_SECURE_HSTS_SECONDS = "0"

    Write-Host "Preparando la base local de agenda..."
    & $pythonExe $managePy migrate --noinput
    if ($LASTEXITCODE -ne 0) {
        throw "No fue posible aplicar las migraciones."
    }
    & $pythonExe $managePy ensure_meta_whatsapp_demo
    if ($LASTEXITCODE -ne 0) {
        throw "No fue posible preparar los horarios demo de Colegio Franco Inglés."
    }

    Write-Host "Arrancando backend de WhatsApp Meta..."
    $backend = Start-HiddenProcess `
        -FilePath $pythonExe `
        -Arguments @("-m", "uvicorn", "futsi_api.asgi:application", "--host", "127.0.0.1", "--port", "8000", "--timeout-keep-alive", "75") `
        -WorkingDirectory $backDir `
        -Name "backend"
    Wait-Http200 -Url "http://127.0.0.1:8000/health/whatsapp/meta/"

    $tunnel = $null
    $publicUrl = $null
    foreach ($attempt in 1..3) {
        Write-Host "Creando túnel HTTPS temporal (intento $attempt de 3)..."
        $candidateTunnel = Start-HiddenProcess `
            -FilePath $cloudflaredPath `
            -Arguments @("tunnel", "--url", "http://127.0.0.1:8000", "--no-autoupdate") `
            -WorkingDirectory $repoRoot `
            -Name "cloudflared"
        try {
            $candidateUrl = Read-TunnelUrl -Process $candidateTunnel
            Wait-PublicHttp200 `
                -Url "$candidateUrl/health/whatsapp/meta/" `
                -Seconds 60
            $tunnel = $candidateTunnel
            $publicUrl = $candidateUrl
            break
        }
        catch {
            Stop-LocalProcessTree -RootProcessIds @($candidateTunnel.Id)
            [void]$processes.Remove($candidateTunnel)
            if ($attempt -eq 3) {
                throw
            }
            Write-Warning "El túnel no quedó accesible; se solicitará uno nuevo."
        }
    }
    if (-not $tunnel -or -not $publicUrl) {
        throw "No fue posible crear un túnel HTTPS accesible."
    }

    $env:VITE_API_URL = "http://127.0.0.1:8000/api"
    $env:VITE_BACKEND_URL = "http://127.0.0.1:8000"
    Write-Host "Arrancando dashboard local..."
    $dashboard = Start-HiddenProcess `
        -FilePath $nodeExe `
        -Arguments @($viteCli, "--host", "127.0.0.1", "--port", "5173", "--strictPort") `
        -WorkingDirectory $frontDir `
        -Name "dashboard"
    Wait-Http200 -Url "http://127.0.0.1:5173/"

    Write-Host ""
    Write-Host "LISTO PARA PROBAR WHATSAPP META" -ForegroundColor Green
    Write-Host "Callback URL: $publicUrl/api/whatsapp/meta/webhook/"
    Write-Host "Salud pública: $publicUrl/health/whatsapp/meta/"
    Write-Host "Dashboard: http://127.0.0.1:5173/"
    Write-Host "No se modificó ninguna configuración de Twilio."
    Write-Host "Mantén esta ventana abierta; presiona Ctrl+C al terminar."

    while ($true) {
        foreach ($process in $processes) {
            if ($process.HasExited) {
                throw "Un proceso local terminó inesperadamente. Revisa $runtimeDir."
            }
        }
        Start-Sleep -Seconds 2
    }
}
finally {
    foreach ($process in $processes) {
        Stop-LocalProcessTree -RootProcessIds @($process.Id)
    }
}
