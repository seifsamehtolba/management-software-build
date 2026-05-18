@echo off
setlocal
cd /d "%~dp0..\.."

:: Make sure the database is running
docker compose up -d db >nul 2>&1

echo.
echo ================================================
echo   Store Management System
echo   http://localhost:3000
echo   Press Ctrl+C to stop.
echo ================================================
echo.
npm run dev
