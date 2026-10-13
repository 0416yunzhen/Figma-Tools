// 由 figma-export-v2 擷取的原始資料，產生 Desktop 1440 / Mobile 390 的
// 畫面 JSON、共用元件 JSON、Prototype JSON（schema uupon-prototype-8）。
// 用法：node scripts/build-package-v2.mjs --size desktop|mobile|tablet
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, SIZES, buildRouteMatrix } from './lib/route-matrix.mjs';
import { signature } from './lib/hover-sig.mjs';

const sizeKey = process.argv.includes('--size') ? process.argv[process.argv.indexOf('--size') + 1] : 'desktop';
const SIZE = SIZES[sizeKey];
const L = SIZE.label; // Desktop | Mobile | Tablet
const W = SIZE.width;
const WORK = path.join(ROOT, 'reports', 'work', SIZE.dir);
const raw = JSON.parse(fs.readFileSync(path.join(WORK, 'screens-raw.json'), 'utf8'));
const states = JSON.parse(fs.readFileSync(path.join(WORK, 'component-states.json'), 'utf8'));
const matrix = buildRouteMatrix(sizeKey);

const HEADER = `Header / ${L}`;
const FOOTER = `Footer / ${L}`;
const BANNER = `Banner / ${L}`;
const CHAT = `Chat / ${L}`;
const FAQ_ACC = `FAQ Accordion / ${L}`;
const SURVEY_ACC = `Survey FAQ Accordion / ${L}`;
const SURVEY_OVERLAY = `Survey Prompt / Overlay / ${L}`;

const white = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
const round = (v) => Math.round(v * 100) / 100;

// ---------- 工具 ----------
function extent(nodes) {
  let w = 0, h = 0;
  const walk = (list, ox, oy) => {
    for (const n of list) {
      w = Math.max(w, ox + n.x + n.width);
      h = Math.max(h, oy + n.y + n.height);
      if (n.children) walk(n.children, ox + n.x, oy + n.y);
    }
  };
  walk(nodes, 0, 0);
  return { w, h };
}
function walkNodes(nodes, fn, parent = null) {
  for (const n of nodes) { fn(n, parent); if (n.children) walkNodes(n.children, fn, n); }
}
function controlsOf(nodes) {
  const list = [];
  walkNodes(nodes, (n) => { if (n.pluginData?.fxId) list.push(n); });
  return list;
}
function component(name, region, extra = {}) {
  const ext = extent(region.nodes);
  return {
    type: 'COMPONENT', name,
    // 內容只超出幾 px（例如圖片按鈕的外溢）時維持 React 區塊尺寸；下拉選單展開則取內容範圍。
    width: round(ext.w - region.rect.width > 10 ? ext.w : region.rect.width), height: round(ext.h - region.rect.height > 10 ? ext.h : region.rect.height),
    clipsContent: false,
    children: region.nodes,
    ...extra,
  };
}
function stackVariants(variants, gap = 24) {
  let y = 0;
  for (const v of variants) { v.x = 0; v.y = y; y += v.height + gap; }
  return variants;
}
function componentSet(name, variants) {
  stackVariants(variants);
  return { type: 'COMPONENT_SET', name, x: 0, y: 0, width: Math.max(...variants.map((v) => v.width)), height: variants.at(-1).y + variants.at(-1).height, children: variants };
}
const btn = (id, label, x, y, w, h, children, extra = {}) => ({
  type: 'FRAME', name: `Button / ${label}`, x: round(x), y: round(y), width: round(w), height: round(h), clipsContent: false,
  pluginData: { fxId: id, fxKind: 'Button', fxLabel: label, ...extra }, children,
});
const rectNode = (name, x, y, w, h, fills, extra = {}) => ({ type: 'RECTANGLE', name, x: round(x), y: round(y), width: round(w), height: round(h), fills, ...extra });

const components = [];

// ---------- Hover 元件（Default / Hover）----------
// 依 React 實際 hover 前後的擷取結果，把有變化的按鈕／卡片做成 Component Set，
// 畫面上改放 Instance；相同外觀（簽章相同）共用同一組。
const readHover = (f) => (fs.existsSync(path.join(WORK, f)) ? JSON.parse(fs.readFileSync(path.join(WORK, f), 'utf8')) : []);
const hoverTable = new Map();
for (const h of [...readHover('hovers-components.json'), ...readHover('hovers-screens.json')]) if (!hoverTable.has(h.sig)) hoverTable.set(h.sig, h);
const hoverSets = []; // { name, transitionMs, auth }
const hoverSetBySig = new Map();
const hoverComponents = [];
const shortLabel = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 24) || 'Item';
function applyHovers(nodes, auth = 'Guest') {
  return nodes.map((n) => {
    if (n.children) n = { ...n, children: applyHovers(n.children, auth) };
    if (n.type !== 'FRAME' || !n.pluginData?.fxHover) return n;
    const sig = signature(stripHoverPrep(n));
    const entry = hoverTable.get(sig);
    if (!entry) return n;
    let setName = hoverSetBySig.get(sig);
    if (!setName) {
      setName = `Hover / ${shortLabel(n.pluginData.fxLabel || entry.label)} #${hoverSets.length + 1}`;
      hoverSetBySig.set(sig, setName);
      const shift = (list) => list.map((c) => ({ ...c, x: round(c.x + (entry.dx || 0)), y: round(c.y + (entry.dy || 0)) }));
      const hoverChildren = applyHovers(shift(entry.hover.children || []), auth);
      const def = { type: 'COMPONENT', name: 'State=Default', width: n.width, height: n.height, clipsContent: false, fills: [], children: n.children, pluginData: { fxId: `${setName}:default`, fxKind: 'HoverState' } };
      if (n.opacity !== undefined) def.opacity = n.opacity;
      const hov = { type: 'COMPONENT', name: 'State=Hover', width: n.width, height: n.height, clipsContent: false, fills: [], children: hoverChildren, pluginData: { fxId: `${setName}:hover`, fxKind: 'HoverState' } };
      if (entry.hover.opacity !== undefined) hov.opacity = entry.hover.opacity;
      hoverComponents.push(componentSet(setName, [def, hov]));
      hoverSets.push({ name: setName, transitionMs: entry.transitionMs || 150, auth });
      addRegistry(setName, 'State=Default', def.children);
      addRegistry(setName, 'State=Hover', hov.children);
    }
    return { type: 'INSTANCE', name: n.name, component: setName, variant: 'State=Default', x: n.x, y: n.y, width: n.width, height: n.height, pluginData: n.pluginData };
  });
}
// applyHovers 會先處理子層；比對簽章時要用「原始」子層，所以先暫存原節點。
const ORIGINAL = Symbol('original');
function stripHoverPrep(n) { return n[ORIGINAL] || n; }
function prepOriginal(nodes) { for (const n of nodes) { if (n.children) prepOriginal(n.children); if (n.type === 'FRAME' && n.pluginData?.fxHover) n[ORIGINAL] = JSON.parse(JSON.stringify(n)); } return nodes; }
const withHovers = (nodes, auth) => applyHovers(prepOriginal(nodes), auth);

// ---------- Checkbox 點擊元件（Checked=Off / On）----------
const clickPairs = readHover('clicks-screens.json');
const clickBySig = new Map();
clickPairs.forEach((p, i) => {
  const offNode = p.checked ? p.alt : p.def;
  const onNode = p.checked ? p.def : p.alt;
  const pair = { index: i + 1, off: offNode, on: onNode };
  clickBySig.set(signature(offNode), { pair, state: 'Off' });
  clickBySig.set(signature(onNode), { pair, state: 'On' });
});
const checkboxSets = [];
const checkboxComponents = [];
const checkboxBuilt = new Set();
function applyCheckboxes(nodes) {
  return nodes.map((n) => {
    if (n.children) n = { ...n, children: applyCheckboxes(n.children) };
    if (n.type !== 'FRAME' || n.pluginData?.fxKind !== 'Checkbox') return n;
    const hit = clickBySig.get(signature(n));
    if (!hit) return n;
    const setName = `Checkbox #${hit.pair.index}`;
    if (!checkboxBuilt.has(setName)) {
      checkboxBuilt.add(setName);
      const mk = (name, node) => ({ type: 'COMPONENT', name, width: node.width, height: node.height, clipsContent: false, fills: [], children: node.children, pluginData: { fxId: `${setName}:${name}`, fxKind: 'CheckboxState' } });
      checkboxComponents.push(componentSet(setName, [mk('Checked=Off', hit.pair.off), mk('Checked=On', hit.pair.on)]));
      checkboxSets.push(setName);
    }
    return { type: 'INSTANCE', name: n.name, component: setName, variant: `Checked=${hit.state}`, x: n.x, y: n.y, width: n.width, height: n.height, pluginData: n.pluginData };
  });
}
const withClicks = (nodes) => applyCheckboxes(nodes);

// 文字範圍樣式：同一段文字只留最後一筆（內嵌連結會先有一般樣式，再被連結樣式覆蓋）。
function dedupeRanges(ranges) {
  const out = [];
  for (const r of ranges) {
    const i = out.findIndex((x) => x.start === r.start && x.end === r.end);
    if (i >= 0) out.splice(i, 1);
    out.push(r);
  }
  return out.sort((a, b) => a.start - b.start);
}

// Figma 新建 Frame 預設為白底；JSON 沒有指定填色的 Frame 一律設為透明。
function transparentFrames(nodes) {
  for (const n of nodes) {
    if (n.type === 'TEXT' && n.styledRanges) n.styledRanges = dedupeRanges(n.styledRanges);
    if ((n.type === 'FRAME' || n.type === 'COMPONENT') && n.fills === undefined) n.fills = [];
    if (n.children) transparentFrames(n.children);
  }
  return nodes;
}
const registry = []; // { set, variant, node(fxId...), width, height }
const addRegistry = (set, variant, nodes) => {
  for (const c of controlsOf(nodes)) registry.push({ set, variant, fxId: c.pluginData.fxId, label: c.pluginData.fxLabel, href: c.pluginData.href || '', cls: c.pluginData.cls || '', kind: c.pluginData.fxKind, tag: c.pluginData.tag || '', ariaLabel: c.pluginData.ariaLabel || '', inputType: c.pluginData.inputType || '' });
};

// ---------- Header ----------
// 桌機下拉：把主按鈕與下拉項目包進「Menu / Earn」Frame，滑鼠離開整個選單區塊才收合（對應 React li 的 onMouseLeave）。
function wrapDesktopMenu(nodes, auth, menu) {
  const btnCls = menu === 'Earn' ? 'official-nav-earn' : 'official-nav-redeem';
  const trigger = nodes.find((n) => String(n.pluginData?.cls || '').includes(btnCls));
  if (!trigger) return nodes;
  const bottom = trigger.y + trigger.height;
  const inMenu = (n) => n === trigger || (n.y >= bottom - 2 && n.x >= trigger.x - 10 && n.x < trigger.x + trigger.width + 220 && n.y < bottom + 400);
  const members = nodes.filter(inMenu);
  const x1 = Math.min(...members.map((n) => n.x)), y1 = Math.min(...members.map((n) => n.y));
  const x2 = Math.max(...members.map((n) => n.x + n.width)), y2 = Math.max(...members.map((n) => n.y + n.height));
  const wrapper = {
    type: 'FRAME', name: `Menu / ${menu}`, x: round(x1), y: round(y1), width: round(x2 - x1), height: round(y2 - y1), clipsContent: false, fills: [],
    pluginData: { fxId: `${sizeKey[0]}:menu:${auth}:${menu}`, fxKind: 'Menu', fxLabel: `${menu} menu` },
    children: members.map((n) => ({ ...n, x: round(n.x - x1), y: round(n.y - y1) })),
  };
  const out = nodes.filter((n) => !members.includes(n));
  out.push(wrapper);
  return out;
}

const headerVariants = [];
const headerKeys = Object.keys(states).filter((k) => k.startsWith('header:'));
for (const key of headerKeys) {
  const [, auth, menu] = key.split(':');
  const region = { ...states[key], nodes: withHovers(states[key].nodes, auth) };
  const vname = `Auth=${auth}, Menu=${menu}`;
  if (sizeKey === 'desktop' && menu !== 'Closed') region.nodes = wrapDesktopMenu(region.nodes, auth, menu);
  headerVariants.push(component(vname, region, { pluginData: { fxAuth: auth, fxMenu: menu } }));
  addRegistry(HEADER, vname, region.nodes);
}
components.push(componentSet(HEADER, headerVariants));
const headerSize = {};
for (const v of headerVariants) headerSize[v.name] = { width: v.width, height: v.height };

// ---------- Footer ----------
states.footer = { ...states.footer, nodes: withHovers(states.footer.nodes) };
components.push({ ...component(FOOTER, states.footer), x: 0, y: 0 });
addRegistry(FOOTER, null, states.footer.nodes);

// ---------- Banner（6 Slide；上一張／下一張／6 個圓點）----------
const bannerRect = states.banner.rect;
const slides = states.bannerSlides;
const bannerVariants = slides.map((slide, i) => {
  const no = String(i + 1).padStart(2, '0');
  const children = [{ type: 'IMAGE', name: `Image / Banner ${no}`, x: 0, y: 0, width: bannerRect.width, height: bannerRect.height, imageData: slide.imageData }];
  const arrowSize = 44;
  const arrowKids = (glyph, bg) => [
    rectNode('Background', 0, 0, arrowSize, arrowSize, [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 }, opacity: bg }], { cornerRadius: 22 }),
    { type: 'TEXT', name: 'Text', x: 0, y: 4, width: arrowSize, height: 36, characters: glyph, fontSize: 30, textAlignHorizontal: 'CENTER', textAutoResize: 'HEIGHT', fills: white, fontName: { family: 'Noto Sans TC', style: 'Regular' } },
  ];
  const ay = (bannerRect.height - arrowSize) / 2;
  // React：箭頭平常 opacity 0（仍可點），桌機滑過時出現（hover:bg-black/50）
  const arrow = (id, label, glyph, x) => {
    if (sizeKey === 'desktop') {
      const setName = `Hover / Banner ${label}`;
      if (!hoverSets.some((h) => h.name === setName)) {
        const def = { type: 'COMPONENT', name: 'State=Default', width: arrowSize, height: arrowSize, clipsContent: false, fills: [], opacity: 0.01, children: arrowKids(glyph, 0.25), pluginData: { fxId: `${setName}:default`, fxKind: 'HoverState' } };
        const hov = { type: 'COMPONENT', name: 'State=Hover', width: arrowSize, height: arrowSize, clipsContent: false, fills: [], children: arrowKids(glyph, 0.5), pluginData: { fxId: `${setName}:hover`, fxKind: 'HoverState' } };
        hoverComponents.push(componentSet(setName, [def, hov]));
        hoverSets.push({ name: setName, transitionMs: 300, auth: 'Guest' });
      }
      return { type: 'INSTANCE', name: `Button / ${label}`, component: setName, variant: 'State=Default', x, y: ay, width: arrowSize, height: arrowSize, pluginData: { fxId: id, fxKind: 'Button', fxLabel: label, ariaLabel: label } };
    }
    const frame = btn(id, label, x, ay, arrowSize, arrowSize, arrowKids(glyph, 0.25), { ariaLabel: label });
    frame.opacity = 0.01;
    return frame;
  };
  const prev = arrow(`${sizeKey[0]}:banner:${no}:prev`, 'Previous', '‹', 10);
  const next = arrow(`${sizeKey[0]}:banner:${no}:next`, 'Next', '›', bannerRect.width - 10 - arrowSize);
  children.push(prev, next);
  const dotsW = 6 * 10 + 5 * 6;
  for (let d = 0; d < 6; d++) {
    const dno = String(d + 1).padStart(2, '0');
    const x = (bannerRect.width - dotsW) / 2 + d * 16;
    const y = bannerRect.height - 16 - 10;
    if (d === i) {
      children.push(rectNode(`Dot Current ${dno}`, x, y, 10, 10, white, { cornerRadius: 5 }));
    } else {
      children.push(btn(`${sizeKey[0]}:banner:${no}:dot${dno}`, `Banner ${dno}`, x, y, 10, 10, [
        rectNode('Background', 0, 0, 10, 10, [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 }, opacity: 0.45 }], { cornerRadius: 5 }),
      ], { ariaLabel: `Banner ${dno}` }));
    }
  }
  const comp = { type: 'COMPONENT', name: `Slide=${no}`, width: bannerRect.width, height: bannerRect.height, clipsContent: true, children, pluginData: { fxSlide: no } };
  addRegistry(BANNER, comp.name, children);
  return comp;
});
components.push(componentSet(BANNER, bannerVariants));

// ---------- Chat（Closed / Open，實際尺寸）----------
const chatOpen = states.chatOpen;
const boxW = chatOpen.rect.width, boxH = chatOpen.rect.height;
const launcherRegion = states.chatClosed;
const launcherImg = launcherRegion.nodes.find((n) => n.type === 'IMAGE' || n.type === 'SVG');
const launcherSize = launcherRegion.rect.width;
const closedChildren = [
  btn(`${sizeKey[0]}:chat:launcher`, '開啟線上客服', boxW - launcherSize, boxH - launcherSize, launcherSize, launcherSize, [
    rectNode('Background', 0, 0, launcherSize, launcherSize, white, { cornerRadius: launcherSize / 2 }),
    { ...launcherImg, name: launcherImg.type === 'SVG' ? 'Icon / Chat Logo' : 'Image / Chat Logo', x: 0, y: 0, width: launcherSize, height: launcherSize },
  ], { ariaLabel: '開啟線上客服' }),
];
const chatClosed = { type: 'COMPONENT', name: 'State=Closed', width: boxW, height: boxH, clipsContent: false, children: closedChildren };
const chatOpenComp = { type: 'COMPONENT', name: 'State=Open', width: boxW, height: boxH, clipsContent: false, children: chatOpen.nodes };
addRegistry(CHAT, 'State=Closed', closedChildren);
addRegistry(CHAT, 'State=Open', chatOpen.nodes);
components.push(componentSet(CHAT, [chatClosed, chatOpenComp]));

// ---------- 手風琴 ----------
const accInfo = {};
function buildAccordion(setName, data, mode) {
  const names = data.variants.map((v) => {
    if (mode === 'single') return v.open === 0 ? 'Open=None' : `Open=${String(v.open).padStart(2, '0')}`;
    return Array.from({ length: data.count }, (_, i) => `Q${i + 1}=${(v.open >> i) & 1 ? 'Open' : 'Closed'}`).join(', ');
  });
  const vs = data.variants.map((v, i) => {
    v.region = { ...v.region, nodes: withHovers(v.region.nodes) };
    const comp = component(names[i], v.region);
    addRegistry(setName, names[i], v.region.nodes);
    return comp;
  });
  components.push(componentSet(setName, vs));
  accInfo[setName] = { mode, count: data.count, names, opens: data.variants.map((v) => v.open) };
}
buildAccordion(FAQ_ACC, states.accordions.faq, 'single');
buildAccordion(SURVEY_ACC, states.accordions.survey, 'multi');

// ---------- 問卷提示 Overlay（獨立 Frame，供 OPEN_OVERLAY）----------
const sp = states.surveyPrompt;
const overlayNodes = [];
walkNodes(sp.nodes, () => {});
// 背景遮罩按鈕轉為純 Rectangle（避免第二個關閉目標）
const demote = (nodes) => nodes.map((n) => {
  if (n.pluginData?.fxId && n.pluginData.ariaLabel === '關閉' && n.width >= W - 1) {
    const bg = n.children.find((c) => c.name === 'Background');
    return { ...bg, name: 'Backdrop', x: n.x, y: n.y };
  }
  return n.children ? { ...n, children: demote(n.children) } : n;
});
const overlayChildren = demote(withHovers(sp.nodes, 'LoggedIn'));
// Plugin API 無法設定 Overlay 位置，所以 Overlay Frame 與問卷頁同尺寸（置中＝對齊左上角），遮罩涵蓋整頁。
// Figma 以「目前可視範圍」置中 Overlay，所以 Overlay 取一個視窗高度（React 的 fixed inset-0 也是一個視窗高度）。
const surveyHeight = sp.rect.height;
const stretch = (nodes) => nodes.map((n) => (n.name === 'Backdrop' ? { ...n, height: surveyHeight } : n));
const overlayFrame = {
  type: 'FRAME', name: SURVEY_OVERLAY, x: 0, y: 0, width: sp.rect.width, height: surveyHeight, clipsContent: true, fills: [],
  children: stretch(overlayChildren), pluginData: { fxOverlay: 'survey-prompt' },
};
components.push(overlayFrame);
const overlayControls = controlsOf(overlayChildren);
const overlayClose = overlayControls.find((c) => c.pluginData.ariaLabel === '關閉');

// ---------- 畫面 ----------
// 同一路徑可能有多個畫面（分頁狀態、登入版）：byPath 只放預設畫面，其餘用完整網址或登入版索引。
const byPath = new Map(matrix.filter((m) => m.primary).map((m) => [m.pathname, m]));
const byFull = new Map(matrix.filter((m) => !m.primary && !m.after && !m.authVariant).map((m) => [m.route, m]));
const authVariants = new Map(matrix.filter((m) => m.authVariant).map((m) => [m.pathname, m]));
const byName = (n) => matrix.find((m) => m.frameName === `${n} / ${L}`)?.frameName;
const loginFrame = byPath.get('/auth/login').frameName;
function resolveHref(href, sourceAuth) {
  if (!href || /^(#|mailto:|tel:|javascript:)/.test(href)) return { kind: 'none' };
  if (/^https?:\/\//.test(href) && !href.includes('localhost')) return { kind: 'external' };
  let u;
  try { u = new URL(href, 'http://localhost:5173'); } catch { return { kind: 'none' }; }
  let p = u.pathname.replace(/\/$/, '') || '/';
  if (p === '/legal/terms') p = '/legal/member';
  if (p === '/legal/privacy') p = '/legal/policy';
  let target = byFull.get(p + u.search) || byPath.get(p);
  // 登入後的點數交換頁：各服務按鈕直接進入兌換流程
  if (sourceAuth === 'LoggedIn' && authVariants.has(p)) target = authVariants.get(p);
  if (!target) {
    const m = p.match(/^\/(activities\/earn|activities\/redeem|merchants|news|mall)\/[^/]+$/);
    if (m) target = byPath.get(p.replace(/\/[^/]+$/, '')) && matrix.find((x) => x.pathname.startsWith(`/${m[1]}/`));
  }
  if (!target) return /^\/[a-z]/i.test(p) ? { kind: 'frame', frame: byPath.get('/').frameName, via: 'react-wildcard-to-home' } : { kind: 'unmapped', href };
  if (target.auth === 'LoggedIn' && sourceAuth === 'Guest') return { kind: 'frame', frame: loginFrame, via: 'protected-redirect' };
  return { kind: 'frame', frame: target.frameName };
}

const frames = [];
const screenRegistry = []; // { frame, fxId, label, href, kind }
const inlineRegions = [];
for (const { matrix: m, data } of raw) {
  data.nodes = withClicks(withHovers(data.nodes, m.auth));
  for (const reg of Object.values(data.regions)) reg.nodes = withHovers(reg.nodes, m.auth);
  const children = [...data.nodes];
  const pushInstance = (name, comp, variant, rect, extra = {}) =>
    children.push({ type: 'INSTANCE', name, component: comp, variant, x: rect.x, y: rect.y, width: rect.width, height: rect.height, pluginData: { fxRegion: name.toLowerCase(), ...extra } });
  const inline = (name, region) => {
    inlineRegions.push({ frame: m.frameName, region: name });
    children.push({ type: 'FRAME', name: `${name} (inline)`, x: region.rect.x, y: region.rect.y, width: region.rect.width, height: region.rect.height, clipsContent: false, children: region.nodes });
    addScreenControls(region.nodes);
  };
  const addScreenControls = (nodes) => {
    for (const c of controlsOf(nodes)) screenRegistry.push({ frame: m.frameName, auth: m.auth, fxId: c.pluginData.fxId, label: c.pluginData.fxLabel, href: c.pluginData.href || '', kind: c.pluginData.fxKind, tag: c.pluginData.tag || '', ariaLabel: c.pluginData.ariaLabel || '', buttonType: c.pluginData.buttonType || '' });
  };
  addScreenControls(data.nodes);

  // 高度為 0 的區域（例如客服站桌機版隱藏的站台 Header）不是畫面的一部分。
  const r = Object.fromEntries(Object.entries(data.regions).filter(([, v]) => v.rect.width >= 1 && v.rect.height >= 1));
  if (r.accordion) {
    const set = m.pathname === '/survey' ? SURVEY_ACC : FAQ_ACC;
    const info = accInfo[set];
    const closed = info.names[0];
    pushInstance('FAQ Accordion', set, closed, r.accordion.rect);
  }
  if (r.banner) pushInstance('Banner', BANNER, 'Slide=01', r.banner.rect);
  if (r.footer) {
    const c = components.find((x) => x.name === FOOTER);
    if (Math.abs(r.footer.rect.height - c.height) <= 1 && Math.abs(r.footer.rect.width - c.width) <= 1) pushInstance('Footer', FOOTER, null, r.footer.rect);
    else inline('Footer', r.footer);
  }
  if (r.header) {
    const vname = `Auth=${m.auth}, Menu=Closed`;
    const sz = headerSize[vname];
    if (sz && Math.abs(r.header.rect.height - sz.height) <= 1 && Math.abs(r.header.rect.width - sz.width) <= 1) pushInstance('Header', HEADER, vname, r.header.rect);
    else inline('Header', r.header);
  }
  if (r.chat) {
    const cr = r.chat.rect;
    pushInstance('Chat', CHAT, 'State=Closed', { x: round(cr.x + cr.width - boxW), y: round(cr.y + cr.height - boxH), width: boxW, height: boxH });
  }
  const pageData = { fxRoute: m.route, fxAuth: m.auth, fxScrollHeight: String(data.scrollHeight), fxSurveyPrompt: m.pathname === '/survey' ? '1' : '' };
  const acc = children.find((c) => c.type === 'INSTANCE' && c.name === 'FAQ Accordion');
  if (!acc) {
    frames.push({ type: 'FRAME', name: m.frameName, x: 0, y: 0, width: W, height: data.scrollHeight, clipsContent: true, fills: white, pluginData: pageData, children });
    continue;
  }
  // 手風琴展開會變高：把畫面拆成「上方內容 / 手風琴 / 下方內容」三段垂直 Auto Layout，
  // 手風琴切換 Variant 時下方內容會被往下推（Figma 的 Prototype 不會自動重排絕對定位的元素）。
  const accBottom = acc.y + acc.height;
  const chat = children.find((c) => c.type === 'INSTANCE' && c.name === 'Chat');
  // Tablet／Mobile 的 Header 在 React 是 position: fixed，需留在 Frame 最上層才能設為固定。
  const pinnedHeader = sizeKey !== 'desktop' ? children.find((c) => c.type === 'INSTANCE' && c.name === 'Header') : null;
  const rest = children.filter((c) => c !== acc && c !== chat && c !== pinnedHeader);
  const belowNodes = rest.filter((c) => c.y >= accBottom - 1).map((c) => ({ ...c, y: round(c.y - accBottom) }));
  const topNodes = rest.filter((c) => c.y < accBottom - 1);
  const group = (name, h, kids) => ({ type: 'FRAME', name, x: 0, y: 0, width: W, height: Math.max(h, 0.01), clipsContent: false, fills: [], children: kids });
  const row = {
    type: 'FRAME', name: 'Accordion Row', x: 0, y: 0, width: W, height: acc.height, clipsContent: false, fills: [],
    layoutMode: 'HORIZONTAL', primaryAxisSizingMode: 'FIXED', counterAxisSizingMode: 'AUTO', paddingLeft: acc.x, itemSpacing: 0,
    children: [{ ...acc, x: 0, y: 0 }],
  };
  const stackChildren = [group('Above Accordion', acc.y, topNodes), row, group('Below Accordion', data.scrollHeight - accBottom, belowNodes)];
  if (pinnedHeader) stackChildren.push({ ...pinnedHeader, layoutPositioning: 'ABSOLUTE' });
  if (chat) stackChildren.push({ ...chat, layoutPositioning: 'ABSOLUTE' });
  frames.push({
    type: 'FRAME', name: m.frameName, x: 0, y: 0, width: W, height: data.scrollHeight, clipsContent: true, fills: white, pluginData: pageData,
    layoutMode: 'VERTICAL', primaryAxisSizingMode: 'AUTO', counterAxisSizingMode: 'FIXED', itemSpacing: 0,
    children: stackChildren,
  });
}

// ---------- Prototype ----------
const reactions = [];
const unmapped = [];
const addReaction = (r) => {
  // Figma 不接受 CHANGE_TO 指向來源自己所在的 Variant。
  if (r.action.type === 'CHANGE_TO' && r.source.scope === 'component' && r.source.variant === r.action.variant && r.source.component === r.action.component) return;
  reactions.push({ id: `R${String(reactions.length + 1).padStart(4, '0')}`, transition: { type: 'INSTANT' }, ...r });
};
const nav = (source, label, frame, extra = {}) => addReaction({ source, sourceLabel: label, trigger: 'ON_CLICK', action: { type: 'NAVIGATE', destination: frame }, resetScrollPosition: true, resetInteractiveComponents: true, ...extra });

// 狀態切換規則：[畫面名稱前綴, [[標籤, 目標畫面]]]（前綴相同的畫面視為同一家族）
const FAMILY_RULES = [
  ['Auth / Login', [[/^顯示密碼$/, 'Auth / Login (Password Shown)'], [/^隱藏密碼$/, 'Auth / Login']]],
  ['Auth / Register', [[/^顯示密碼$/, 'Auth / Register (Password Shown)'], [/^隱藏密碼$/, 'Auth / Register'], [/認證碼/, 'Auth / Register (Code Sent)'], [/^立即註冊$/, 'Auth / Register (Errors)']]],
  ['Auth / Forgot Password', [[/^確認送出$/, 'Auth / Forgot Password (Error)']]],
  ['Member / Profile Edit', [[/^確認送出$/, 'Member / Profile Edit (Saved)'], [/^關閉$/, 'Member / Profile Edit (Alert Closed)']]],
  ['Member / Change Password', [[/^確認$/, 'Member / Change Password (Saved)']]],
  ['Home', [[/^關閉$/, 'Home (Promo Closed)']]],
  ['Search / Result', [[/^關閉$/, 'Search / Result (App Banner Closed)']]],
  ['Merchant / List', [[/^搜尋$/, 'Merchant / List (Search Open)']]],
];
// 分頁按鈕規則：[畫面名稱前綴, [[標籤, 目標畫面]]]
const TAB_RULES = [
  ['Member / Point Ledger', [[/^所有紀錄$/, 'Member / Point Ledger'], [/^累點紀錄$/, 'Member / Point Ledger (Earn)'], [/^兌點紀錄$/, 'Member / Point Ledger (Redeem)']]],
];
// 螢幕層：Button Frame（連結）
const flowByFrame = {};
const flowRules = [
  ['V2 / Point Exchange / CPC / Step 01', /下一步/, 'V2 / Point Exchange / CPC / Step 02'],
  ['V2 / Point Exchange / CPC / Step 02', /確認轉出/, 'V2 / Point Exchange / CPC / Step 03'],
  ['V2 / Point Exchange / CPC / Step 03', /確認送出/, 'V2 / Point Exchange / CPC / Step 04'],
  ['V2 / Point Exchange / CPC / Step 04', /回點數轉換頁|返回/, 'V2 / Point Exchange / CPC / Step 01'],
  ['V2 / Point Exchange / HamiPoint / Step 01', /試算/, 'V2 / Point Exchange / HamiPoint / Step 02'],
  ['V2 / Point Exchange / HamiPoint / Step 02', /確認送出/, 'V2 / Point Exchange / HamiPoint / Step 03'],
  ['V2 / Point Exchange / HamiPoint / Step 03', /確認轉出/, 'V2 / Point Exchange / HamiPoint / Step 04'],
  ['V2 / Point Exchange / HamiPoint / Step 04', /回點數轉換頁|返回/, 'V2 / Point Exchange / HamiPoint / Step 01'],
];
for (const c of screenRegistry) {
  const frame = c.frame;
  const homeFrame = byPath.get('/').frameName;
  if (c.href) {
    const res = resolveHref(c.href, c.auth);
    if (res.kind === 'frame') {
      if (res.frame !== frame) nav({ scope: 'screen', frame, fxId: c.fxId }, c.label, res.frame);
    } else if (res.kind === 'unmapped') unmapped.push({ frame, label: c.label, href: c.href });
    continue;
  }
  if (c.kind !== 'Button') continue;
  for (const [fname, re, target] of flowRules) {
    if (frame === `${fname} / ${L}` && re.test(c.label) && c.buttonType !== 'hidden') nav({ scope: 'screen', frame, fxId: c.fxId }, c.label, `${target} / ${L}`, { note: 'React navigate()' });
  }
  // React 登入後回到來源頁（預設首頁）。原型沒有「登入後首頁」畫面，改導向會員中心（LoggedIn），之後才能點到問卷等需登入頁面。
  // 分頁按鈕（React 以 state 切換，沒有 href）：依畫面與標籤導向對應的分頁畫面。
  for (const [frameBase, rules] of TAB_RULES) {
    if (!(frame === `${frameBase} / ${L}` || frame.startsWith(`${frameBase} (`))) continue;
    for (const [re, targetBase] of rules) {
      const targetFrame = byName(targetBase);
      if (re.test(c.label) && targetFrame && targetFrame !== frame) nav({ scope: 'screen', frame, fxId: c.fxId }, c.label, targetFrame, { note: '分頁切換' });
    }
  }
  // 其他有畫面變化的按鈕（顯示密碼、送出後的訊息、關閉提示、搜尋面板）：同一家族的畫面互相導向
  for (const [base, rules] of FAMILY_RULES) {
    if (!(frame === `${base} / ${L}` || frame.startsWith(`${base} (`))) continue;
    for (const [re, targetBase] of rules) {
      const targetFrame = byName(targetBase);
      if (re.test(c.label) && targetFrame && targetFrame !== frame) nav({ scope: 'screen', frame, fxId: c.fxId }, c.label, targetFrame, { note: '狀態切換' });
    }
  }
  if (frame.startsWith('Merchant / List (Search Open)') && /^搜尋$/.test(c.label)) nav({ scope: 'screen', frame, fxId: c.fxId }, c.label, byName('Merchant / List'), { note: '搜尋面板收合' });
  // 特約商：精選／最新分頁與頁碼 1–5（頁碼狀態由畫面名稱推得）
  if (frame.startsWith('Merchant / List')) {
    const latest = /\(Latest/.test(frame);
    const page = Number((frame.match(/Page (\d)/) || [])[1] || 1);
    const frameFor = (isLatest, p) => byName(isLatest ? (p === 1 ? 'Merchant / List (Latest)' : `Merchant / List (Latest, Page ${p})`) : (p === 1 ? 'Merchant / List' : `Merchant / List (Page ${p})`));
    let target = null;
    if (/^精選特約商$/.test(c.label)) target = frameFor(false, 1);
    else if (/^最新特約商$/.test(c.label)) target = frameFor(true, 1);
    else if (/^[1-5]$/.test(c.label)) target = frameFor(latest, Number(c.label));
    else if (/下一頁/.test(c.label) || /下一頁/.test(c.ariaLabel)) target = frameFor(latest, Math.min(5, page + 1));
    if (target && target !== frame) nav({ scope: 'screen', frame, fxId: c.fxId }, c.label, target, { note: '分頁／頁碼切換' });
  }
  // 商城詳情：桌機以分頁切換（商品介紹／購買須知／退貨說明）；Tablet／Mobile 為手風琴，再點一次已展開的項目會收合。
  if (frame.startsWith('Mall / Detail')) {
    const KEYS = { 商品介紹: 'intro', 購買須知: 'notice', 退貨說明: 'return' };
    const key = Object.entries(KEYS).find(([k]) => c.label.includes(k))?.[1];
    if (key) {
      const NAMES = sizeKey === 'desktop'
        ? { intro: 'Mall / Detail', notice: 'Mall / Detail (Notice)', return: 'Mall / Detail (Return)' }
        : { return: 'Mall / Detail', intro: 'Mall / Detail (Intro)', notice: 'Mall / Detail (Notice)', none: 'Mall / Detail (Collapsed)' };
      const stateOf = (name) => Object.entries(NAMES).find(([, v]) => `${v} / ${L}` === name)?.[0];
      const current = stateOf(frame);
      const next = sizeKey !== 'desktop' && current === key ? 'none' : key;
      const target = byName(NAMES[next]);
      if (target && target !== frame) nav({ scope: 'screen', frame, fxId: c.fxId }, c.label, target, { note: '分頁／手風琴切換' });
    }
  }
  // 點數交換頁（Tablet／Mobile）：轉入／轉出分頁；登入版與未登入版各自互連。
  if (frame.startsWith('Point Exchange / Home')) {
    const li = frame.includes('Logged In');
    const target = /^轉入/.test(c.label) ? byName(li ? 'Point Exchange / Home (Logged In)' : 'Point Exchange / Home')
      : /^轉出/.test(c.label) ? byName(li ? 'Point Exchange / Home (Logged In, Transfer Out)' : 'Point Exchange / Home (Transfer Out)') : null;
    if (target && target !== frame) nav({ scope: 'screen', frame, fxId: c.fxId }, c.label, target, { note: '分頁切換' });
  }
  if (frame === `Auth / Login / ${L}` && /^登入$/.test(c.label) && c.buttonType === 'submit') nav({ scope: 'screen', frame, fxId: c.fxId }, c.label, byPath.get('/member').frameName, { note: 'LoginPage 登入成功（原型：導向會員中心以取得 LoggedIn 狀態）' });
}
// 問卷提示：進入頁面自動彈出
const surveyFrame = frames.find((f) => f.pluginData.fxRoute === '/survey');
if (surveyFrame) {
  addReaction({ source: { scope: 'screen', frame: surveyFrame.name, node: 'self' }, sourceLabel: 'auto open', trigger: 'AFTER_TIMEOUT', timeout: 0.1, action: { type: 'OVERLAY', destination: SURVEY_OVERLAY } });
  addReaction({ source: { scope: 'screen', frame: SURVEY_OVERLAY, fxId: overlayClose.pluginData.fxId }, sourceLabel: '關閉', trigger: 'ON_CLICK', action: { type: 'CLOSE' } });
}

// 元件層
const regBy = (set, variant) => registry.filter((r) => r.set === set && r.variant === variant);
// 有漢堡選單（Menu=Open 狀態）的尺寸才會有 Open Variant（Mobile）。
const hasBurger = headerVariants.some((v) => v.name.endsWith('Menu=Open'));
for (const v of headerVariants) {
  const [, auth, menu] = v.pluginData.fxAuth ? [null, v.pluginData.fxAuth, v.pluginData.fxMenu] : [];
  for (const c of regBy(HEADER, v.name)) {
    const here = { scope: 'component', component: HEADER, variant: v.name, fxId: c.fxId };
    const sib = (m) => `Auth=${auth}, Menu=${m}`;
    if (sizeKey === 'desktop') {
      if (c.kind === 'Menu') { addReaction({ source: here, sourceLabel: `${menu} 選單區塊`, trigger: 'MOUSE_LEAVE', action: { type: 'CHANGE_TO', component: HEADER, variant: sib('Closed') }, transition: { type: 'DISSOLVE', duration: 0.2 } }); continue; }
      if (/official-nav-earn/.test(c.cls)) { addReaction({ source: here, sourceLabel: '輕鬆賺點', trigger: 'MOUSE_ENTER', action: { type: 'CHANGE_TO', component: HEADER, variant: sib('Earn') }, transition: { type: 'DISSOLVE', duration: 0.2 } }); continue; }
      if (/official-nav-redeem/.test(c.cls)) { addReaction({ source: here, sourceLabel: '好康兌換', trigger: 'MOUSE_ENTER', action: { type: 'CHANGE_TO', component: HEADER, variant: sib('Redeem') }, transition: { type: 'DISSOLVE', duration: 0.2 } }); continue; }
    } else {
      if (/開啟選單/.test(c.ariaLabel)) { addReaction({ source: here, sourceLabel: c.label, trigger: 'ON_CLICK', action: { type: 'CHANGE_TO', component: HEADER, variant: sib('Open') } }); continue; }
      if (/關閉選單/.test(c.ariaLabel)) { addReaction({ source: here, sourceLabel: c.label, trigger: 'ON_CLICK', action: { type: 'CHANGE_TO', component: HEADER, variant: sib('Closed') } }); continue; }
      if (c.tag === 'button' && /輕鬆賺點|好康兌換/.test(c.label)) {
        const key = /輕鬆賺點/.test(c.label) ? 'Earn' : 'Redeem';
        // 再點一次同一個選單：手機回到「Open」（漢堡選單仍開著）；平板沒有漢堡，直接收合。
        addReaction({ source: here, sourceLabel: c.label, trigger: 'ON_CLICK', action: { type: 'CHANGE_TO', component: HEADER, variant: menu === key ? sib(hasBurger ? 'Open' : 'Closed') : sib(key) } });
        continue;
      }
    }
    // Header 搜尋框：點擊示意跳到搜尋結果頁（React：送出後 navigate('/search?q=…')）
    if (c.kind === 'Input' && c.inputType === 'search') {
      nav(here, '搜尋', byPath.get('/search').frameName, { note: '搜尋框點擊示意' });
      continue;
    }
    if (c.tag === 'button' && /登出/.test(c.label)) {
      // React：logout() 只把狀態改成 Guest，停留在目前頁面 → 切換為 Guest 版 Header。
      addReaction({ source: here, sourceLabel: c.label, trigger: 'ON_CLICK', action: { type: 'CHANGE_TO', component: HEADER, variant: `Auth=Guest, Menu=Closed` }, note: 'logout() → Guest' });
      continue;
    }
    if (c.href) {
      const res = resolveHref(c.href, auth);
      if (res.kind === 'frame') nav(here, c.label, res.frame);
      else if (res.kind === 'unmapped') unmapped.push({ component: HEADER, variant: v.name, label: c.label, href: c.href });
      // 桌機下拉選單項目：滑到項目上時維持展開
      if (sizeKey === 'desktop' && (menu === 'Earn' || menu === 'Redeem') && c.cls === '' && res.kind === 'frame') { /* 在下方補 hover 維持 */ }
    }
  }
}
for (const c of regBy(FOOTER, null)) {
  if (!c.href) continue;
  const res = resolveHref(c.href, 'Guest');
  if (res.kind === 'frame') nav({ scope: 'component', component: FOOTER, fxId: c.fxId }, c.label, res.frame);
  else if (res.kind === 'unmapped') unmapped.push({ component: FOOTER, label: c.label, href: c.href });
}
// Banner
const slideNames = bannerVariants.map((v) => v.name);
bannerVariants.forEach((v, i) => {
  const no = String(i + 1).padStart(2, '0');
  const prev = slideNames[(i + 5) % 6], next = slideNames[(i + 1) % 6];
  const here = (suffix) => ({ scope: 'component', component: BANNER, variant: v.name, fxId: `${sizeKey[0]}:banner:${no}:${suffix}` });
  const fade = { type: 'DISSOLVE', duration: 0.3 }; // HomeBanner：opacity 300ms
  addReaction({ source: here('prev'), sourceLabel: 'Previous', trigger: 'ON_CLICK', action: { type: 'CHANGE_TO', component: BANNER, variant: prev }, transition: fade });
  addReaction({ source: here('next'), sourceLabel: 'Next', trigger: 'ON_CLICK', action: { type: 'CHANGE_TO', component: BANNER, variant: next }, transition: fade });
  slideNames.forEach((s, d) => {
    if (d === i) return;
    addReaction({ source: here(`dot${String(d + 1).padStart(2, '0')}`), sourceLabel: `Banner ${d + 1}`, trigger: 'ON_CLICK', action: { type: 'CHANGE_TO', component: BANNER, variant: s }, transition: fade });
  });
  addReaction({ source: { scope: 'component', component: BANNER, variant: v.name, node: 'self' }, sourceLabel: 'auto-play 4s', trigger: 'AFTER_TIMEOUT', timeout: 4, action: { type: 'CHANGE_TO', component: BANNER, variant: next }, transition: fade, note: 'HomeBanner: BANNER_INTERVAL_MS=4000；Variant 本身的計時器，非 Button' });
});
// Chat
addReaction({ source: { scope: 'component', component: CHAT, variant: 'State=Closed', fxId: `${sizeKey[0]}:chat:launcher` }, sourceLabel: '開啟線上客服', trigger: 'ON_CLICK', action: { type: 'CHANGE_TO', component: CHAT, variant: 'State=Open' } });
for (const c of regBy(CHAT, 'State=Open')) {
  if (/關閉線上客服/.test(c.ariaLabel)) addReaction({ source: { scope: 'component', component: CHAT, variant: 'State=Open', fxId: c.fxId }, sourceLabel: c.label, trigger: 'ON_CLICK', action: { type: 'CHANGE_TO', component: CHAT, variant: 'State=Closed' } });
}
// 手風琴
for (const [set, info] of Object.entries(accInfo)) {
  info.names.forEach((vname, vi) => {
    const rows = regBy(set, vname).filter((c) => c.kind === 'Button');
    rows.forEach((row, qi) => {
      let target;
      if (info.mode === 'single') {
        const cur = info.opens[vi];
        target = cur === qi + 1 ? info.names[0] : info.names[info.opens.indexOf(qi + 1)];
      } else {
        target = info.names[info.opens[vi] ^ (1 << qi)];
      }
      addReaction({ source: { scope: 'component', component: set, variant: vname, fxId: row.fxId }, sourceLabel: row.label.slice(0, 40), trigger: 'ON_CLICK', action: { type: 'CHANGE_TO', component: set, variant: target }, transition: { type: 'SMART_ANIMATE', duration: 0.3, easing: 'EASE_IN_AND_OUT' } });
    });
  });
}

// Checkbox：點一下在 Off / On 之間切換
for (const name of checkboxSets) {
  addReaction({ source: { scope: 'component', component: name, variant: 'Checked=Off', node: 'self' }, sourceLabel: 'toggle on', trigger: 'ON_CLICK', action: { type: 'CHANGE_TO', component: name, variant: 'Checked=On' } });
  addReaction({ source: { scope: 'component', component: name, variant: 'Checked=On', node: 'self' }, sourceLabel: 'toggle off', trigger: 'ON_CLICK', action: { type: 'CHANGE_TO', component: name, variant: 'Checked=Off' } });
}

// Hover：Default Variant 本身「While hovering」切到 Hover（React 的 transition 時間）
for (const h of hoverSets) {
  addReaction({ source: { scope: 'component', component: h.name, variant: 'State=Default', node: 'self' }, sourceLabel: 'hover', trigger: 'ON_HOVER', action: { type: 'CHANGE_TO', component: h.name, variant: 'State=Hover' }, transition: { type: 'SMART_ANIMATE', duration: Math.max(0.1, Math.min(0.6, h.transitionMs / 1000)), easing: 'EASE_OUT' } });
  // Hover 元件內的連結（例如卡片內的「看更多」）在兩個 Variant 都要能點
  for (const variant of ['State=Default', 'State=Hover']) {
    for (const c of regBy(h.name, variant)) {
      if (!c.href) continue;
      const res = resolveHref(c.href, h.auth);
      if (res.kind === 'frame') nav({ scope: 'component', component: h.name, variant, fxId: c.fxId }, c.label, res.frame);
    }
  }
}

const prototype = {
  schemaVersion: 'uupon-prototype-8',
  size: sizeKey,
  figmaPage: SIZE.page,
  width: W,
  header: HEADER, footer: FOOTER, banner: BANNER, chat: CHAT,
  hoverSets: [...hoverSets.map((h) => h.name), ...checkboxSets],
  accordions: Object.fromEntries(Object.entries(accInfo).map(([k, v]) => [k, { mode: v.mode, variants: v.names }])),
  overlay: { name: SURVEY_OVERLAY, owner: surveyFrame?.name },
  reactions,
};

// ---------- 輸出 ----------
const writeJson = (p, obj) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(obj)); };
const screensOut = path.join(ROOT, 'figma', 'screens', `${SIZE.dir}-all-screens-${SIZE.ver}.json`);
const compOut = path.join(ROOT, 'figma', 'components', `${sizeKey}-components-${SIZE.ver}.json`);
const protoOut = path.join(ROOT, 'figma', 'prototype', `${SIZE.dir}-${SIZE.protoVer}.json`);
writeJson(screensOut, transparentFrames(frames.map((f) => ({ ...f, children: f.children }))));
writeJson(compOut, transparentFrames([...hoverComponents, ...checkboxComponents, ...components]));
fs.mkdirSync(path.dirname(protoOut), { recursive: true });
fs.writeFileSync(protoOut, JSON.stringify(prototype, null, 1));
fs.writeFileSync(path.join(WORK, 'build-summary.json'), JSON.stringify({ inlineRegions, unmapped, registryCount: registry.length, screenControls: screenRegistry.length, reactionCount: reactions.length }, null, 1));
console.log(JSON.stringify({ hoverSets: hoverSets.length, frames: frames.length, components: components.length, reactions: reactions.length, inlineRegions: inlineRegions.length, unmapped: unmapped.length }, null, 1));
