@echo off
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js 22.5+ is required. Install it from https://nodejs.org/ & pause & exit /b 1)
node --version
node server.js
pause
