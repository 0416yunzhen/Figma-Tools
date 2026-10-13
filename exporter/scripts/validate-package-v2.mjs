// Desktop 1440 / Mobile 390 離線驗證：讀取已產生的 JSON 並與 React 即時渲染比對。
// 用法：node scripts/validate-package-v2.mjs --size desktop|mobile|tablet
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { ROOT, FRONTEND_DIR, BASE_URL, EDGE, SIZES, buildRouteMatrix, applyAfter } from './lib/route-matrix.mjs';

const sizeKey = process.argv.includes('--size') ? process.argv[process.argv.indexOf('--size') + 1] : 'desktop';
const SIZE = SIZES[sizeKey];
const L = SIZE.label;
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const screens = readJson(path.join(ROOT, 'figma', 'screens', `${SIZE.dir}-all-screens-${SIZE.ver}.json`));
const components = readJson(path.join(ROOT, 'figma', 'components', `${sizeKey}-components-${SIZE.ver}.json`));
const proto = readJson(path.join(ROOT, 'figma', 'prototype', `${SIZE.dir}-${SIZE.protoVer}.json`));
const raw = readJson(path.join(ROOT, 'reports', 'work', SIZE.dir, 'screens-raw.json'));
const report = readJson(path.join(ROOT, 'reports', 'work', SIZE.dir, 'screens-report.json'));
const matrix = buildRouteMatrix(sizeKey);

const hoverDefault = new Map();
for (const c of components) if (c.type === 'COMPONENT_SET' && c.name.startsWith('Hover /')) hoverDefault.set(c.name, c.children.find((v) => v.name === 'State=Default'));
function expandHover(nodes) {
  return nodes.map((n) => {
    if (n.type === 'INSTANCE' && hoverDefault.has(n.component)) return { ...n, type: 'FRAME', children: expandHover(hoverDefault.get(n.component).children || []) };
    return n.children ? { ...n, children: expandHover(n.children) } : n;
  });
}
for (const f of screens) f.expanded = expandHover(f.children);
const walk = (nodes, fn, parent = null, depth = 0) => { for (const n of nodes) { fn(n, parent, depth); if (n.children) walk(n.children, fn, n, depth + 1); } };
const norm = (s) => String(s).replace(/\s+/g, '');
const result = { size: sizeKey, generatedAt: new Date().toISOString(), checks: {}, failures: [], notes: [] };
const check = (name, ok, detail) => { result.checks[name] = { ok, ...(detail === undefined ? {} : { detail }) }; if (!ok) result.failures.push(name); };

// 1. 路由 vs Frame
const frameNames = screens.map((f) => f.name);
const expectedNames = matrix.map((m) => m.frameName);
check('routes_vs_frames', screens.length === matrix.length && expectedNames.every((n) => frameNames.includes(n)), { routes: matrix.length, frames: screens.length, missing: expectedNames.filter((n) => !frameNames.includes(n)) });
// 2. 名稱唯一
const allNames = [...frameNames, ...components.map((c) => c.name)];
check('unique_names', new Set(allNames).size === allNames.length, allNames.filter((n, i) => allNames.indexOf(n) !== i));
check('naming_convention', frameNames.every((n) => n.endsWith(` / ${L}`)), frameNames.filter((n) => !n.endsWith(` / ${L}`)));
// 3. 寬度
check('frame_width', screens.every((f) => f.width === SIZE.width), screens.filter((f) => f.width !== SIZE.width).map((f) => f.name));

// 4. 高度 vs React 獨立重新量測
const heights = [];
{
  const browser = await chromium.launch({ headless: true, executablePath: EDGE });
  const ctxs = {};
  for (const m of matrix) {
    ctxs[m.auth] ||= await (async () => {
      const c = await browser.newContext({ viewport: { width: SIZE.width, height: SIZE.height }, deviceScaleFactor: 1 });
      await c.addInitScript((a) => localStorage.setItem('uupon-auth-status', a), m.auth);
      return c;
    })();
    const page = await ctxs[m.auth].newPage();
    await page.goto(`${BASE_URL}${m.route}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);
    // 圖片載入前高度會偏小（機器忙碌時尤其明顯），和匯出時一樣等圖片載入完成
    await page.evaluate(() => Promise.all([...document.images].filter((i) => !i.complete).map((i) => new Promise((r) => { i.onload = i.onerror = r; setTimeout(r, 4000); }))));
    if (m.pathname === '/survey') await page.click('[role="dialog"] button[aria-label="關閉"]:not(.fixed)').catch(() => {});
    await applyAfter(page, m);
    await page.waitForTimeout(300);
    const h = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight));
    const frame = screens.find((f) => f.name === m.frameName);
    heights.push({ frame: m.frameName, react: h, figma: frame?.height, diff: frame ? frame.height - h : null });
    await page.close();
  }
  await browser.close();
}
const badHeights = heights.filter((x) => x.diff === null || Math.abs(x.diff) > 1);
check('frame_height_equals_scrollHeight', badHeights.length === 0, badHeights);

// 5. 錯誤頁
const bad = report.filter((r) => r.wrongPage || r.notFound || r.loginCaptured || r.status !== 'ok');
check('no_wrong_login_or_notfound_capture', bad.length === 0, bad.map((r) => ({ frame: r.frameName, finalPath: r.finalPath })));
const texts = (frame) => { const t = []; walk(frame.expanded, (n) => n.type === 'TEXT' && t.push(n.characters)); return t; };
const notFoundFrames = screens.filter((f) => texts(f).some((t) => /找不到此|Not Found|404/.test(t))).map((f) => f.name);
check('no_not_found_text', notFoundFrames.length === 0, notFoundFrames);
const authMismatch = screens.filter((f) => f.pluginData.fxAuth !== matrix.find((m) => m.frameName === f.name).auth).map((f) => f.name);
check('guest_loggedin_correct', authMismatch.length === 0, authMismatch);
const loggedHeaderOnGuestFrames = screens.filter((f) => {
  const hdr = f.children.find((c) => c.type === 'INSTANCE' && c.name === 'Header');
  return hdr && !hdr.variant.includes(`Auth=${f.pluginData.fxAuth}`);
}).map((f) => f.name);
check('header_auth_matches_frame', loggedHeaderOnGuestFrames.length === 0, loggedHeaderOnGuestFrames);

// 6. 缺漏／多餘文字（區域外的 DOM 文字 ↔ JSON 文字）
const missing = [], extra = [], controlValueTexts = [];
let domTextCount = 0, jsonTextCount = 0;
for (const { matrix: m, data } of raw) {
  const frame = screens.find((f) => f.name === m.frameName);
  const jsonTexts = [];
  walk(frame.expanded.filter((c) => !(c.type === 'INSTANCE' && c.pluginData?.fxRegion)), (n, parent) => {
    // 輸入框／下拉選單內的文字是控制項的值（placeholder、已選項目），不是 DOM 文字節點。
    if (n.type === 'TEXT' && !['Input', 'Select', 'Textarea'].includes(parent?.pluginData?.fxKind)) jsonTexts.push(n.characters);
    if (n.type === 'TEXT' && ['Input', 'Select', 'Textarea'].includes(parent?.pluginData?.fxKind)) controlValueTexts.push(n.characters);
  });
  const blob = norm(jsonTexts.join(''));
  // 內嵌區域（inline）也算
  domTextCount += data.bodyText.length;
  jsonTextCount += jsonTexts.length;
  for (const t of data.bodyText) if (!blob.includes(norm(t))) missing.push({ frame: m.frameName, text: t.slice(0, 40) });
  const domBlob = norm(data.bodyText.join('') + Object.values(data.regions).flatMap((r) => collectText(r.nodes)).join(''));
  for (const t of jsonTexts) if (!domBlob.includes(norm(t)) && !isControlValue(t)) extra.push({ frame: m.frameName, text: t.slice(0, 40) });
}
function collectText(nodes) { const o = []; walk(expandHover(nodes), (n) => n.type === 'TEXT' && o.push(n.characters)); return o; }
function isControlValue(t) { return /^[•▾‹›]+$/.test(t); }
check('no_missing_text', missing.length === 0, { count: missing.length, samples: missing.slice(0, 10) });
check('no_extra_text', extra.length === 0, { count: extra.length, samples: extra.slice(0, 10) });
result.textTotals = { domTextNodes: domTextCount, jsonTextNodes: jsonTextCount };
// 7. 截斷
const truncated = [];
for (const f of screens) walk(f.children, (n) => { if (n.type === 'TEXT' && n.characters.length === 500) truncated.push({ frame: f.name, text: n.characters.slice(0, 30) }); });
const clamp = raw.reduce((a, r) => a + r.data.stats.lineClampTexts, 0);
check('no_text_truncation', truncated.length === 0, { exactly500chars: truncated, lineClampTexts: clamp });

// 8. 控制項數量
const cmpCounts = [];
for (const { matrix: m, data } of raw) {
  const frame = screens.find((f) => f.name === m.frameName);
  const c = { Input: 0, Select: 0, Checkbox: 0, Radio: 0, Textarea: 0, button: 0, link: 0, inputButton: 0 };
  walk(frame.expanded.filter((n) => !(n.type === 'INSTANCE' && n.pluginData?.fxRegion) && !/\(inline\)$/.test(n.name)), (n) => {
    const k = n.pluginData?.fxKind;
    if (!k) return;
    if (k === 'Button') { if (n.pluginData.inputType) c.inputButton++; else if (n.pluginData.tag === 'a') c.link++; else c.button++; } else c[k]++;
  });
  // 區域外的 DOM 數量（domCounts 已排除 Header / Footer / Chat / Banner / Accordion 區域）
  const d = data.domCounts;
  const diffs = [];
  if (c.Input + c.inputButton !== d.input) diffs.push(['input', c.Input + c.inputButton, d.input]);
  if (c.Select !== d.select) diffs.push(['select', c.Select, d.select]);
  if (c.Textarea !== d.textarea) diffs.push(['textarea', c.Textarea, d.textarea]);
  if (c.Checkbox !== d.checkbox) diffs.push(['checkbox', c.Checkbox, d.checkbox]);
  if (c.Radio !== d.radio) diffs.push(['radio', c.Radio, d.radio]);
  if (c.button !== d.button) diffs.push(['button', c.button, d.button]);
  if (c.link !== d.link) diffs.push(['link', c.link, d.link]);
  if (diffs.length) cmpCounts.push({ frame: m.frameName, diffs });
}
check('control_counts_match_dom', cmpCounts.length === 0, { frames: cmpCounts.length, samples: cmpCounts.slice(0, 8) });

// 9. 元件 / Variant
const comp = (name) => components.find((c) => c.name === name);
const hoverSets0 = () => components.filter((c) => c.type === 'COMPONENT_SET' && c.name.startsWith('Hover /')).length;
const variantCount = (name) => (comp(name)?.children || []).length;
const HEADER = `Header / ${L}`, FOOTER = `Footer / ${L}`, BANNER = `Banner / ${L}`, CHAT = `Chat / ${L}`, FAQ = `FAQ Accordion / ${L}`, SURVEY = `Survey FAQ Accordion / ${L}`, OVERLAY = `Survey Prompt / Overlay / ${L}`;
const counts = { hoverSets: hoverSets0(), [HEADER]: variantCount(HEADER), [FOOTER]: comp(FOOTER) ? 1 : 0, [BANNER]: variantCount(BANNER), [CHAT]: variantCount(CHAT), [FAQ]: variantCount(FAQ), [SURVEY]: variantCount(SURVEY), [OVERLAY]: comp(OVERLAY) ? 1 : 0 };
result.componentCounts = counts;
// Desktop／Tablet：Closed + Earn + Redeem；Mobile 另有漢堡選單 Open。
const expectedHeader = sizeKey === 'mobile' ? 8 : 6;
check('component_variant_counts', counts[HEADER] === expectedHeader && counts[BANNER] === 6 && counts[CHAT] === 2 && counts[FOOTER] === 1 && counts[FAQ] === 14 && counts[SURVEY] === 16 && counts[OVERLAY] === 1, counts);
const headerNames = (comp(HEADER)?.children || []).map((v) => v.name);
check('header_variants_named', ['Guest', 'LoggedIn'].every((a) => (sizeKey !== 'mobile' ? ['Closed', 'Earn', 'Redeem'] : ['Closed', 'Open', 'Earn', 'Redeem']).every((m) => headerNames.includes(`Auth=${a}, Menu=${m}`))), headerNames);

// 10. Prototype
const fxIdIndex = new Map(); // key: set|variant|fxId or frame|fxId → node
const regScreen = new Map();
for (const f of screens) walk(f.children, (n) => { if (n.pluginData?.fxId) regScreen.set(`${f.name}|${n.pluginData.fxId}`, n); });
for (const c of components) if (c.type === 'FRAME') walk(c.children, (n) => { if (n.pluginData?.fxId) regScreen.set(`${c.name}|${n.pluginData.fxId}`, n); });
const regComp = new Map();
for (const c of components) {
  const variants = c.type === 'COMPONENT_SET' ? c.children : [c];
  for (const v of variants) walk(v.children || [], (n) => { if (n.pluginData?.fxId) regComp.set(`${c.name}|${c.type === 'COMPONENT_SET' ? v.name : ''}|${n.pluginData.fxId}`, n); });
}
void fxIdIndex;
const destFrames = new Set([...frameNames, OVERLAY]);
const destVariants = new Set();
for (const c of components) if (c.type === 'COMPONENT_SET') for (const v of c.children) destVariants.add(`${c.name}|${v.name}`);
let missingSource = 0, missingDest = 0, nonFrameSource = 0, crossPage = 0, selfNav = 0;
const keySet = new Set();
let dup = 0;
const perKind = { navigate: 0, changeTo: 0, overlay: 0, close: 0 };
const buttonFramesWithReaction = new Set();
for (const r of proto.reactions) {
  let node = null;
  if (r.source.scope === 'screen') {
    if (r.source.node === 'self') node = screens.find((f) => f.name === r.source.frame) || (r.source.frame === OVERLAY ? comp(OVERLAY) : null);
    else node = regScreen.get(`${r.source.frame}|${r.source.fxId}`) || (r.source.frame === OVERLAY ? findInOverlay(r.source.fxId) : null);
  } else if (r.source.node === 'self') {
    node = comp(r.source.component)?.children?.find((v) => v.name === r.source.variant) || null;
  } else {
    node = regComp.get(`${r.source.component}|${r.source.variant ?? ''}|${r.source.fxId}`) || null;
  }
  if (!node) { missingSource++; continue; }
  if (r.source.node !== 'self' && !['FRAME', 'INSTANCE'].includes(node.type)) nonFrameSource++;
  if (r.source.node !== 'self') buttonFramesWithReaction.add(JSON.stringify(r.source));
  const a = r.action;
  if (a.type === 'NAVIGATE') {
    perKind.navigate++;
    if (!destFrames.has(a.destination)) { missingDest++; crossPage++; }
    if (a.destination === r.source.frame) selfNav++;
  } else if (a.type === 'CHANGE_TO') { perKind.changeTo++; if (!destVariants.has(`${a.component}|${a.variant}`)) missingDest++; }
  else if (a.type === 'OVERLAY') { perKind.overlay++; if (!destFrames.has(a.destination)) missingDest++; }
  else perKind.close++;
  const key = JSON.stringify([r.source, r.trigger, a]);
  if (keySet.has(key)) dup++;
  keySet.add(key);
}
function findInOverlay(fxId) { let hit = null; walk(comp(OVERLAY)?.children || [], (n) => { if (n.pluginData?.fxId === fxId) hit = n; }); return hit; }
check('prototype_sources_exist', missingSource === 0, missingSource);
check('prototype_destinations_exist', missingDest === 0, missingDest);
check('cross_page_navigate_zero', crossPage === 0, crossPage);
check('reaction_sources_are_button_frames', nonFrameSource === 0, nonFrameSource);
check('duplicate_reactions_zero', dup === 0, dup);
check('self_navigate_zero', selfNav === 0, selfNav);
let protoNodes = 0;
for (const f of screens) walk(f.children, (n) => { if (/\[PROTOTYPE\]|\[CONTROL\]/.test(n.name)) protoNodes++; });
for (const c of components) walk([c], (n) => { if (/\[PROTOTYPE\]|\[CONTROL\]/.test(n.name)) protoNodes++; });
check('prototype_hotspot_layers_zero', protoNodes === 0, protoNodes);
const reactionOnNonFrameKinds = proto.reactions.filter((r) => r.source.fxId && /Text|Image|Icon|Background/.test(String((regScreen.get(`${r.source.frame}|${r.source.fxId}`) || regComp.get(`${r.source.component}|${r.source.variant ?? ''}|${r.source.fxId}`) || {}).name || '')) && !/^Button|^Radio|^Checkbox|^Input|^Select/.test(String((regScreen.get(`${r.source.frame}|${r.source.fxId}`) || regComp.get(`${r.source.component}|${r.source.variant ?? ''}|${r.source.fxId}`) || {}).name || '')));
check('text_image_icon_reactions_zero', reactionOnNonFrameKinds.length === 0, reactionOnNonFrameKinds.length);
result.reactionCounts = { total: proto.reactions.length, ...perKind, buttonFramesWithReaction: buttonFramesWithReaction.size, timers: proto.reactions.filter((r) => r.trigger === 'AFTER_TIMEOUT').length, hover: proto.reactions.filter((r) => r.trigger === 'ON_HOVER').length };

// 11. 元件專項
const navReactions = proto.reactions.filter((r) => r.action.type === 'NAVIGATE');
check('navigate_reset_flags', navReactions.every((r) => r.transition.type === 'INSTANT' && r.resetScrollPosition === true && r.resetInteractiveComponents === true && r.trigger === 'ON_CLICK'), navReactions.filter((r) => !(r.transition.type === 'INSTANT' && r.resetScrollPosition && r.resetInteractiveComponents)).length);
// Header
const hdrR = proto.reactions.filter((r) => r.source.component === HEADER);
const hdrInstancesOk = screens.every((f) => f.children.some((c) => (c.type === 'INSTANCE' && c.name === 'Header') || c.name === 'Header (inline)') || f.children.length > 0);
const headerFail = [];
if (sizeKey === 'desktop') {
  if (hdrR.filter((r) => r.trigger === 'MOUSE_ENTER').length < 4) headerFail.push('desktop 滑入展開（MOUSE_ENTER）不足');
  if (hdrR.filter((r) => r.trigger === 'MOUSE_LEAVE').length !== 4) headerFail.push('desktop 離開選單區塊收合（MOUSE_LEAVE）應為 4 條');
} else if (sizeKey === 'mobile') {
  if (hdrR.filter((r) => /選單/.test(r.sourceLabel) && r.action.type === 'CHANGE_TO').length < 4) headerFail.push('mobile 漢堡開關');
} else {
  // Tablet：沒有漢堡，點「輕鬆賺點／好康兌換」展開、再點收合
  if (hdrR.filter((r) => r.trigger === 'ON_CLICK' && r.action.type === 'CHANGE_TO' && /輕鬆賺點|好康兌換/.test(r.sourceLabel)).length < 12) headerFail.push('tablet 選單點擊展開／收合不足');
}
const logoutR = hdrR.filter((r) => r.note && /logout/.test(r.note));
if (logoutR.length === 0) headerFail.push('logout');
if (!hdrInstancesOk) headerFail.push('header instance');
check('header_rules', headerFail.length === 0, headerFail);
const inlineHeaders = screens.filter((f) => f.children.some((c) => c.name === 'Header (inline)')).map((f) => f.name);
result.inlineHeaderFrames = inlineHeaders;
result.notes.push(`Header 以 Instance 呈現；${inlineHeaders.length} 個畫面因 React 該頁 Header 與共用版尺寸不同而內嵌擷取：${inlineHeaders.join('、') || '無'}`);
// Footer
const footerLinks = []; walk(comp(FOOTER).children, (n) => n.pluginData?.href && footerLinks.push(n));
const footerR = proto.reactions.filter((r) => r.source.component === FOOTER);
check('footer_rules', footerLinks.length > 0 && footerR.length === footerLinks.filter((n) => !/^https?:/.test(n.pluginData.href)).length, { links: footerLinks.length, reactions: footerR.length });
// Banner
const bannerV = comp(BANNER).children;
const bannerHashes = bannerV.map((v) => (v.children.find((c) => c.type === 'IMAGE') || {}).imageData?.length + ':' + (v.children.find((c) => c.type === 'IMAGE') || {}).imageData?.slice(200, 260));
const bannerFail = [];
if (new Set(bannerHashes).size !== 6) bannerFail.push('6 張 Banner 圖片不完全不同');
for (const v of bannerV) {
  const btns = v.children.filter((c) => c.pluginData?.fxId);
  if (btns.length !== 7) bannerFail.push(`${v.name} Button 數 ${btns.length}（應為 prev+next+5 dots）`);
  const cur = v.children.filter((c) => /^Dot Current/.test(c.name));
  if (cur.length !== 1) bannerFail.push(`${v.name} 目前圓點數 ${cur.length}`);
  const rs = proto.reactions.filter((r) => r.source.component === BANNER && r.source.variant === v.name);
  if (rs.filter((r) => r.trigger === 'ON_CLICK').length !== 7) bannerFail.push(`${v.name} 點擊 reaction ${rs.filter((r) => r.trigger === 'ON_CLICK').length}`);
  if (rs.filter((r) => r.trigger === 'AFTER_TIMEOUT').length !== 1) bannerFail.push(`${v.name} 自動輪播`);
  if (rs.some((r) => r.action.type === 'CHANGE_TO' && r.action.variant === v.name)) bannerFail.push(`${v.name} 有 self-link`);
}
check('banner_rules', bannerFail.length === 0, bannerFail);
// Chat
const chatC = comp(CHAT).children;
const chatFail = [];
const launcher = chatC.find((v) => v.name === 'State=Closed').children[0];
if (launcher.width !== 58) chatFail.push(`launcher 寬 ${launcher.width}`);
const openV = chatC.find((v) => v.name === 'State=Open');
if (!(openV.width >= 340 && openV.height >= 540)) chatFail.push(`Open 尺寸 ${openV.width}x${openV.height}`);
const chatR = proto.reactions.filter((r) => r.source.component === CHAT);
if (chatR.length !== 2) chatFail.push(`Chat reaction ${chatR.length}`);
if (launcher.children.some((c) => c.pluginData?.fxId)) chatFail.push('logo/icon 有 fxId');
check('chat_rules', chatFail.length === 0, chatFail);
// Accordion
const accFail = [];
for (const [set, rows] of [[FAQ, 13], [SURVEY, 4]]) {
  const vs = comp(set).children;
  for (const v of vs) {
    const btns = []; walk(v.children, (n) => n.pluginData?.fxKind === 'Button' && btns.push(n));
    if (btns.length !== rows) accFail.push(`${set} ${v.name} 問題列 ${btns.length}`);
    const rs = proto.reactions.filter((r) => r.source.component === set && r.source.variant === v.name);
    if (rs.length !== rows) accFail.push(`${set} ${v.name} reaction ${rs.length}`);
  }
}
check('accordion_rules', accFail.length === 0, accFail.slice(0, 6));
// Overlay
const ovR = proto.reactions.filter((r) => r.action.type === 'OVERLAY' || r.action.type === 'CLOSE');
const ovFail = [];
if (ovR.filter((r) => r.action.type === 'CLOSE').length !== 1) ovFail.push('CLOSE 應只有 1 個');
if (ovR.filter((r) => r.action.type === 'OVERLAY' && r.trigger === 'AFTER_TIMEOUT').length !== 1) ovFail.push('auto-open 應有 1 個');
const ovBackdropBtn = []; walk(comp(OVERLAY).children, (n) => n.pluginData?.fxId && ovBackdropBtn.push(n));
if (ovBackdropBtn.length !== 1 + 0 && ovBackdropBtn.filter((n) => n.pluginData.ariaLabel === '關閉').length !== 1) ovFail.push('Overlay 關閉 Button Frame 不是單一');
check('overlay_rules', ovFail.length === 0, ovFail);

// 11b. Frame 一律明確指定填色（避免 Figma 預設白底造成破圖）
let implicitFills = 0;
for (const f of screens) walk(f.children, (n) => { if ((n.type === 'FRAME' || n.type === 'COMPONENT') && n.fills === undefined) implicitFills++; });
for (const c of components) walk([c], (n) => { if ((n.type === 'FRAME' || n.type === 'COMPONENT') && n.fills === undefined) implicitFills++; });
check('frames_have_explicit_fills', implicitFills === 0, implicitFills);
// 11c. Hover 元件
const hoverSets = components.filter((c) => c.type === 'COMPONENT_SET' && c.name.startsWith('Hover /'));
const hoverFail = [];
for (const set of hoverSets) {
  if (set.children.length !== 2) hoverFail.push(`${set.name} Variant ${set.children.length}`);
  const rs = proto.reactions.filter((r) => r.source.component === set.name && r.trigger === 'ON_HOVER');
  if (rs.length !== 1) hoverFail.push(`${set.name} hover reaction ${rs.length}`);
}
let hoverInstances = 0;
const countHover = (nodes) => walk(nodes, (n) => { if (n.type === 'INSTANCE' && hoverDefault.has(n.component)) hoverInstances++; });
for (const f of screens) countHover(f.children);
for (const c of components) countHover([c]);
check('hover_components', sizeKey !== 'desktop' ? hoverSets.length === 0 : hoverSets.length > 0 && hoverFail.length === 0, { sets: hoverSets.length, instances: hoverInstances, failures: hoverFail.slice(0, 5) });
result.hover = { sets: hoverSets.length, instances: hoverInstances };

// 12. React 未修改
let gitStatus = '';
try { gitStatus = execFileSync('git', ['-C', FRONTEND_DIR, 'status', '--short', '--', '.'], { encoding: 'utf8' }).trim(); } catch (e) { gitStatus = 'ERROR ' + e.message; }
check('react_modified_files_zero', gitStatus === '', gitStatus || '(empty)');

// 計數摘要
const nodeCount = (nodes) => { let n = 0; walk(nodes, () => n++); return n; };
result.summary = {
  frames: screens.length,
  frameNodes: screens.reduce((a, f) => a + nodeCount(f.children), 0),
  components: components.length,
  reactions: proto.reactions.length,
  inlineRegions: JSON.parse(fs.readFileSync(path.join(ROOT, 'reports', 'work', SIZE.dir, 'build-summary.json'), 'utf8')).inlineRegions.length,
  heights,
};
result.figmaRuntimeChecks = '尚未執行：匯入 Figma 後請在 Plugin 按「④ 驗證」取得 Figma 內實際 Text/Hotspot/跨頁 NAVIGATE/重複 Reaction 計數。';
result.passed = result.failures.length === 0;
const out = path.join(ROOT, 'reports', `${SIZE.dir}-validation.json`);
fs.writeFileSync(out, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ passed: result.passed, failures: result.failures, reactions: result.reactionCounts, components: counts }, null, 1));
