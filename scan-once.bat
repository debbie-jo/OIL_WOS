@echo off
cd /d "%~dp0"
echo Capturing LDPlayer and syncing visible rallies once.
echo Keep the game on Alliance War ^> Rally tab.
echo.
npm.cmd run capture:safe
npm.cmd run scan:publish
pause
