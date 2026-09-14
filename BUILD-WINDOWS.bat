@echo off
setlocal
cd /d "%~dp0"
title MiniMeet Manager - Windows Build

echo.
echo ==============================================
echo   MiniMeet Manager - Windows EXE Olusturucu
echo ==============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [HATA] Node.js bulunamadi.
  echo Once https://nodejs.org adresinden Node.js LTS kurun.
  pause
  exit /b 1
)

echo [1/3] Paketler kuruluyor...
call npm install
if errorlevel 1 goto :error

echo.
echo [2/3] Windows x64 uygulamasi paketleniyor...
call npm run pack:win
if errorlevel 1 goto :error

echo.
echo [3/3] Tamamlandi.
echo.
echo Uygulama klasoru:
echo   dist\MiniMeet-Manager-win32-x64\
echo.
echo Calistirilacak dosya:
echo   dist\MiniMeet-Manager-win32-x64\MiniMeet-Manager.exe
echo.
explorer "dist\MiniMeet-Manager-win32-x64"
pause
exit /b 0

:error
echo.
echo [HATA] Derleme tamamlanamadi. Yukaridaki hata mesajini bana gonderin.
pause
exit /b 1
