@echo off
title BuyWise - HTTPS Demo
cd /d "%~dp0"
echo Start ngrok in a second terminal with: ngrok http http://127.0.0.1:3000
echo After this app starts, run: node --env-file=.env.local scripts/configure-ngrok.mjs
echo Keep both the app and ngrok running. Press Ctrl+C to stop this app.
call npm.cmd run build
if errorlevel 1 exit /b 1
node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3000
pause
