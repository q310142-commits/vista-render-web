@echo off
chcp 65001 >nul
title VISTA Local AI Render

REM ============================================================
REM 只需要改下面這一行：ComfyUI_windows_portable 的實際位置
REM 例如：C:\AI\ComfyUI_windows_portable
REM ============================================================
set "COMFY_DIR=C:\AI\ComfyUI_windows_portable"

if not exist "%COMFY_DIR%\python_embeded\python.exe" (
  echo.
  echo [錯誤] 找不到：
  echo %COMFY_DIR%\python_embeded\python.exe
  echo.
  echo 請用記事本打開 START_VISTA_LOCAL.bat，
  echo 把 COMFY_DIR 改成你的 ComfyUI_windows_portable 資料夾。
  echo.
  pause
  exit /b 1
)

echo [1/3] 啟動 ComfyUI RTX 引擎...
start "ComfyUI RTX Engine" /D "%COMFY_DIR%" "%COMFY_DIR%\python_embeded\python.exe" -s "%COMFY_DIR%\ComfyUI\main.py" --windows-standalone-build --listen 127.0.0.1 --port 8188 --lowvram --disable-auto-launch

echo [2/3] 等待 ComfyUI 啟動...
timeout /t 12 /nobreak >nul

echo [3/3] 啟動 VISTA 網頁伺服器...
set "COMFYUI_URL=http://127.0.0.1:8188"
"%COMFY_DIR%\python_embeded\python.exe" "%~dp0vista_local_server.py"

pause
