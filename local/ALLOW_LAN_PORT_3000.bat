@echo off
chcp 65001 >nul
echo 這個檔案需要「以系統管理員身分執行」。
netsh advfirewall firewall add rule name="VISTA Local AI Render" dir=in action=allow protocol=TCP localport=3000 profile=private
echo.
echo 已允許公司私人網路連線到 TCP 3000。
pause
