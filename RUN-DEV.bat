@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul || (
  echo Node.js bulunamadi. Once Node.js LTS kurun.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Ilk kurulum yapiliyor...
  call npm install || goto :error
)
call npm start
goto :eof
:error
echo Baslatma hatasi.
pause
