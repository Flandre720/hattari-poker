@echo off
chcp 65001 >nul
echo ブラウザを開いています...
rundll32 url.dll,FileProtocolHandler http://localhost:5173
timeout /t 2 /nobreak >nul
rundll32 url.dll,FileProtocolHandler http://localhost:5173
echo 2つのタブを開きました。
timeout /t 2 >nul
