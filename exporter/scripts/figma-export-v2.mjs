// Desktop 1440 / Mobile 390 Figma 匯出：由 React 實際渲染（localhost:5173）擷取可編輯巢狀 JSON。
// 用法：node scripts/figma-export-v2.mjs --size desktop|mobile [--only /route] [--no-components]
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { ROOT, BASE_URL, EDGE, SIZES, buildRouteMatrix, applyAfter } from './lib/route-matrix.mjs';
import { capturePage } from './lib/capture-page.mjs';
import { signature } from './lib/hover-sig.mjs';

const sizeKey = process.argv.includes('--size') ? process.argv[process.argv.indexOf('--size') + 1] : 'desktop';
const SIZE = SIZES[sizeKey];
if (!SIZE) throw new Error('--size 必須是 desktop 或 mobile');
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;
const skipComponents = process.argv.includes('--no-components');
const componentsOnly = process.argv.includes('--components-only');

const OUT_SCREENS = path.join(ROOT, 'figma', 'screens', SIZE.dir);
const OUT_WORK = path.join(ROOT, 'reports', 'work', SIZE.dir);
const idPrefixOf = (name) => `${SIZE.key[0]}:${name}:`;

// 區域選擇器：Mobile 的 Header 是固定在頂端的 nav。
const REGION_SELECTORS = {
  // 只比對站台共用的 Header（含導覽列 nav）與 Footer；APP 下載頁自己的 <header>/<footer> 屬於頁面內容
  // Desktop 是 Logo＋圖片導覽列；Tablet／Mobile 是固定在頂端的綠色 nav
  header: sizeKey === 'desktop' ? 'header:has(nav)' : 'header:has(nav) nav',
  footer: 'footer.bg-neutral-300',
  chat: 'button[aria-label="開啟線上客服"]',
  banner: 'section[aria-label="Home Banner"]',
  // 常見問題頁：ul；問卷頁：含標題與橘色外框的整個 section（展開時外框要跟著長高）
  accordion: 'main ul:not(nav ul):has(> li > button[aria-expanded]), main section:has(> div > div > h3 > button[aria-expanded])',
};

const slug = (s) => s.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();

async function newContext(browser, auth) {
  const context = await browser.newContext({ viewport: { width: SIZE.width, height: SIZE.height }, deviceScaleFactor: 1 });
  await context.addInitScript((status) => { localStorage.setItem('uupon-auth-status', status); }, auth);
  return context;
}

async function inlineSvgs(page) {
  // 以 <img src="*.svg"> 載入的圖示：取回 SVG 原始碼（保留向量）。
  return page.evaluate(async () => {
    const result = {};
    for (const img of document.querySelectorAll('img')) {
      const src = img.currentSrc || img.src;
      if (!/\.svg(\?|$)/i.test(src) || result[src]) continue;
      try {
        let text = await (await fetch(src)).text();
        if (!text.includes('<svg')) continue;
        // 去掉 XML 宣告／DOCTYPE，沒有 viewBox 時以 width/height 補上，縮放才會正確
        text = text.slice(text.indexOf('<svg'));
        const head = text.slice(0, text.indexOf('>') + 1);
        if (!/viewBox=/i.test(head)) {
          const w = parseFloat((head.match(/\swidth="([0-9.]+)/) || [])[1]);
          const h = parseFloat((head.match(/\sheight="([0-9.]+)/) || [])[1]);
          if (w > 0 && h > 0) text = text.replace('<svg', `<svg viewBox="0 0 ${w} ${h}"`);
        }
        result[src] = text;
      } catch { /* 略過 */ }
    }
    return result;
  });
}

async function capture(page, extra = {}) {
  const inlineSvg = await inlineSvgs(page);
  page.__fxSvg = inlineSvg;
  const data = await page.evaluate(capturePage, {
    regionSelectors: REGION_SELECTORS, viewportWidth: SIZE.width, idPrefix: extra.idPrefix || '', rootSelector: null, inlineSvg,
  });
  await screenshotAssets(page, data);
  await page.evaluate(() => document.querySelectorAll('[data-fx-temp]').forEach((e) => e.remove()));
  return data;
}

// 圖片資產：隱藏其他內容，只讓目標元素可見，再裁切螢幕截圖，避免疊在上面的文字或浮層被烙進圖片。
async function screenshotAssets(page, data) {
  if (!data.assets.length) return;
  const cache = new Map();
  const nodes = [];
  const collect = (list) => { for (const n of list) { if (n.type === 'IMAGE') nodes.push(n); if (n.children) collect(n.children); } };
  collect(data.nodes);
  for (const r of Object.values(data.regions)) collect(r.nodes);
  for (const node of nodes) {
    if (node.imageData || node.assetIndex === undefined) continue;
    const selector = `[data-fx-asset="${node.assetIndex}"]`;
    const info = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { src: el.currentSrc || el.src || getComputedStyle(el).backgroundImage, w: Math.round(r.width), h: Math.round(r.height) };
    }, selector);
    if (!info) continue;
    const key = `${info.src}|${node.width}|${node.height}`;
    if (cache.has(key)) { node.imageData = cache.get(key); continue; }
    const buf = await elementShot(page, selector);
    if (buf) { node.imageData = buf; cache.set(key, buf); }
  }
}

async function elementShot(page, selector) {
  // 以 fullPage 裁切，並讓目標元素以外的所有內容 visibility:hidden。
  const box = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (!document.getElementById('fx-capture-style')) {
      const st = document.createElement('style');
      st.id = 'fx-capture-style';
      st.textContent = '[data-fx-capturing] *{visibility:hidden !important}';
      document.head.appendChild(st);
    }
    document.body.setAttribute('data-fx-capturing', '1');
    // 透明背景截圖：去掉 html / body 底色，保留圖片本身的透明區域
    document.documentElement.dataset.fxBg = document.documentElement.style.background;
    document.documentElement.style.setProperty('background', 'transparent', 'important');
    document.body.style.setProperty('background', 'transparent', 'important');
    el.style.setProperty('visibility', 'visible', 'important');
    // 元素自己的文字（直接文字節點）不能烙進背景圖
    el.style.setProperty('color', 'transparent', 'important');
    el.style.setProperty('-webkit-text-fill-color', 'transparent', 'important');
    el.style.setProperty('text-shadow', 'none', 'important');
    // 只截元素本身（背景圖），子層文字不能烙進圖片
    return { x: Math.max(0, r.x + scrollX), y: Math.max(0, r.y + scrollY), width: r.width, height: r.height };
  }, selector);
  if (!box || box.width < 1 || box.height < 1) return null;
  try {
    const buf = await page.screenshot({ clip: { x: box.x, y: box.y, width: Math.min(box.width, 4000), height: Math.min(box.height, 4000) }, fullPage: true, type: 'png', omitBackground: true });
    return buf.toString('base64');
  } catch { return null; } finally {
    await page.evaluate((sel) => {
      document.body.removeAttribute('data-fx-capturing');
      document.documentElement.style.removeProperty('background');
      document.body.style.removeProperty('background');
      const el = document.querySelector(sel);
      if (!el) return;
      el.style.removeProperty('visibility');
      el.style.removeProperty('color');
      el.style.removeProperty('-webkit-text-fill-color');
      el.style.removeProperty('text-shadow');
    }, selector);
  }
}

const withoutBinary = (nodes) => JSON.parse(JSON.stringify(nodes, (k, v) => (k === 'imageData' ? undefined : v)));

async function waitReady(page) {
  await page.waitForLoadState('domcontentloaded');
  // 停用 CSS 動畫（閃爍、淡入等），擷取靜止時的樣式；transition 保留（hover 時間要用）。
  await page.addStyleTag({ content: '*,*::before,*::after{animation:none !important}' }).catch(() => {});
  await page.waitForTimeout(900);
  await page.evaluate(() => Promise.all([...document.images].filter((i) => !i.complete).map((i) => new Promise((r) => { i.onload = i.onerror = r; setTimeout(r, 4000); }))));
  await page.waitForTimeout(150);
}

// ---------- Hover 狀態（僅 Desktop；Mobile 為觸控裝置沒有 hover）----------
const HOVERS = [];
const seenSignatures = new Set();
async function captureOne(page, selector, idPrefix) {
  const d = await page.evaluate(capturePage, {
    regionSelectors: {}, viewportWidth: SIZE.width, idPrefix, rootSelector: selector, rootSelf: true, inlineSvg: page.__fxSvg || {}, markIds: false,
  });
  return d;
}
// 掃描樣式表中的 :hover 規則（含 Tailwind 巢狀與 group-hover），把會被 hover 的元素標上 data-fx-hover。
async function markHoverTargets(page) {
  if (sizeKey !== 'desktop') return 0;
  return page.evaluate(() => {
    const selectors = new Set();
    const visit = (rules, parent) => {
      for (const r of rules) {
        let full = parent;
        if (r.selectorText) {
          full = parent ? (r.selectorText.includes('&') ? r.selectorText.replace(/&/g, parent) : `${parent} ${r.selectorText}`) : r.selectorText;
          if (full.includes(':hover')) selectors.add(full);
        }
        if (r.cssRules) visit(r.cssRules, full);
      }
    };
    for (const sheet of document.styleSheets) { try { visit(sheet.cssRules, ''); } catch { /* 跨網域樣式表 */ } }
    window.__fxHoverSeq = window.__fxHoverSeq || 0;
    let marked = 0;
    for (const full of selectors) {
      // 逗號分隔（忽略括號內逗號）
      const parts = [];
      let depth = 0, cur = '';
      for (const ch of full) { if (ch === '(') depth++; if (ch === ')') depth--; if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch; }
      parts.push(cur);
      for (const part of parts) {
        const isGroup = /\.group\)?:hover/.test(part);
        let els = [];
        try { els = [...document.querySelectorAll(part.replace(/:hover/g, '').trim() || '*:not(*)')]; } catch { continue; }
        for (const e of els) {
          const target = isGroup ? e.closest('.group') : e;
          if (!target || target === document.body || target === document.documentElement) continue;
          const r = target.getBoundingClientRect();
          if (r.width < 2 || r.height < 2) continue;
          if (!target.hasAttribute('data-fx-hover')) { target.setAttribute('data-fx-hover', String(++window.__fxHoverSeq)); marked++; }
        }
      }
    }
    return marked;
  });
}

async function captureHovers(page, { within, outside, before, exclude } = {}) {
  if (sizeKey !== 'desktop') return 0;
  const targets = await page.evaluate(({ within, outside, exclude }) => {
    return [...document.querySelectorAll('[data-fx-hover]')].filter((e) => {
      if (within && !e.closest(within)) return false;
      if (outside && e.closest(outside)) return false;
      if (exclude && e.matches(exclude)) return false;
      const r = e.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return false;
      const cs = getComputedStyle(e);
      const durations = String(cs.transitionDuration || '0s').split(',').map((d) => (d.trim().endsWith('ms') ? parseFloat(d) : parseFloat(d) * 1000));
      e.__fxMs = Math.max(0, ...durations.filter((d) => !Number.isNaN(d)));
      return true;
    }).map((e) => ({ id: e.getAttribute('data-fx-hover'), ms: e.__fxMs, label: (e.getAttribute('aria-label') || e.innerText || e.tagName).replace(/\s+/g, ' ').trim().slice(0, 40) }));
  }, { within, outside, exclude });
  let found = 0;
  for (const t of targets) {
    const sel = `[data-fx-hover="${t.id}"]`;
    const def = (await captureOne(page, sel, `hv${t.id}:d:`)).nodes[0];
    if (!def) continue;
    const sig = signature(def);
    if (seenSignatures.has(sig)) continue;
    seenSignatures.add(sig);
    if (before) await before();
    try {
      await page.hover(sel, { timeout: 1500 });
    } catch {
      continue;
    }
    // 讀取 hover 後實際的過渡時間（例如 group-hover 的子層）
    await page.waitForTimeout(Math.min(600, t.ms || 0) + 120);
    const hovData = await captureOne(page, sel, `hv${t.id}:h:`);
    const hov = hovData.nodes[0];
    if (hov && signature(hov) !== sig) {
      await screenshotAssets(page, hovData);
      HOVERS.push({ sig, label: t.label, hover: hov, dx: hov.x - def.x, dy: hov.y - def.y, transitionMs: Math.max(t.ms || 0, 150) });
      found++;
    }
    await page.mouse.move(1, SIZE.height - 2);
    await page.waitForTimeout(Math.min(600, t.ms || 0) + 60);
  }
  return found;
}

// ---------- 點擊狀態（Checkbox：未勾選 ↔ 已勾選）----------
const CLICKS = [];
const seenClickSignatures = new Set();
async function captureCheckboxClicks(page, controlIds) {
  let found = 0;
  for (const c of controlIds.filter((x) => x.kind === 'Checkbox' && !x.region)) {
    const sel = `[data-fx-id="${c.id}"]`;
    const def = (await captureOne(page, sel, `ck${c.id}:d:`)).nodes[0];
    if (!def) continue;
    const sig = signature(def);
    if (seenClickSignatures.has(sig)) continue;
    seenClickSignatures.add(sig);
    // 隱藏的原生 input 不能用滑鼠點，直接呼叫 click() 觸發 React 的 onChange
    await page.evaluate((s) => document.querySelector(s)?.click(), sel);
    await page.waitForTimeout(150);
    const alt = (await captureOne(page, sel, `ck${c.id}:a:`)).nodes[0];
    await page.evaluate((s) => document.querySelector(s)?.click(), sel);
    await page.waitForTimeout(100);
    if (alt && signature(alt) !== sig) {
      seenClickSignatures.add(signature(alt));
      CLICKS.push({ checked: !!def.pluginData?.checked, def, alt, label: c.label });
      found++;
    }
  }
  return found;
}

// ---------- 畫面 ----------
async function captureScreens(browser) {
  const matrix = buildRouteMatrix(sizeKey).filter((m) => !only || m.route === only);
  const frames = [];
  const report = [];
  const contexts = {};
  for (const m of matrix) {
    const auth = m.auth;
    contexts[auth] ||= await newContext(browser, auth);
    const page = await contexts[auth].newPage();
    const errors = [];
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
    const entry = { route: m.route, frameName: m.frameName, auth, status: 'ok' };
    try {
      await page.goto(`${BASE_URL}${m.route}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await waitReady(page);
      // 問卷提示視窗會自動彈出：另存為 Overlay，先關閉再擷取底層頁面。
      const dialog = await page.$('[role="dialog"]');
      if (dialog && m.route === '/survey') {
        entry.surveyPromptOpened = true;
        await page.click('[role="dialog"] button[aria-label="關閉"]:not(.fixed)').catch(() => page.keyboard.press('Escape'));
        await page.waitForTimeout(400);
      }
      await applyAfter(page, m);
      const finalPath = new URL(page.url()).pathname;
      const bodyText = await page.evaluate(() => document.body.innerText);
      entry.finalPath = finalPath;
      entry.wrongPage = finalPath !== m.pathname;
      entry.notFound = /找不到此(活動|商城項目|商家|消息)/.test(bodyText);
      entry.loginCaptured = finalPath.startsWith('/auth/login') && m.pathname !== '/auth/login';
      await markHoverTargets(page);
      const data = await capture(page, { idPrefix: idPrefixOf(slug(m.frameName)) });
      entry.scrollHeight = data.scrollHeight;
      entry.stats = data.stats;
      entry.domCounts = data.domCounts;
      entry.headings = data.headings;
      entry.regionRects = Object.fromEntries(Object.entries(data.regions).map(([k, v]) => [k, v.rect]));
      entry.horizontalOverflow = data.scrollWidth > SIZE.width;
      frames.push({ matrix: m, data });
      entry.checkboxStates = await captureCheckboxClicks(page, data.controlIds);
      entry.hoverStates = await captureHovers(page, { outside: 'header:has(nav), footer.bg-neutral-300, button[aria-label="開啟線上客服"], section[aria-label="Home Banner"], main ul:not(nav ul):has(> li > button[aria-expanded]), main section:has(> div > div > h3 > button[aria-expanded]), [role="dialog"]' });
    } catch (e) {
      entry.status = 'failed';
      entry.error = String(e);
    }
    entry.consoleErrors = errors.slice(0, 5);
    report.push(entry);
    await page.close();
    console.log(`${entry.status} ${m.frameName} h=${entry.scrollHeight ?? '-'}${entry.wrongPage ? ' WRONG-PAGE' : ''}${entry.notFound ? ' NOT-FOUND' : ''}`);
  }
  for (const c of Object.values(contexts)) await c.close();
  return { frames, report };
}

async function captureAccordion(page, key) {
  const sel = REGION_SELECTORS.accordion;
  const buttons = page.locator(`:is(${sel}) button[aria-expanded]`);
  const count = await buttons.count();
  const variants = [];
  await markHoverTargets(page);
  const grab = async (open) => {
    const d = await page.evaluate(capturePage, { regionSelectors: { accordion: sel }, viewportWidth: SIZE.width, idPrefix: `${sizeKey[0]}:${key}-acc:${open}:`, rootSelector: null, inlineSvg: {} });
    variants.push({ open, region: d.regions.accordion });
  };
  await grab(0);
  // 問題列 hover（只需在全部收合時擷取一次，其他 Variant 以外觀簽章套用）
  await captureHovers(page, { within: sel });
  if (key === 'faq') {
    // 一次只展開一題
    for (let i = 0; i < count; i++) {
      await buttons.nth(i).click();
      await page.waitForTimeout(450);
      await grab(i + 1);
    }
  } else {
    // 各題獨立展開：列舉所有開合組合（以位元遮罩表示）
    let current = 0;
    for (let mask = 1; mask < 2 ** count; mask++) {
      for (let i = 0; i < count; i++) {
        if (((mask >> i) & 1) !== ((current >> i) & 1)) await buttons.nth(i).click();
      }
      current = mask;
      await page.waitForTimeout(450);
      await grab(mask);
    }
  }
  return { count, variants };
}

// ---------- 共用元件各狀態 ----------
async function captureComponentStates(browser) {
  const states = {};
  const hamburger = 'button[aria-label="開啟選單"]';
  for (const auth of ['Guest', 'LoggedIn']) {
    const ctx = await newContext(browser, auth);
    const page = await ctx.newPage();
    await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
    await waitReady(page);
    await markHoverTargets(page);
    const base = await capture(page, { idPrefix: `${sizeKey[0]}:hdr:${auth}:` });
    states[`header:${auth}:Closed`] = base.regions.header;
    // Header / Footer 內各按鈕的 hover（輕鬆賺點、好康兌換的 hover 就是下拉選單 Variant，另外處理）
    await captureHovers(page, { within: auth === 'Guest' ? 'header:has(nav), footer.bg-neutral-300' : 'header:has(nav)', exclude: '.official-nav-earn,.official-nav-redeem' });
    if (auth === 'Guest') {
      states.footer = base.regions.footer;
      states.chatClosed = base.regions.chat;
      states.banner = base.regions.banner;
      states.pageBannerData = base.regions.banner;
    }
    if (sizeKey === 'desktop') {
      for (const [menu, label] of [['Earn', '輕鬆賺點'], ['Redeem', '好康兌換']]) {
        await page.hover(menu === "Earn" ? "button.official-nav-earn" : "button.official-nav-redeem");
        await page.waitForTimeout(250);
        await markHoverTargets(page);
        const d = await capture(page, { idPrefix: `d:hdr:${auth}:${menu}:` });
        states[`header:${auth}:${menu}`] = d.regions.header;
        // 下拉項目 hover：每次先回到主按鈕讓選單維持展開
        const opener = menu === 'Earn' ? 'button.official-nav-earn' : 'button.official-nav-redeem';
        await captureHovers(page, { within: 'header:has(nav)', exclude: '.official-nav-earn,.official-nav-redeem', before: () => page.hover(opener) });
        await page.mouse.move(5, 500);
        await page.waitForTimeout(150);
      }
    } else {
      // 手機有漢堡選單（Open 狀態）；平板（md）導覽列直接展開，沒有漢堡
      if (await page.locator(hamburger).isVisible().catch(() => false)) {
        await page.click(hamburger);
        await page.waitForTimeout(250);
        const open = await capture(page, { idPrefix: `${sizeKey[0]}:hdr:${auth}:Open:` });
        states[`header:${auth}:Open`] = open.regions.header;
      }
      for (const [menu, label] of [['Earn', '輕鬆賺點'], ['Redeem', '好康兌換']]) {
        await page.click(`header nav button:has-text("${label}")`);
        await page.waitForTimeout(250);
        const d = await capture(page, { idPrefix: `${sizeKey[0]}:hdr:${auth}:${menu}:` });
        states[`header:${auth}:${menu}`] = d.regions.header;
        await page.click(`header nav button:has-text("${label}")`);
        await page.waitForTimeout(150);
      }
    }
    if (auth === 'Guest') {
      // Chat Open
      await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
      await waitReady(page);
      await page.click('button[aria-label="開啟線上客服"]');
      await page.waitForTimeout(400);
      const chat = await page.evaluate(capturePage, {
        regionSelectors: { chatPanel: '[role="dialog"][aria-label="線上客服"] aside' }, viewportWidth: SIZE.width, idPrefix: `${sizeKey[0]}:chat:`, rootSelector: null, inlineSvg: {},
      });
      await screenshotAssets(page, chat);
      states.chatOpen = chat.regions.chatPanel;
      // Banner 6 張輪播：切換到每一張再擷取圖片
      const dots = await page.$$('section[aria-label="Home Banner"] button[aria-label^="Banner "]');
      states.bannerSlides = [];
      await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
      await waitReady(page);
      const dotButtons = await page.$$('section[aria-label="Home Banner"] div.absolute.bottom-4 button');
      void dots;
      for (let i = 0; i < dotButtons.length; i++) {
        await dotButtons[i].click();
        await page.waitForTimeout(450);
        const img = await page.evaluate((i) => {
          const sec = document.querySelector('section[aria-label="Home Banner"]');
          const items = sec.querySelectorAll('picture img');
          const el = items[i];
          const r = sec.getBoundingClientRect();
          return { src: el.currentSrc, w: r.width, h: r.height, alt: el.alt };
        }, i);
        const buf = await elementShot(page, `section[aria-label="Home Banner"] div.absolute.inset-0:nth-child(${i + 1}) img`);
        states.bannerSlides.push({ ...img, imageData: buf });
      }
    }
    await ctx.close();
  }
  // 問卷提示 Overlay（登入後自動彈出）與 FAQ / 問卷 FAQ 展開狀態
  const ctx = await newContext(browser, 'LoggedIn');
  const page = await ctx.newPage();
  await page.goto(`${BASE_URL}/survey`, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  await markHoverTargets(page);
  const overlay = await page.evaluate(capturePage, {
    regionSelectors: { surveyPrompt: '[role="dialog"]' }, viewportWidth: SIZE.width, idPrefix: `${sizeKey[0]}:survey-prompt:`, rootSelector: null, inlineSvg: {},
  });
  await screenshotAssets(page, overlay);
  states.surveyPrompt = overlay.regions.surveyPrompt;
  page.__fxSvg = {};
  await captureHovers(page, { within: '[role="dialog"]' });
  // 問卷頁 FAQ 與常見問題頁的手風琴：逐題展開後擷取
  await page.click('[role="dialog"] button[aria-label="關閉"]:not(.fixed)').catch(() => {});
  await page.waitForTimeout(300);
  states.accordions = {};
  states.accordions.survey = await captureAccordion(page, 'survey');
  await page.goto(`${BASE_URL}/faq`, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  states.accordions.faq = await captureAccordion(page, 'faq');
  await ctx.close();
  return states;
}

async function main() {
  await fs.mkdir(OUT_SCREENS, { recursive: true });
  await fs.mkdir(OUT_WORK, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: EDGE });
  if (!componentsOnly) {
    const { frames, report } = await captureScreens(browser);
    // 只重擷取部分路由（--only）時，把結果合併回既有資料，其餘畫面保持不變
    const loadJson = async (name, fallback) => { try { return JSON.parse(await fs.readFile(path.join(OUT_WORK, name), 'utf8')); } catch { return fallback; } };
    let outFrames = frames, outReport = report, outHovers = HOVERS, outClicks = CLICKS;
    if (only) {
      const old = await loadJson('screens-raw.json', []);
      const names = new Set(frames.map((f) => f.matrix.frameName));
      const order = buildRouteMatrix(sizeKey).map((m) => m.frameName);
      outFrames = [...old.filter((f) => !names.has(f.matrix.frameName)), ...frames].sort((a, b) => order.indexOf(a.matrix.frameName) - order.indexOf(b.matrix.frameName));
      const oldReport = await loadJson('screens-report.json', []);
      outReport = [...oldReport.filter((r) => !names.has(r.frameName)), ...report].sort((a, b) => order.indexOf(a.frameName) - order.indexOf(b.frameName));
      const bySig = (a, b) => { const seen = new Set(a.map((x) => x.sig)); return [...a, ...b.filter((x) => !seen.has(x.sig))]; };
      outHovers = bySig(await loadJson('hovers-screens.json', []), HOVERS);
      const oldClicks = await loadJson('clicks-screens.json', []);
      const clickKey = (c) => JSON.stringify(c.def?.children?.length) + c.label;
      const seenClicks = new Set(oldClicks.map(clickKey));
      outClicks = [...oldClicks, ...CLICKS.filter((c) => !seenClicks.has(clickKey(c)))];
    }
    await fs.writeFile(path.join(OUT_WORK, 'screens-raw.json'), JSON.stringify(outFrames));
    await fs.writeFile(path.join(OUT_WORK, 'screens-report.json'), JSON.stringify(outReport, null, 2));
    await fs.writeFile(path.join(OUT_WORK, 'hovers-screens.json'), JSON.stringify(outHovers));
    await fs.writeFile(path.join(OUT_WORK, 'clicks-screens.json'), JSON.stringify(outClicks));
    HOVERS.length = 0;
    CLICKS.length = 0;
  }
  if (!skipComponents) {
    const states = await captureComponentStates(browser);
    await fs.writeFile(path.join(OUT_WORK, 'hovers-components.json'), JSON.stringify(HOVERS));
    HOVERS.length = 0;
    await fs.writeFile(path.join(OUT_WORK, 'component-states.json'), JSON.stringify(states));
    console.log('component states:', Object.keys(states).join(', '));
  }
  await browser.close();
  void withoutBinary;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
