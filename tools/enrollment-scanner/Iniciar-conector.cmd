@echo off
title Conector de escaner - Inscripciones BPower
echo El conector esta abierto. Deja esta ventana abierta mientras escaneas.
echo Para cerrarlo, cierra esta ventana.
powershell.exe -NoProfile -ExecutionPolicy Bypass -STA -File "%~dp0connector.ps1"
pause
