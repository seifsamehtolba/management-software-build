@echo off
setlocal
cd /d "%~dp0..\.."

echo ================================================
echo   Database Restore
echo ================================================

if "%~1"=="" (
    echo Usage: drag a backup file onto this script, or run:
    echo   restore.bat backups\backup_20250518_143000.sql
    echo.
    echo Available backups:
    if exist "backups\" (
        dir /b /o-d backups\*.sql 2>nul
    ) else (
        echo   No backups folder found.
    )
    pause & exit /b 1
)

if not exist "%~1" (
    echo ERROR: File not found: %~1
    pause & exit /b 1
)

echo.
echo File:    %~1
echo WARNING: ALL current data will be replaced by this backup.
echo.
set /p CONFIRM=Type YES to continue:
if /i not "%CONFIRM%"=="YES" (
    echo Cancelled.
    pause & exit /b 0
)

echo.
echo Copying backup into container...
docker cp "%~1" store_postgres:/tmp/restore_input.sql
if errorlevel 1 ( echo ERROR: Could not copy file into container. & pause & exit /b 1 )

echo Dropping and recreating schema...
docker exec store_postgres psql -U storeuser -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;" storedb >nul 2>&1

echo Restoring data...
docker exec store_postgres psql -U storeuser -d storedb -f /tmp/restore_input.sql
set RESTORE_ERR=%errorlevel%

docker exec store_postgres rm -f /tmp/restore_input.sql >nul 2>&1

if %RESTORE_ERR% neq 0 (
    echo ERROR: Restore failed.
    pause & exit /b 1
)

echo.
echo Restore complete.
pause
