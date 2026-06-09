$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$front = Join-Path $root "front"
$android = Join-Path $front "android"
$androidStudioJbr = "C:\Program Files\Android\Android Studio\jbr"
$androidSdk = Join-Path $env:LOCALAPPDATA "Android\Sdk"

if (-not (Test-Path $androidStudioJbr)) {
    throw "No se encontro el JDK de Android Studio en $androidStudioJbr"
}

if (-not (Test-Path $androidSdk)) {
    throw "No se encontro Android SDK en $androidSdk"
}

$env:JAVA_HOME = $androidStudioJbr
$env:ANDROID_HOME = $androidSdk
$env:ANDROID_SDK_ROOT = $androidSdk
$env:Path = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:Path"

Push-Location $front
try {
    npm.cmd run cap:sync
}
finally {
    Pop-Location
}

Push-Location $android
try {
    .\gradlew.bat assembleDebug
}
finally {
    Pop-Location
}

$apk = Join-Path $android "app\build\outputs\apk\debug\app-debug.apk"
if (-not (Test-Path $apk)) {
    throw "No se genero el APK esperado en $apk"
}

Write-Host "APK generado: $apk"
