# Propuesta Android gratis para Sprint 2

## Recomendacion

Usar la aplicacion como PWA instalable desde Chrome Android. Es gratis, no requiere Play Store y permite probar en cancha con celular o tablet.

Adicionalmente, en Sprint 2 ya se genero una opcion APK con Capacitor para probar en Android Studio, emulador o dispositivo fisico sin publicar en Play Store.

## Implementado

- `front/public/manifest.webmanifest`
- `front/public/icon.svg`
- `front/public/sw.js`
- Registro del service worker en `front/src/main.tsx` solo en produccion.
- Ajustes responsive en `front/src/styles.css`.
- Proyecto Capacitor en `front/android`.
- Script `tools/build_android_debug_apk.ps1`.
- APK debug en `front/android/app/build/outputs/apk/debug/app-debug.apk`.
- Tema oscuro claro/oscuro compartido por web y Android.

## Flujo de uso

1. Abrir la URL de GitHub Pages o la URL local desde Chrome Android.
2. Iniciar sesion con rol coach, cajero, coordinador o familia.
3. En el menu de Chrome elegir Instalar app o Agregar a pantalla principal.
4. Usar la app desde el icono instalado.

## Limitaciones

- El modo offline completo no esta implementado.
- Push notifications reales quedan para fase posterior.
- Para camara avanzada, notificaciones nativas o almacenamiento local robusto se debe estabilizar Capacitor en Sprint 3.

## APK Capacitor

Capacitor ya quedo como demo base. Para regenerarlo:

```powershell
cd front
npm run build
npx cap sync android
cd android
.\gradlew.bat assembleDebug
```

En emulador Android, la app usa `http://10.0.2.2:8000/api` para consumir el backend local. En produccion debe cambiarse a la URL Render.
