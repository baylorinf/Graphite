@echo off
cd /d "%~dp0"
if not exist node_modules\marked (
  echo Installing dependencies...
  call npm install
)
node server.js %*
