$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Version = '39.2.4'
$Zip = Join-Path $Root "electron-v$Version-win32-x64.zip"
$Out = Join-Path $Root 'MiniMeet-Manager-Windows-x64'
$Url = "https://github.com/electron/electron/releases/download/v$Version/electron-v$Version-win32-x64.zip"

Write-Host ''
Write-Host '==============================================' -ForegroundColor Cyan
Write-Host ' MiniMeet Manager - Portable Windows EXE' -ForegroundColor Cyan
Write-Host '==============================================' -ForegroundColor Cyan
Write-Host ''

if (Test-Path $Out) {
  Write-Host '[1/5] Eski build siliniyor...'
  Remove-Item -Recurse -Force $Out
}

if (-not (Test-Path $Zip)) {
  Write-Host '[1/5] Electron Windows runtime indiriliyor (~137 MB)...'
  Invoke-WebRequest -Uri $Url -OutFile $Zip -UseBasicParsing
} else {
  Write-Host '[1/5] Electron runtime zaten indirilmis.'
}

Write-Host '[2/5] Runtime aciliyor...'
Expand-Archive -Path $Zip -DestinationPath $Out -Force

Write-Host '[3/5] MiniMeet uygulama dosyalari yerlestiriliyor...'
$Resources = Join-Path $Out 'resources'
$DefaultAsar = Join-Path $Resources 'default_app.asar'
if (Test-Path $DefaultAsar) { Remove-Item -Force $DefaultAsar }
$AppDir = Join-Path $Resources 'app'
New-Item -ItemType Directory -Force -Path $AppDir | Out-Null
Copy-Item -Path (Join-Path $Root 'app\*') -Destination $AppDir -Recurse -Force

$RuntimePackage = @'
{
  "name": "minimeet-manager",
  "version": "0.8.0",
  "main": "main.js",
  "private": true
}
'@
Set-Content -Path (Join-Path $AppDir 'package.json') -Value $RuntimePackage -Encoding UTF8

Write-Host '[4/5] EXE adi duzenleniyor...'
$ElectronExe = Join-Path $Out 'electron.exe'
$MiniMeetExe = Join-Path $Out 'MiniMeet-Manager.exe'
if (Test-Path $ElectronExe) { Rename-Item -Path $ElectronExe -NewName 'MiniMeet-Manager.exe' -Force }

Write-Host '[5/5] Tamamlandi.' -ForegroundColor Green
Write-Host ''
Write-Host "EXE: $MiniMeetExe" -ForegroundColor Green
Write-Host 'NOT: EXE yanindaki DLL ve resources klasorleriyle birlikte tutulmalidir.' -ForegroundColor Yellow
Write-Host ''
Start-Process explorer.exe -ArgumentList $Out
