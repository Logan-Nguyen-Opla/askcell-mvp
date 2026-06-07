@echo off
cd /d "%~dp0backend"

where python >nul 2>nul
if errorlevel 1 goto nopython

if not exist .venv (
  echo Creating virtual environment...
  python -m venv .venv
)
call .venv\Scripts\activate.bat

echo Installing backend dependencies (first run takes a minute)...
python -m pip install --upgrade pip >nul 2>nul
python -m pip install -r requirements.txt
if errorlevel 1 goto installfail

if not exist .env copy .env.example .env >nul

echo.
echo  NOTE: To enable the AI chat, open backend\.env and paste your
echo        GEMINI_API_KEY. The cell scatterplot works without it.
echo.
echo Starting AskCell backend on http://localhost:8000
echo (Leave this window open. Press Ctrl+C to stop.)
echo.
python -m uvicorn app.main:app --reload --port 8000
goto end

:nopython
echo.
echo  Python was NOT found on your PATH.
echo  Install Python 3.10-3.13 from https://www.python.org/downloads/
echo  and tick "Add Python to PATH" during setup, then retry.
goto end

:installfail
echo.
echo  Dependency install failed. Read the messages above for the reason.
goto end

:end
echo.
pause
