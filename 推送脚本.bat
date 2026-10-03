@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

rem ============================================================
rem  GitHub 推送脚本 (elder-protecter)
rem  直连 GitHub 会被重置，所以固定走本地代理 127.0.0.1:7890
rem  如果你的代理换了端口，改下面这一行即可
rem ============================================================
set PROXY=http://127.0.0.1:7890

echo [1/3] 检查代理 %PROXY% ...
powershell -NoProfile -Command "try{(New-Object Net.Sockets.TcpClient).Connect('127.0.0.1',7890);exit 0}catch{exit 1}"
if errorlevel 1 (
  echo   [错误] 代理未启动，请先打开你的代理软件再运行本脚本。
  pause
  exit /b 1
)
echo   代理可用。

echo [2/3] 配置本次推送走代理 ...
git config http.proxy %PROXY%
git config https.proxy %PROXY%

echo [3/3] 推送 main 分支 ...
git push -u origin main
if errorlevel 1 (
  echo.
  echo   [失败] 推送未成功。请把上面的报错发给助手。
  pause
  exit /b 1
)

echo.
echo   推送成功。仓库地址： https://github.com/liuchun878/elder-protecter
pause
