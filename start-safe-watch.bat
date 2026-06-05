@echo off
if not "%~1"=="--run" (
  start "OIL WOS OCR Watch" /min "%~f0" --run
  exit /b
)
cd /d "%~dp0"
echo LDPlayer safe OCR watch will start.
echo Keep the game on Alliance War ^> Rally tab.
echo Close this window or press Ctrl+C to stop.
echo.
npm.cmd run watch:safe
pause
