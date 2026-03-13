@echo off
chcp 65001 >nul
title Cockroach Poker Server
echo ================================
echo   Cockroach Poker Server
echo   Port: 3001
echo ================================
echo.

REM Kill existing process on port 3001
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3001.*LISTENING"') do (
  echo Stopping existing process PID: %%a
  taskkill /PID %%a /F >nul 2>&1
)
timeout /t 2 /nobreak >nul

cd /d "%~dp0server"
echo Starting server...
echo.
call npx tsx server.ts
echo.
echo [Server stopped] Exit code: %errorlevel%
pause
