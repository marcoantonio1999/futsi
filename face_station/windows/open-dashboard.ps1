for ($attempt = 0; $attempt -lt 60; $attempt++) {
    try {
        Invoke-RestMethod -Uri "http://127.0.0.1:8765/health" -TimeoutSec 2 | Out-Null
        Start-Process "http://127.0.0.1:8765"
        exit 0
    } catch { Start-Sleep -Seconds 2 }
}
exit 1
