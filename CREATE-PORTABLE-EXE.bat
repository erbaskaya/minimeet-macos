@echo off
cd /d "%~dp0"
title MiniMeet Manager - EXE Olustur
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0CREATE-PORTABLE-EXE.ps1"
if errorlevel 1 (
  echo.
  echo [HATA] EXE olusturulamadi. Bu pencerenin ekran goruntusunu bana gonderin.
  pause
  exit /b 1
)
echo.
echo MiniMeet-Manager.exe hazir.
pause
