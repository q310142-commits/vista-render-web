# VISTA Local AI Render — RTX 5060 8GB

這個資料夾讓 VISTA 不經 Gemini / OpenAI API，直接使用公司電腦的 NVIDIA RTX 5060 8GB + ComfyUI 本機算圖。

## 1. 安裝 ComfyUI

建議使用 ComfyUI 官方 Windows NVIDIA Portable 最新版。RTX 50 系列請使用目前官方給新款 NVIDIA GPU 的版本，不要安裝舊版 cu126。

解壓縮建議位置：

C:\AI\ComfyUI_windows_portable

先雙擊官方的 run_nvidia_gpu.bat，確認瀏覽器可開：
http://127.0.0.1:8188

## 2. 安裝一個 SDXL checkpoint

把一個 SDXL / RealVisXL / JuggernautXL 類 checkpoint（.safetensors）放到：

ComfyUI_windows_portable\ComfyUI\models\checkpoints\

第一版只需要一個 SDXL checkpoint 就能工作。

> RTX 5060 8GB 建議一次只放一個主要 SDXL 工作流，先以 1024px、Batch 1 測試。

## 3. 設定 VISTA

用記事本打開：
START_VISTA_LOCAL.bat

確認：

set "COMFY_DIR=C:\AI\ComfyUI_windows_portable"

如果你的 ComfyUI 放在 D 槽，例如 D:\AI\ComfyUI_windows_portable，就改成：

set "COMFY_DIR=D:\AI\ComfyUI_windows_portable"

## 4. 啟動

雙擊：

START_VISTA_LOCAL.bat

等黑色視窗顯示：

Web : http://127.0.0.1:3000

在 Chrome 打開：
http://127.0.0.1:3000

## 5. 給同事使用

在 VISTA 主機按 Win + R，輸入：

cmd

接著輸入：

ipconfig

找到「IPv4 位址」，例如：

192.168.1.50

同公司 LAN / Wi-Fi 的同事使用：

http://192.168.1.50:3000

如果同事連不上，對 ALLOW_LAN_PORT_3000.bat 按右鍵 →「以系統管理員身分執行」。

Windows 網路設定請設成「私人網路」。

## RTX 5060 8GB 建議

- 穩定模式：1024px
- Batch：1
- Denoise：0.24～0.32
- Steps：24
- CFG：5
- ComfyUI：--lowvram
- 不要直接生成 4K；先出 1024，再做 Upscale

Denoise：
- 0.20～0.25：最鎖結構，但改善幅度較小
- 0.26～0.32：室內設計建議區間
- 0.33～0.40：材質變化更明顯，結構漂移風險增加
- >0.40：不建議建築提案底圖使用

## 下一階段

第一版跑通後，可以再加入：
- SDXL ControlNet Canny
- Depth ControlNet
- Tile ControlNet
- 2x / 4x 本機 Upscale
- 材質參考圖
- 局部 Inpaint
- 排隊系統，避免同事同時把 8GB 顯存塞爆

目前 VISTA Local Server 會自動尋找 ComfyUI 裡的 checkpoint；若放了多個，可設定環境變數 VISTA_CHECKPOINT 指定名稱。
