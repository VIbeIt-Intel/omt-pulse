@echo off
REM Deploy fix/licence-front-ocr-v121 (fleet multi-vehicle grid, omt-v167).
cd /d "%~dp0"
call "%~dp0resolve-ssh-key.bat"
set HOST=ubuntu@154.65.108.187

echo.
echo === OMT Pulse: access control visit flow deploy (fix/licence-front-ocr-v121) ===
echo.

if "%KEY%"=="" (
  echo DEPLOY FAILED — SSH key not found.
  echo Put omt-pulse-access.pem in one of these locations, then retry:
  echo   %INTELAFRI_KEY%
  echo   %USERPROFILE%\Downloads\omt-pulse-access.pem
  echo   %USERPROFILE%\.ssh\omt-pulse-access.pem
  pause
  exit /b 1
)

echo Using key: %KEY%
echo.

ssh -i "%KEY%" -o ConnectTimeout=30 "%HOST%" "tr -d '\r' | bash -s" < "%~dp0remote-deploy-access-control-visit-branch.sh"
if errorlevel 1 (
  echo.
  echo DEPLOY FAILED — copy the errors above into Cursor chat.
  pause
  exit /b 1
)

echo.
echo === Done. Check https://omtpulse.com/api/version shows omt-v186 ===
echo Tell testers: force-close OMT Pulse and reopen.
pause
