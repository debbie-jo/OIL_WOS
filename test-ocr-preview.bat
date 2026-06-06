@echo off
cd /d "%~dp0"
echo OIL WOS OCR preview test
echo Keep LDPlayer fixed at the large size and open Alliance War ^> Rally.
echo This only captures and reads. It does not publish to the site.
echo.
npm.cmd run capture:safe
npm.cmd run scan:safe -- --debug
echo.
echo Check tools\screenshots\latest.png and tools\screenshots\time-crops\time-1.png
pause
