@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

set PORT=5173
set NODE=D:\node\node.exe
if not exist "%NODE%" set NODE=node

echo.
echo   点哪走哪 · 老奶奶 3D 演示
echo   ------------------------------------
echo   正在启动本地服务器 http://127.0.0.1:%PORT%/
echo   浏览器会自动打开。关掉这个黑窗口就等于关闭服务。
echo.

start "" http://127.0.0.1:%PORT%/
"%NODE%" tools\serve.mjs %PORT%

pause
