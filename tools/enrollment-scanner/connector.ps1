Add-Type -AssemblyName System.Windows.Forms
$ErrorActionPreference = 'Stop'
$allowedOrigins = @('https://futsi.bpoweracademy.mx')
$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add('http://127.0.0.1:47631/')
try { $listener.Start() } catch {
    [System.Windows.Forms.MessageBox]::Show('No se pudo iniciar el conector. Revisa si ya está abierto.')
    exit 1
}
try {
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response
        $origin = $request.Headers['Origin']
        $temporaryFile = $null
        try {
            if ($request.UserHostName -notin @('127.0.0.1:47631','localhost:47631') -or $origin -notin $allowedOrigins) {
                $response.StatusCode = 403
            } else {
                $response.Headers.Add('Access-Control-Allow-Origin', $origin)
                $response.Headers.Add('Vary', 'Origin')
                $response.Headers.Add('Access-Control-Allow-Private-Network', 'true')
                $response.Headers.Add('Cache-Control', 'no-store')
                if ($request.HttpMethod -eq 'OPTIONS') {
                    $response.Headers.Add('Access-Control-Allow-Methods','GET, POST, OPTIONS')
                    $response.Headers.Add('Access-Control-Allow-Headers','Content-Type')
                    $response.StatusCode = 204
                } elseif ($request.HttpMethod -eq 'GET' -and $request.Url.AbsolutePath -eq '/status') {
                    $bytes = [System.Text.Encoding]::UTF8.GetBytes('{"ready":true}')
                    $response.ContentType = 'application/json'
                    $response.OutputStream.Write($bytes, 0, $bytes.Length)
                } elseif ($request.HttpMethod -eq 'POST' -and $request.Url.AbsolutePath -eq '/scan' -and $request.ContentType -eq 'application/json' -and $request.ContentLength64 -le 256) {
                    $dialog = New-Object -ComObject WIA.CommonDialog
                    $image = $dialog.ShowAcquireImage(1, 0, 1, '{B96B3CAE-0728-11D3-9D7B-0000F81EF32E}', $true, $true, $false)
                    if ($null -eq $image) {
                        $response.StatusCode = 409
                    } else {
                        $temporaryFile = Join-Path ([System.IO.Path]::GetTempPath()) ('inscripciones-scan-' + [guid]::NewGuid().ToString('N') + '.jpg')
                        $image.SaveFile($temporaryFile)
                        $file = Get-Item -LiteralPath $temporaryFile
                        if ($file.Length -gt 20000000) { throw 'Archivo demasiado grande' }
                        $bytes = [System.IO.File]::ReadAllBytes($temporaryFile)
                        $response.ContentType = 'image/jpeg'
                        $response.OutputStream.Write($bytes, 0, $bytes.Length)
                    }
                } else { $response.StatusCode = 404 }
            }
        } catch {
            $response.StatusCode = 503
        } finally {
            if ($temporaryFile -and (Test-Path -LiteralPath $temporaryFile)) { Remove-Item -LiteralPath $temporaryFile -Force }
            $response.Close()
        }
    }
} finally { $listener.Close() }
