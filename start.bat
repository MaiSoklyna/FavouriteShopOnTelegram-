@echo off
title Favourite Shop Launcher

echo =============================================
echo   FAVOURITE SHOP - Starting All Services
echo =============================================
echo.
echo  [1] API + Bot       ^>  http://localhost:8000
echo  [2] Frontend        ^>  http://localhost:3000
echo.

REM Start API + Bot (activates root .venv, runs combined mode)
start "API + Bot - Favourite Shop" cmd /k "title API + Bot - Favourite Shop && cd /d "%~dp0" && call .venv\Scripts\activate.bat && cd backend && echo. && echo  Starting API + Bot on http://0.0.0.0:8000 && echo. && python run.py"

REM Start Frontend (Next.js — admin dashboard + miniapp in one app)
start "Frontend - Favourite Shop" cmd /k "title Frontend - Favourite Shop && cd /d "%~dp0frontend" && echo. && echo  Starting Frontend on http://localhost:3000 && echo. && npm run dev"

echo.
echo  Both services are starting in separate windows.
echo  API and Bot run together in ONE process (no 409 conflicts).
echo  You can close this launcher window.
echo.
timeout /t 4 >nul
