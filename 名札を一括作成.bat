@echo off
chcp 65001 > nul
title 自撮り狂 首掛け名札 一括作成ツール

echo ======================================================
echo    自撮り狂 首掛け名札 一括作成ツール
echo ======================================================
echo.

python "%~dp0名札一括作成.py"

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ❌ エラーが発生しました。上記のエラーメッセージを確認してください。
    echo.
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo 📂 完成フォルダを開きます...
start "" "%~dp0完成名札"

echo.
echo 完了しました！何かキーを押すとこの画面を閉じます。
pause > nul
