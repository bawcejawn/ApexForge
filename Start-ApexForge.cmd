@echo off
REM ---------------------------------------------------------------------------
REM  Double-click this file to open the ApexForge admin panel.
REM  Keep the black window open while you work; close it to stop the admin.
REM ---------------------------------------------------------------------------
title ApexForge Admin
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js is not installed yet. Follow Part 1 of docs\SETUP-WINDOWS.md
  echo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo  First run: installing ApexForge. This takes 2-4 minutes...
  call npm install
)

REM Open the browser a few seconds after the server starts.
start "" cmd /c "timeout /t 3 >nul & start http://127.0.0.1:4400"
call npm run admin
pause
