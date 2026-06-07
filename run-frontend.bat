@echo off
cd /d "%~dp0frontend"

where npm >nul 2>nul
if errorlevel 1 goto nonode

if not exist node_modules goto install
goto run

:install
echo Installing frontend dependencies (first run only, takes a minute)...
call npm install
if errorlevel 1 goto installfail
goto run

:run
if not exist .env copy .env.example .env >nul
echo.
echo Starting AskCell frontend on http://localhost:5173
echo (Leave this window open. Press Ctrl+C to stop.)
echo.
call npm run dev
goto end

:nonode
echo.
echo  ============================================================
echo   Node.js was NOT found on your computer.
echo   The frontend needs it. Install the "LTS" version from:
echo       https://nodejs.org
echo   Then close this window and double-click run-frontend.bat again.
echo  ============================================================
goto end

:installfail
echo.
echo  npm install failed. Read the messages above for the reason.
goto end

:end
echo.
pause
