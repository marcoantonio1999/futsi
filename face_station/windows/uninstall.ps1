param([switch]$DeleteLocalData)
$ErrorActionPreference = "Stop"
Unregister-ScheduledTask -TaskName "Futsi Face Station" -Confirm:$false -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName "Futsi Face Station - Panel" -Confirm:$false -ErrorAction SilentlyContinue
$InstallBase = Join-Path $env:ProgramFiles "FutsiFaceStation"
if (Test-Path $InstallBase) { Remove-Item -LiteralPath $InstallBase -Recurse -Force }
if ($DeleteLocalData) {
    $data = Join-Path $env:ProgramData "FutsiFaceStation"
    if (Test-Path $data) { Remove-Item -LiteralPath $data -Recurse -Force }
}
Write-Host "Futsi Face Station desinstalado. Los datos se conservaron salvo que usaras -DeleteLocalData."
