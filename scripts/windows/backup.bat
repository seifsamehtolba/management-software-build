@echo off
setlocal
cd /d "%~dp0..\.."

if not exist "backups" mkdir backups

:: Get timestamp via PowerShell (works on all Windows versions including 11)
for /f "delims=" %%T in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd_HHmmss"') do set "TIMESTAMP=%%T"
set "FILENAME=backups\backup_%TIMESTAMP%.sql"

echo Creating backup: %FILENAME%

docker exec store_postgres pg_dump -U storeuser storedb > "%FILENAME%"
if errorlevel 1 (
    echo ERROR: Backup failed. Is Docker running and is the database started?
    if exist "%FILENAME%" del "%FILENAME%"
    pause & exit /b 1
)

echo.
echo Backup saved: %FILENAME%
echo.
echo All backups:
dir /b /o-d backups\*.sql 2>nul
pause
