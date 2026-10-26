@echo off
REM ---------------------------------------------------------------------------
REM  Double-click to SAVE your edits to GitHub and GET the latest updates.
REM  Run it before and after each work session with Claude.
REM  Your .env (keys), data\ (leads) and private\ (partners) are never uploaded.
REM ---------------------------------------------------------------------------
title ApexForge Sync
cd /d "%~dp0"

echo.
echo  1/4  Saving your changes...
git add -A
git commit -m "Operator edits %date% %time%" >nul 2>nul
if errorlevel 1 (echo       Nothing new to save.) else (echo       Saved.)

echo  2/4  Getting the latest updates...
git pull --rebase
if errorlevel 1 (
  echo.
  echo  !! Update stopped because the same file was changed in two places.
  echo  !! Don't worry, nothing is lost. Copy this window's text and send it to Claude.
  echo.
  pause
  exit /b 1
)

echo  3/4  Uploading your changes...
git push

echo  4/4  Updating installed packages...
call npm install --no-audit --no-fund >nul

REM Back up the private partner list (never uploaded to GitHub).
if exist private\partners.json (
  if not exist "%USERPROFILE%\Documents\ApexForge-backup" mkdir "%USERPROFILE%\Documents\ApexForge-backup"
  copy /Y private\partners.json "%USERPROFILE%\Documents\ApexForge-backup\partners.json" >nul
  echo       Partner list backed up to Documents\ApexForge-backup
)

echo.
echo  Done. You're up to date.
pause
