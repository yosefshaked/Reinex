@echo off
setlocal enabledelayedexpansion
title Reinex - Automatic Tester Setup
cd /d "%~dp0"
set "SUPABASE_TELEMETRY_DISABLED=1"
set "TESTER_ROOT=%CD%"

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

set "SUPABASE_STATUS_LOG=%TEMP%\reinex-supabase-status-%RANDOM%.log"
pushd "%TESTER_ROOT%"
call supabase status > "%SUPABASE_STATUS_LOG%" 2>&1
set "SUPABASE_STATUS_ERROR=%ERRORLEVEL%"
popd

if "%SUPABASE_STATUS_ERROR%"=="0" (
    echo [OK] Supabase already running
    if exist "%SUPABASE_STATUS_LOG%" del "%SUPABASE_STATUS_LOG%" >nul 2>&1
    goto :after_supabase
)

echo [WARN] supabase status failed from automatic-tester:
echo        %TESTER_ROOT%
echo.
if exist "%SUPABASE_STATUS_LOG%" (
    type "%SUPABASE_STATUS_LOG%"
    del "%SUPABASE_STATUS_LOG%" >nul 2>&1
) else (
    echo        No status output was captured.
)
echo.
if not exist "%TESTER_ROOT%\supabase\config.toml" (
    echo Supabase config is missing. Creating automatic-tester project config...
    pushd "%TESTER_ROOT%"
    call supabase init --force
    set "SUPABASE_INIT_ERROR=!ERRORLEVEL!"
    popd
    if not "!SUPABASE_INIT_ERROR!"=="0" (
        echo.
        echo [ERROR] supabase init failed. See the message above.
        pause & exit /b 1
    )
)

echo Supabase is not running. Starting it now in a new window...
start "Supabase" /D "%TESTER_ROOT%" cmd /k "call supabase start"
echo.
echo Supabase is starting in that window.
echo When you see "Started supabase local development setup" press any key here.
pause

echo Verifying Supabase after startup...
pushd "%TESTER_ROOT%"
call supabase status
set "SUPABASE_STATUS_ERROR=%ERRORLEVEL%"
popd
if not "%SUPABASE_STATUS_ERROR%"=="0" (
    echo.
    echo [ERROR] Supabase still is not available. See the message above.
    pause & exit /b 1
)
echo [OK] Supabase is running

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
