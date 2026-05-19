@echo off
setlocal enabledelayedexpansion
title Reinex - Automatic Tester Setup
cd /d "%~dp0"

echo.
echo =====================================================
echo   Reinex Automatic Tester - Setup
echo =====================================================
echo.

REM == 1. Node.js ==
where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js not found. Install from https://nodejs.org/
    pause & exit /b 1
)
for /f "tokens=*" %%v in ('node -v') do echo [OK] Node %%v

REM == 2. Docker ==
where docker >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Docker not found. Install Docker Desktop from https://www.docker.com/
    pause & exit /b 1
)
docker info >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Docker is not running. Start Docker Desktop and try again.
    pause & exit /b 1
)
echo [OK] Docker is running

REM == 3. Supabase ==
echo.
echo Checking Supabase...
where supabase >nul 2>&1
if errorlevel 1 (
    echo [WARN] Supabase CLI not found - assuming it is already running.
    echo        Install CLI: https://supabase.com/docs/guides/cli
    goto :after_supabase
)

supabase status >nul 2>&1
if not errorlevel 1 (
    echo [OK] Supabase already running
    goto :after_supabase
)

echo Supabase is not running. Starting it now in a new window...
pushd "%~dp0..\.."
start "Supabase" cmd /k "supabase start"
popd
echo.
echo Supabase is starting in that window.
echo When you see "Started supabase local development setup" press any key here.
pause

:after_supabase

REM == 4. Reinex app ==
echo.
echo Checking Reinex app (port 4280 or 5173)...
curl -sf --max-time 2 http://localhost:4280/api/config >nul 2>&1
if not errorlevel 1 (
    echo [OK] App is running on port 4280
    goto :after_app
)
curl -sf --max-time 2 http://localhost:5173/api/config >nul 2>&1
if not errorlevel 1 (
    echo [OK] App is running on port 5173
    goto :after_app
)

echo App is not running. Starting it now in two new windows...
pushd "%~dp0..\.."
start "Reinex API" cmd /k "cd api && npm install && func start"
start "Reinex Dev" cmd /k "npm run dev"
popd
echo.
echo The app is starting in those windows.
echo Wait until you see "Local: http://localhost:5173" in the Reinex Dev window.
pause

:after_app

REM == 5. npm install ==
echo.
echo Installing npm dependencies...
call npm install
if errorlevel 1 (
    echo [ERROR] npm install failed.
    pause & exit /b 1
)
echo [OK] Dependencies installed

REM == 6. Playwright browsers ==
echo.
echo Installing Playwright browser binaries...
call npm run setup:browsers
if errorlevel 1 (
    echo [ERROR] Playwright browser setup failed.
    pause & exit /b 1
)
echo [OK] Playwright ready

REM == 7. Auto-configure (schema + users + .env) ==
echo.
echo Running setup.js...
call node setup.js
if errorlevel 1 (
    echo.
    echo [ERROR] setup.js failed. See the output above for details.
    if not exist ".env" (
        echo         No .env was created. Fix the error and re-run this script.
        pause & exit /b 1
    )
    echo [WARN] setup.js had errors but .env already exists - continuing.
) else (
    echo [OK] Setup complete - .env is ready
)

REM == 8. Done ==
echo.
echo =====================================================
echo   Ready!
echo =====================================================
echo.
echo   Run tests:       node runner.js --all --headed
echo   One script:      node runner.js --script student-lifecycle --headed
echo   Validate only:   node runner.js --validate
echo.
set /p RUN_NOW=Run all tests now? [Y/N]:
if /i "!RUN_NOW!"=="Y" (
    echo.
    call node runner.js --all --headed
)

echo.
pause
