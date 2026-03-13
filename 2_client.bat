@echo off
chcp 65001 >nul
title ゴキブリポーカー クライアント
echo ================================
echo   ゴキブリポーカー クライアント
echo   ポート: 5173
echo ================================
echo.
cd /d %~dp0
npm run dev
pause
