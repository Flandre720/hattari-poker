@echo off
chcp 65001 >nul
echo ==============================
echo   ゴキブリポーカー 起動中...
echo ==============================

:: サーバー起動
echo [1/3] サーバー起動中...
start "CockroachPoker-Server" cmd /c "cd /d %~dp0server && npx tsx server.ts"
timeout /t 3 /nobreak >nul

:: クライアント起動
echo [2/3] クライアント起動中...
start "CockroachPoker-Client" cmd /c "cd /d %~dp0 && npm run dev"
timeout /t 5 /nobreak >nul

:: ブラウザで2タブ開く
echo [3/3] ブラウザを開いています...
rundll32 url.dll,FileProtocolHandler http://localhost:5173
timeout /t 2 /nobreak >nul
rundll32 url.dll,FileProtocolHandler http://localhost:5173

echo.
echo ==============================
echo   準備完了！
echo   タブ1: ルームを作成
echo   タブ2: ルームIDを入力して参加
echo ==============================
echo.
echo このウィンドウは閉じてOKです。
pause
