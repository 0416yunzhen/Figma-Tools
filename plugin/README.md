# UUPON Figma Tool（Plugin）

把 React 匯出的 JSON 匯入 Figma，並驗證結果。支援 Desktop 1440、Tablet 800、Mobile 390。

## 開發

```powershell
npm install
npm run build   # tsc → code.js（manifest.json 載入的是編譯後的 code.js）
```

## 功能

- **Figma → JSON**：匯出選取內容、盤點整份 Figma、複製／另存。
- **匯入 JSON → Figma**：選一或多個 JSON，依內容自動判斷為共用元件、畫面或 Prototype（schema `uupon-prototype-8`），依「元件 → 畫面 → Prototype」順序處理；其他一般 Figma 節點 JSON 也可直接建立（可選擇替換同名）。
- **驗證目前 Page**：依 Page 內名稱以 `/ Desktop`、`/ Tablet`、`/ Mobile` 結尾的畫面判斷尺寸，檢查畫面寬度、Reaction（Text／Hotspot／跨頁／重複）、元件 Instance 等，結果可另存為 JSON。

成品檔案與匯入順序見 `UUPON React Figma Audit/README.md`。

## 檔案

- `code.ts`：Plugin 主程式。
- `ui.html`：Plugin 介面。
