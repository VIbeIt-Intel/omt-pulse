@echo off
REM Run read-only patrol push-token diagnostic on production.
cd /d "%~dp0"
call "%~dp0resolve-ssh-key.bat"
set HOST=ubuntu@154.65.108.187

if "%KEY%"=="" (
  echo DIAGNOSTIC FAILED - SSH key not found.
  exit /b 1
)

echo Using key: %KEY%
ssh -i "%KEY%" -o ConnectTimeout=30 "%HOST%" "tr -d '\r' | bash -s" < "%~dp0diagnose-patrol-push.sh"
