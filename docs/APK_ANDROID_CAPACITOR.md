# APK Android con React + Capacitor

## Decision

La app Android se genera manteniendo React/Vite como base. Capacitor envuelve el build web dentro de un proyecto Android nativo, por lo que no se reescribe la app en Kotlin/Java.

## Archivos agregados

- `front/capacitor.config.ts`
- `front/android/`
- `front/.env.android`
- `front/.env.android.example`

## Scripts

Desde `front/`:

```powershell
npm.cmd run build:android
npm.cmd run cap:sync
npm.cmd run cap:open
```

## Backend local desde Android

Para emulador Android Studio:

```env
VITE_API_URL=http://10.0.2.2:8000/api
```

Para celular fisico en la misma red Wi-Fi:

```env
VITE_API_URL=http://IP_DE_TU_PC:8000/api
```

En ese caso Django debe correr asi:

```powershell
python back\manage.py runserver 0.0.0.0:8000
```

## Permisos Android

El manifest incluye:

- `INTERNET`
- `CAMERA`
- `usesCleartextTraffic=true` para demo local por HTTP

En produccion, la app debe apuntar a HTTPS y se puede quitar `usesCleartextTraffic`.

## Requisito para compilar APK

Android Studio ya quedo instalado. En esta maquina Java no quedo en el PATH global, pero se puede usar el JDK embebido de Android Studio:

```text
C:\Program Files\Android\Android Studio\jbr
```

Tambien se detecto Android SDK en:

```text
C:\Users\daniel\AppData\Local\Android\Sdk
```

## Generar APK desde Android Studio

1. Abrir Android Studio.
2. File > Open.
3. Seleccionar `front/android`.
4. Esperar Gradle Sync.
5. Build > Build Bundle(s) / APK(s) > Build APK(s).
6. El APK debug queda normalmente en:

```text
front/android/app/build/outputs/apk/debug/app-debug.apk
```

## Generar APK por terminal despues de instalar Java/Android Studio

```powershell
.\tools\build_android_debug_apk.ps1
```

APK generado:

```text
front\android\app\build\outputs\apk\debug\app-debug.apk
```

## APK conectado a produccion

Cuando Render/Supabase esten estables, cambiar `front/.env.android` a:

```env
VITE_API_URL=https://futsi.onrender.com/api
VITE_BASE_PATH=./
```

Luego:

```powershell
cd front
npm.cmd run cap:sync
cd android
.\gradlew.bat assembleDebug
```
