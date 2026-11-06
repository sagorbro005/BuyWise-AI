@echo off
title BuyWise AI - Local Workspace
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 22.13 or newer from https://nodejs.org first.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Installing the project's free dependencies...
  call npm.cmd ci
  if errorlevel 1 (
    echo Installation failed. Share the error text, but do not share API keys.
    pause
    exit /b 1
  )
)
echo.
echo BuyWise opens at http://127.0.0.1:3000
echo Keep this window open while using the application.
echo Press Ctrl+C when you want to stop it.
echo.
call npm.cmd run dev
pause
