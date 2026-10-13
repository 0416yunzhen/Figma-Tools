# UUPON React → Figma 匯出工具

由 React 實際渲染（`http://localhost:5173`）產生 Figma 可匯入的 JSON。此資料夾**只讀**要轉換的 React 專案（預設 `C:\Users\Eilleen.Chen\Desktop\UUPON\frontend`，可用環境變數 `FIGMA_TOOLS_FRONTEND` 更換），不會修改它。

這是 `Figma-Tools` 的一部分，**必須搭配 `../plugin`（Figma 擴充工具）使用**，詳見上層 `README.md`。

## 成品（匯入 Figma 用）

| 尺寸 | 畫面 | 共用元件 | Prototype | Figma Page |
|---|---|---|---|---|
| Desktop 1440 | `figma/screens/desktop-1440-all-screens-v1.json` | `figma/components/desktop-components-v1.json` | `figma/prototype/desktop-1440-v1.json` | 04. Desktop 1440 Reimport |
| Tablet 800 | `figma/screens/tablet-800-all-screens-v4.json` | `figma/components/tablet-components-v4.json` | `figma/prototype/tablet-800-v8.json` | 03. Tablet 800 Reimport |
| Mobile 390 | `figma/screens/mobile-390-all-screens-v1.json` | `figma/components/mobile-components-v1.json` | `figma/prototype/mobile-390-v1.json` | 05. Mobile 390 Reimport |

驗證報告：`reports/{desktop-1440,tablet-800,mobile-390}-validation.json`。

匯入順序（每個尺寸在各自的 Page）：**共用元件 → 畫面 → Prototype → 驗證**。Plugin 會依檔案內容自動判斷類型，可一次選多個檔案。

## 重新產生

```powershell
# 前提：React dev server 已在 5173 執行
node scripts/figma-export-v2.mjs --size desktop    # 擷取畫面 + 共用元件狀態 + hover 狀態（約 10 分鐘）
node scripts/build-package-v2.mjs --size desktop   # 產生畫面／元件／Prototype JSON
node scripts/validate-package-v2.mjs --size desktop
```

`--size` 可為 `desktop`、`tablet`、`mobile`。`figma-export-v2.mjs` 可加 `--only /route`（Git Bash 要加 `MSYS_NO_PATHCONV=1`）、`--no-components`、`--components-only`。

## 目錄

- `scripts/figma-export-v2.mjs`：Playwright 驅動 Edge，逐路由擷取 DOM 與各元件狀態，輸出到 `reports/work/<尺寸>/`。
- `scripts/build-package-v2.mjs`：由原始擷取資料產生 JSON 成品（Hover 元件、Banner、Chat、手風琴、問卷 Overlay、Prototype）。
- `scripts/validate-package-v2.mjs`：離線驗證（路由／Frame 數、高度、文字、控制項、Prototype 目的地…）。
- `scripts/diff-all.mjs`、`preview-json.mjs`、`preview-hover.mjs`：把 JSON 轉成畫面和 React 逐像素比對／預覽 Hover 元件（輸出放在 `reports/work/`）。
- `scripts/lib/`：共用模組（路由矩陣、DOM 擷取、Hover 簽章）。
- `reports/work/<尺寸>/`：擷取的原始資料，`build` 需要它；刪掉就要重新執行 export。

## 注意

- 登入狀態以 `localStorage['uupon-auth-status']`（`Guest`／`LoggedIn`）切換；需登入的頁面以 LoggedIn 擷取。
- Plugin 在 `../plugin`，`npm run build` 後由 `manifest.json` 載入 `code.js`；第一次使用要在 Figma 的 Plugins → Development → Import plugin from manifest 選 `plugin/manifest.json`。
