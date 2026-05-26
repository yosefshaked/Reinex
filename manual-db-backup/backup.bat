@echo off
:: Supabase Manual DB Backup Launcher
:: Double-click this file to run the backup tool.
:: Requires: Python 3.8+ and the Supabase CLI on PATH.

title Supabase DB Backup

:: Change to the directory where this .bat lives so relative paths work
cd /d "%~dp0"

:: Check Python is available
where python >nul 2>&1
if errorlevel 1 (
    echo.
    echo  ERROR: Python not found in PATH.
    echo  Download Python from https://www.python.org/downloads/
    echo.
    pause
    exit /b 1
)

:: Run the backup script
python backup.py

:: Keep window open on unexpected crash (backup.py already pauses on success/fail)
if errorlevel 1 (
    echo.
    echo  Script exited with an error.
    pause
)
