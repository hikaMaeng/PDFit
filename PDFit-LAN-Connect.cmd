@echo off
setlocal
where ssh >nul 2>&1
if errorlevel 1 (
  echo Windows OpenSSH client is not installed on this computer.
  pause
  exit /b 1
)
echo Connecting this computer to PDFit on 192.168.0.5...
echo Enter the Windows account password for kazak if prompted.
echo Keep this window open while using PDFit.
echo Then open http://localhost:15202 in Chrome.
echo This tunnel is for the local service only. It does not fix sign-in at pdfit.io.
ssh -N -o ExitOnForwardFailure=yes -L 127.0.0.1:15202:127.0.0.1:15202 kazak@192.168.0.5
echo.
echo Connection closed. If SSH showed an error, report that message.
pause
