@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-Client.ps1"
if errorlevel 1 (
  echo.
  echo PDFit LAN setup did not finish. Please report the error above.
  pause
  exit /b 1
)
echo.
echo PDFit LAN setup finished. Send the generated public key to the PDFit administrator.
pause
