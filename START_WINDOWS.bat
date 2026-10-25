@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 goto setup
node -e "process.exit(Number(process.versions.node.split('.')[0])===24?0:1)"
if errorlevel 1 goto setup
if not exist "node_modules\gologin\package.json" goto setup
set "LINK_GRABBER_OPEN=1"
node src/server.mjs
echo.
echo Link Grabber has stopped.
pause
exit /b
:setup
echo Please run SETUP_WINDOWS.bat first. This app requires Node.js 24 LTS.
pause
exit /b 1
