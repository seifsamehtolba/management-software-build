@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0..\.."

echo ================================================
echo   Store Management System - First-Time Setup
echo ================================================
echo.

:: Check Docker is available
where docker >nul 2>&1
if errorlevel 1 (
    echo ERROR: Docker not found.
    echo Install Docker Desktop from: https://www.docker.com/products/docker-desktop
    echo Then restart this script.
    pause & exit /b 1
)

:: Check Docker daemon is actually running
docker info >nul 2>&1
if errorlevel 1 (
    echo ERROR: Docker Desktop is not running. Please start it and try again.
    pause & exit /b 1
)

echo [1/5] Starting PostgreSQL database...
docker compose up -d db
if errorlevel 1 (
    echo ERROR: Failed to start database container.
    pause & exit /b 1
)

echo Waiting for database to be ready (this may take a minute on first run)...
:wait_db
docker exec store_postgres pg_isready -U storeuser -d storedb >nul 2>&1
if errorlevel 1 (
    timeout /t 2 /nobreak >nul
    goto wait_db
)
echo   Database is ready.
echo.

echo [2/5] Creating local environment file...
if not exist ".env.local" (
    for /f "delims=" %%s in ('node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"') do set "GENERATED_SECRET=%%s"
    (
        echo DATABASE_URL="postgresql://storeuser:storepassword@localhost:5432/storedb"
        echo NEXTAUTH_SECRET="!GENERATED_SECRET!"
        echo NEXTAUTH_URL="http://localhost:3000"
        echo ETA_API_URL=""
        echo ETA_API_KEY=""
        echo ETA_TIMEOUT_MS="10000"
    ) > .env.local
    echo   Created .env.local with a generated secret.
) else (
    echo   .env.local already exists, skipping.
)

:: Point Prisma CLI at the local DB (it only reads .env, not .env.local)
set DATABASE_URL=postgresql://storeuser:storepassword@localhost:5432/storedb

echo [3/5] Installing dependencies...
call npm install
if errorlevel 1 ( echo ERROR: npm install failed & pause & exit /b 1 )

echo [4/5] Setting up database schema...
call npx prisma db push
if errorlevel 1 ( echo ERROR: Schema push failed & pause & exit /b 1 )

echo [5/5] Creating default admin account...
node scripts/seed-local.mjs
if errorlevel 1 ( echo ERROR: Seed failed & pause & exit /b 1 )

echo.
echo ================================================
echo   Setup complete!
echo.
echo   Login:    admin@store.com
echo   Password: admin123
echo.
echo   Start the app: double-click scripts\windows\start.bat
echo ================================================
pause
