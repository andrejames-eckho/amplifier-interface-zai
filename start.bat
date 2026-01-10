@echo off
REM Amplifier Audio Visualizer - Startup Script for Windows
REM One-click launcher for the NPA43A Audio Visualizer application

setlocal enabledelayedexpansion

REM Application details
set APP_NAME=Amplifier Audio Visualizer
set DEFAULT_PORT=8080
set NODE_MIN_VERSION=14.0.0

echo ========================================
echo   %APP_NAME%
echo ========================================
echo.

REM Function to check if Node.js is installed
:check_nodejs
node --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js is not installed. Please install Node.js %NODE_MIN_VERSION% or higher.
    echo Visit: https://nodejs.org/
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('node --version') do set NODE_VERSION=%%i
echo [INFO] Node.js version !NODE_VERSION! detected
goto :eof

REM Function to check if npm is installed
:check_npm
npm --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] npm is not installed. Please install npm.
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('npm --version') do set NPM_VERSION=%%i
echo [INFO] npm version !NPM_VERSION! detected
goto :eof

REM Function to install dependencies
:install_dependencies
echo [INFO] Checking and installing dependencies...

if not exist "node_modules" (
    echo [INFO] Installing dependencies...
    npm install
    if errorlevel 1 (
        echo [ERROR] Failed to install dependencies
        pause
        exit /b 1
    )
    echo [INFO] Dependencies installed successfully
) else (
    echo [INFO] Dependencies already installed
)
goto :eof

REM Function to check if port is available
:check_port
netstat -an | findstr ":%DEFAULT_PORT%" | findstr "LISTENING" >nul 2>&1
if not errorlevel 1 (
    echo [WARN] Port %DEFAULT_PORT% is already in use
    echo Trying to find an available port...
    
    REM Try ports 8080-8090
    for /l %%p in (8080,1,8090) do (
        netstat -an | findstr ":%%p " | findstr "LISTENING" >nul 2>&1
        if errorlevel 1 (
            set DEFAULT_PORT=%%p
            echo [INFO] Found available port: %%p
            goto :port_found
        )
    )
    :port_found
) else (
    echo [INFO] Port %DEFAULT_PORT% is available
)
goto :eof

REM Function to start the application
:start_application
echo [INFO] Starting %APP_NAME% on port %DEFAULT_PORT%...
echo.
echo 🚀 Launching application...
echo 📱 Opening browser automatically...
echo.
echo Press Ctrl+C to stop the application
echo.

REM Open browser after a short delay to let server start
start /min cmd /c "timeout /t 2 >nul 2>&1 && start http://localhost:%DEFAULT_PORT%"

REM Start the server
if exist "src\server.js" (
    set PORT=%DEFAULT_PORT% && node src/server.js
) else (
    echo [ERROR] Server file not found: src\server.js
    pause
    exit /b 1
)
goto :eof

REM Main execution flow
:main
REM Check if we're in the correct directory
if not exist "package.json" (
    echo [ERROR] package.json not found. Please run this script from the project root directory.
    pause
    exit /b 1
)

REM Run checks and setup
call :check_nodejs
call :check_npm
call :install_dependencies
call :check_port

REM Start the application
call :start_application

pause
goto :eof

REM Run main function
call :main
