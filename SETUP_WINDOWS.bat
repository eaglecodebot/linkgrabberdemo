@echo off
setlocal
cd /d "%~dp0"
echo Link Grabber - first-time setup
echo.
where node >nul 2>nul
if errorlevel 1 goto missingnode
node -e "const v=Number(process.versions.node.split('.')[0]);process.exit(v===24?0:1)"
if errorlevel 1 goto missingnode
echo Installing app dependencies. Keep this window open...
call npm ci --no-audit --no-fund
if errorlevel 1 goto failed
echo.
echo Setup finished. Double-click START_WINDOWS.bat to open the panel.
pause
exit /b 0
:missingnode
echo Install Node.js 24 LTS from https://nodejs.org/ then run this file again.
echo If you just installed it, close this window and reopen this file.
pause
exit /b 1
:failed
echo.
echo Setup did not finish. Check your internet connection and the error above.
echo Send the error text for help. Do not send your API token.
pause
exit /b 1
