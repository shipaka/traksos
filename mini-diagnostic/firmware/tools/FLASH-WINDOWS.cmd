@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0flash-windows.ps1"
if errorlevel 1 echo Flash failed. Read the message above.
pause
