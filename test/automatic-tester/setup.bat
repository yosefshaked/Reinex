@echo off
title Setup - automatic-tester
REM Ensure the script runs in its own directory (the folder where this .bat lives)
cd /d "%~dp0"

chcp 65001 >nul

echo.
echo Running setup in: %cd%
echo.

REM Check Node.js
where node >nul 2>&1
if errorlevel 1 (
    echo Node.js is not installed or not on PATH. Install Node LTS from https://nodejs.org/
    pause
    goto :end
)
echo Node version: & node -v

REM Check npm
where npm >nul 2>&1
if errorlevel 1 (
    echo npm not found. Please ensure npm is installed with Node.js.
    pause
    goto :end
)
echo npm version: & npm -v

echo.
echo Checking for Supabase CLI and starting services (optional)...
supabase --version >nul 2>&1
if errorlevel 1 (
	echo Supabase CLI not found. Skipping 'supabase start'. If needed, install from https://supabase.com/docs/guides/cli
) else (
	pushd "%~dp0\..\.."
	echo Starting Supabase (Docker) in a new window...
	start "Supabase" /D "%CD%" cmd /k "supabase start"
	echo Starting Reinex app (dev) in a new window...
	start "Reinex Dev" /D "%CD%" cmd /k "npm run dev"
	popd
	echo Supabase and Dev server started in separate windows.
	echo Please wait for services to initialize, then press any key to continue.
	pause
)

echo.
echo Entering test/automatic-tester folder...
cd /d "%~dp0"

echo Installing npm dependencies...
call npm install
if errorlevel 1 (
	echo npm install failed.
	pause
	exit /b 1
)

echo Installing Playwright browsers...
call npm run setup:browsers
if errorlevel 1 (
	echo npm run setup:browsers failed.
	pause
	exit /b 1
)

echo Running setup.js to discover configuration and write .env (if applicable)...
call node setup.js
if errorlevel 1 (
	echo node setup.js failed (non-fatal).
) else (
	echo node setup.js completed.
)

REM Create .env from .env.example only if .env does not exist
if not exist ".env" (
	if exist ".env.example" (
		echo Creating .env from .env.example...
		copy /Y ".env.example" ".env" >nul 2>&1
		if errorlevel 1 (
			echo Failed to copy .env.example to .env. Please copy manually.
		) else (
			echo .env created. Please edit .env with credentials if required.
		)
	) else (
		echo No .env.example found. Please create a .env file manually.
	)
) else (
	echo .env already exists. Skipping copy.
)

echo Starting runner (headed)...
call node runner.js --all --headed
if errorlevel 1 (
	echo Runner exited with error code %errorlevel%.
) else (
	echo Runner completed successfully.
)

echo.
echo Setup finished.
pause

:end
echo.
echo Setup aborted or missing dependency. See messages above.
pause
exit /b 1