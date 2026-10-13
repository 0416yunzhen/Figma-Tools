// Desktop 1440 / Mobile 390 共用路由矩陣：React route ↔ Figma Frame 名稱 ↔ 擷取登入狀態。
import { fileURLToPath } from 'node:url';

// 匯出工具的根目錄（exporter/）：由本檔位置推得，搬動資料夾不需要改程式。
export const ROOT = fileURLToPath(new URL('../..', import.meta.url)).split('\\').join('/').replace(/\/$/, '');
// 要轉換的 React 專案（只讀）。可用環境變數 FIGMA_TOOLS_FRONTEND 換成別的專案。
export const FRONTEND_DIR = process.env.FIGMA_TOOLS_FRONTEND || 'C:/Users/Eilleen.Chen/Desktop/UUPON/frontend';
export const BASE_URL = process.env.FIGMA_TOOLS_BASE_URL || 'http://localhost:5173';
export const EDGE = process.env.FIGMA_TOOLS_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

export const SIZES = {
  desktop: { key: 'desktop', label: 'Desktop', width: 1440, height: 900, dir: 'desktop-1440', page: '04. Desktop 1440 Reimport' },
  mobile: { key: 'mobile', label: 'Mobile', width: 390, height: 844, dir: 'mobile-390', page: '05. Mobile 390 Reimport' },
  // Tablet 檔名帶 v4／v8，避免和舊的 tablet-800-*-v3／v7 檔案混淆
  tablet: { key: 'tablet', label: 'Tablet', width: 800, height: 1000, dir: 'tablet-800', page: '03. Tablet 800 Reimport', ver: 'v4', protoVer: 'v8' },
};
for (const size of Object.values(SIZES)) { size.ver ||= 'v1'; size.protoVer ||= 'v1'; }

// [route(含有效 ID), Figma 主名稱, 需登入, 預期主標文字（用來確認不是 not found / 登入頁）]
const ROUTES = [
  ['/', 'Home', false, ''],
  ['/activities/earn', 'Activity / Earn List', false, ''],
  ['/activities/earn/20260930162155769992', 'Activity / Earn Detail', false, ''],
  ['/activities/redeem', 'Activity / Redeem List', false, ''],
  ['/activities/redeem/20231030135614798035', 'Activity / Redeem Detail', false, ''],
  ['/mall', 'Mall / List', false, ''],
  ['/mall/mall-001', 'Mall / Detail', true, ''],
  ['/merchants', 'Merchant / List', false, ''],
  ['/merchants/20180906171900807756', 'Merchant / Detail', false, ''],
  ['/news', 'News / List', false, ''],
  ['/news/news-003', 'News / Detail', false, ''],
  ['/search?q=UUPON', 'Search / Result', false, ''],
  ['/auth/login', 'Auth / Login', false, ''],
  ['/auth/register', 'Auth / Register', false, ''],
  ['/auth/forgot-password', 'Auth / Forgot Password', false, ''],
  ['/member', 'Member / Center', true, ''],
  ['/member/profile', 'Member / Profile Edit', true, ''],
  ['/member/password', 'Member / Change Password', true, ''],
  ['/member/easycard', 'Member / EasyCard Management', true, ''],
  ['/member/points', 'Member / Point Ledger', true, ''],
  ['/member/verify', 'Member / Verify', true, ''],
  ['/point-exchange', 'Point Exchange / Home', false, ''],
  ['/point-exchange/cpc/1', 'V2 / Point Exchange / CPC / Step 01', true, ''],
  ['/point-exchange/cpc/2', 'V2 / Point Exchange / CPC / Step 02', true, ''],
  ['/point-exchange/cpc/3', 'V2 / Point Exchange / CPC / Step 03', true, ''],
  ['/point-exchange/cpc/4', 'V2 / Point Exchange / CPC / Step 04', true, ''],
  ['/point-exchange/hamipoint/1', 'V2 / Point Exchange / HamiPoint / Step 01', true, ''],
  ['/point-exchange/hamipoint/2', 'V2 / Point Exchange / HamiPoint / Step 02', true, ''],
  ['/point-exchange/hamipoint/3', 'V2 / Point Exchange / HamiPoint / Step 03', true, ''],
  ['/point-exchange/hamipoint/4', 'V2 / Point Exchange / HamiPoint / Step 04', true, ''],
  ['/survey', 'Survey / List', true, ''],
  ['/industry-survey', 'Industry Survey', false, ''],
  ['/app-download', 'App Download', false, ''],
  ['/about', 'About UUPON', false, ''],
  ['/partnership', 'Partnership', false, ''],
  ['/cautions', 'Cautions', false, ''],
  ['/faq', 'FAQ', false, ''],
  ['/contact', 'Contact', false, ''],
  ['/newsletter', 'Newsletter', false, ''],
  ['/merchant-rules', 'Merchant Rules', false, ''],
  ['/legal/member', 'Legal / Member', false, ''],
  ['/legal/policy', 'Legal / Privacy', false, ''],
  ['/legal/jointly', 'Legal / Jointly', false, ''],
  // ---- 同一路由的其他狀態（分頁切換、登入後版本）：primary:false 代表不是該路徑的預設畫面 ----
  ['/activities/earn?category=main', 'Activity / Earn List (Main)', false, '', { primary: false }],
  ['/activities/earn?category=tutorial', 'Activity / Earn List (Tutorial)', false, '', { primary: false }],
  ['/activities/redeem?category=main', 'Activity / Redeem List (Main)', false, '', { primary: false }],
  ['/activities/redeem?category=tutorial', 'Activity / Redeem List (Tutorial)', false, '', { primary: false }],
  // 特約商：精選／最新 × 頁碼 1–5（React 的頁碼只切換樣式，內容不變，但畫面上的頁碼狀態不同）
  ['/merchants', 'Merchant / List (Latest)', false, '', { primary: false, after: [{ click: '最新特約商' }] }],
  ...[2, 3, 4, 5].map((n) => ['/merchants', `Merchant / List (Page ${n})`, false, '', { primary: false, after: [{ exact: String(n) }] }]),
  ...[2, 3, 4, 5].map((n) => ['/merchants', `Merchant / List (Latest, Page ${n})`, false, '', { primary: false, after: [{ click: '最新特約商' }, { exact: String(n) }] }]),
  // 搜尋結果：類型篩選（預設 type=earn 就是基本畫面）
  ['/search?q=UUPON&type=redeem', 'Search / Result (Redeem)', false, '', { primary: false }],
  ['/search?q=UUPON&type=merchant', 'Search / Result (Merchant)', false, '', { primary: false }],
  ['/search?q=UUPON&type=news', 'Search / Result (News)', false, '', { primary: false }],
  // 表單與提示（React 有實際畫面變化的按鈕）：顯示密碼、取得認證碼、送出後的錯誤／已儲存訊息、關閉提示
  ['/auth/login', 'Auth / Login (Password Shown)', false, '', { primary: false, after: [{ aria: '顯示密碼' }] }],
  ['/auth/register', 'Auth / Register (Password Shown)', false, '', { primary: false, after: [{ aria: '顯示密碼' }] }],
  ['/auth/register', 'Auth / Register (Code Sent)', false, '', { primary: false, after: [{ click: '認證碼' }] }],
  ['/auth/register', 'Auth / Register (Errors)', false, '', { primary: false, after: [{ click: '立即註冊' }] }],
  ['/auth/forgot-password', 'Auth / Forgot Password (Error)', false, '', { primary: false, after: [{ click: '確認送出' }] }],
  ['/member/profile', 'Member / Profile Edit (Saved)', true, '', { primary: false, after: [{ click: '確認送出' }] }],
  ['/member/profile', 'Member / Profile Edit (Alert Closed)', true, '', { primary: false, after: [{ aria: '關閉' }] }],
  ['/member/password', 'Member / Change Password (Saved)', true, '', { primary: false, after: [{ exact: '確認' }] }],
  ['/', 'Home (Promo Closed)', false, '', { primary: false, after: [{ aria: '關閉' }], sizes: ['desktop', 'tablet'] }],
  ['/search?q=UUPON', 'Search / Result (App Banner Closed)', false, '', { primary: false, after: [{ aria: '關閉' }], sizes: ['tablet', 'mobile'] }],
  ['/merchants', 'Merchant / List (Search Open)', false, '', { primary: false, after: [{ click: '搜尋' }], sizes: ['tablet', 'mobile'] }],
  // 商城詳情：桌機是分頁（預設商品介紹），Tablet／Mobile 是手風琴（預設展開退貨說明）
  ['/mall/mall-001', 'Mall / Detail (Notice)', true, '', { primary: false, after: [{ click: '購買須知' }], sizes: ['desktop'] }],
  ['/mall/mall-001', 'Mall / Detail (Return)', true, '', { primary: false, after: [{ click: '退貨說明' }], sizes: ['desktop'] }],
  ['/mall/mall-001', 'Mall / Detail (Intro)', true, '', { primary: false, after: [{ click: '商品介紹' }], sizes: ['tablet', 'mobile'] }],
  ['/mall/mall-001', 'Mall / Detail (Notice)', true, '', { primary: false, after: [{ click: '購買須知' }], sizes: ['tablet', 'mobile'] }],
  ['/mall/mall-001', 'Mall / Detail (Collapsed)', true, '', { primary: false, after: [{ click: '退貨說明' }], sizes: ['tablet', 'mobile'] }],
  ['/member/points', 'Member / Point Ledger (Earn)', true, '', { primary: false, after: [{ click: '累點紀錄' }] }],
  ['/member/points', 'Member / Point Ledger (Redeem)', true, '', { primary: false, after: [{ click: '兌點紀錄' }] }],
  // 點數交換頁登入後，各服務按鈕直接進入兌換流程（未登入則導向登入）
  ['/point-exchange', 'Point Exchange / Home (Logged In)', true, '', { primary: false, authVariant: true }],
  // Tablet／Mobile 的點數交換頁以「轉入／轉出」分頁呈現（桌機兩個清單同時顯示，沒有分頁）
  ['/point-exchange', 'Point Exchange / Home (Transfer Out)', false, '', { primary: false, after: [{ click: '轉出' }], sizes: ['tablet', 'mobile'] }],
  ['/point-exchange', 'Point Exchange / Home (Logged In, Transfer Out)', true, '', { primary: false, after: [{ click: '轉出' }], sizes: ['tablet', 'mobile'] }],
];

/** 擷取前的額外操作（例如點選分頁），Export、驗證、預覽都用同一份，確保畫面一致。 */
export async function applyAfter(page, m) {
  for (const step of m.after || []) {
    // click：按鈕文字包含；exact：按鈕文字完全相符（頁碼 1–5）
    // 登入／註冊等頁面沒有 <main>，所以改用「排除 Header／Footer／導覽列」的按鈕；
    // aria：以 aria-label 或按鈕文字找（圖示按鈕沒有文字）。
    const BTN = 'button:not(header button, footer button, nav button)';
    const locator = step.aria
      ? page.locator(`${BTN}[aria-label="${step.aria}"], ${BTN}:has-text("${step.aria}")`)
      : step.exact
        ? page.locator(BTN).filter({ hasText: new RegExp(`^${step.exact}$`) })
        : page.locator(BTN, { hasText: step.click });
    await locator.first().click({ timeout: 8000 });
    await page.waitForTimeout(500);
  }
}

export function buildRouteMatrix(size) {
  const s = SIZES[size];
  return ROUTES.filter(([, , , , extra = {}]) => !extra.sizes || extra.sizes.includes(size)).map(([route, base, protectedRoute, expect, extra = {}]) => ({
    route,
    primary: extra.primary !== false,
    after: extra.after || null,
    authVariant: !!extra.authVariant,
    frameName: `${base} / ${s.label}`,
    size: s.key,
    width: s.width,
    auth: protectedRoute ? 'LoggedIn' : 'Guest',
    captureUrl: `${BASE_URL}${route}`,
    needsValidId: /\/(earn|redeem|merchants|news|mall)\/[^/]+$/.test(route.split('?')[0]),
    expectedText: expect,
    pathname: route.split('?')[0],
  }));
}
