# Figma-Tools

把網站／前端轉成 Figma UI/UX 設計稿的工具組，由兩個部分搭配使用：

| 部分 | 位置 | 做什麼 |
|---|---|---|
| **exporter** | `exporter/` | 用 Playwright 開啟執行中的 React 前端，擷取畫面、共用元件、Hover／點擊狀態與 Prototype 連線，產生 Figma 可匯入的 JSON，並做離線驗證與畫面比對 |
| **plugin** | `plugin/` | Figma 擴充工具：匯入上述 JSON、建立元件與 Instance、套用 Prototype、設定固定圖層、在 Figma 內驗證 |

兩者**必須搭配**：exporter 產生的 JSON 格式（含 `pluginData`、Instance、Prototype schema `uupon-prototype-8`）只有這個 plugin 看得懂；plugin 的匯入規則一改，exporter 的輸出也要一起確認。

## 搭配的 Claude 技能

放在使用者層級 `C:\Users\Eilleen.Chen\.claude\skills\`（不在這個資料夾內）：

- `website-to-react`：官網還原成 React 前端
- `react-to-figma`：前端轉 Figma（使用 exporter + plugin 的完整流程）
- `figma-plugin-maintenance`：維護 plugin

## 快速開始

```powershell
# 1. 前提：要轉換的 React 專案的 dev server 已啟動（預設 http://localhost:5173）
cd exporter
npm install                                   # 第一次
node scripts/figma-export-v2.mjs --size desktop    # 擷取（desktop | tablet | mobile）
node scripts/build-package-v2.mjs --size desktop   # 產生 JSON
node scripts/validate-package-v2.mjs --size desktop

# 2. Plugin 編譯（改過 plugin 才需要）
cd ../plugin
npm install                                   # 第一次
npm run build
```

在 Figma：Plugins → Development → Import plugin from manifest → 選 `plugin/manifest.json`，之後在各尺寸的 Page 匯入 `exporter/figma/` 底下的 JSON（順序：元件 → 畫面 → Prototype → 驗證）。

## 範本檔案（給 Claude 技能用）

`exporter/scripts/make-skill-samples.mjs` 會從最新產出挑出小型範例（畫面、各種元件、Prototype），寫到 Claude 技能 `react-to-figma/templates/`（預設 `%USERPROFILE%\.claude\skillseact-to-figma	emplates`）。JSON 格式有變動時重跑：`node scripts/make-skill-samples.mjs`。

## 設定（環境變數，皆為選用）

| 變數 | 預設 | 說明 |
|---|---|---|
| `FIGMA_TOOLS_FRONTEND` | `C:/Users/Eilleen.Chen/Desktop/UUPON/frontend` | 要轉換的 React 專案資料夾（只讀，用來檢查有沒有被修改） |
| `FIGMA_TOOLS_BASE_URL` | `http://localhost:5173` | dev server 網址 |
| `FIGMA_TOOLS_BROWSER` | Edge 的安裝路徑 | Playwright 使用的瀏覽器執行檔 |

## 版本控制

這個資料夾是獨立的 Git 倉庫。`node_modules`、產出的 JSON（`exporter/figma/*`）與原始擷取資料（`exporter/reports/work/`）都不進 Git，可以用 exporter 重新產生。**`plugin/code.js`（編譯後）有進 Git**，因為 Figma 載入的是它。
