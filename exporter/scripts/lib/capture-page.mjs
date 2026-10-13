// 在瀏覽器內執行的 DOM → Figma 巢狀節點擷取函式（必須自成一體，不可引用外部變數）。
// 以 page.evaluate(capturePage, options) 呼叫。
//
// 輸出節點座標皆為「相對父層」。互動元件（a / button / input / select / textarea / label+radio）輸出為
// FRAME「Button / …」，子層為 Background、Icon、Image、Text，之後 Prototype 只會綁在這個 Frame 上。
export function capturePage(options) {
  const REGION_SELECTORS = options.regionSelectors; // { header, footer, chat, banner }
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'META', 'LINK', 'TITLE', 'SOURCE', 'PATH']);
  const INTERACTIVE = 'button,a[href],[role="button"],input,select,textarea';

  const clamp = (v) => Math.max(0, Math.min(1, v));
  const gamma = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(Math.max(v, 0), 1 / 2.4) - 0.055);
  const num = (v) => Number.parseFloat(v) || 0;
  const round = (v) => Math.round(v * 100) / 100;

  function parseColor(value) {
    const s = String(value || '').trim().toLowerCase();
    if (!s || s === 'transparent' || s === 'none') return undefined;
    const rgb = s.match(/^rgba?\(\s*([0-9.]+%?)\s*[, ]\s*([0-9.]+%?)\s*[, ]\s*([0-9.]+%?)(?:\s*[,/]\s*([0-9.]+%?))?\s*\)$/);
    const ch = (p) => (p.endsWith('%') ? Number.parseFloat(p) / 100 : Number.parseFloat(p) / 255);
    const al = (p) => (p ? (p.endsWith('%') ? Number.parseFloat(p) / 100 : Number.parseFloat(p)) : 1);
    if (rgb) return { r: clamp(ch(rgb[1])), g: clamp(ch(rgb[2])), b: clamp(ch(rgb[3])), a: clamp(al(rgb[4])) };
    // Tailwind v4 / color-mix 計算後可能是 color(srgb r g b / a)
    const srgb = s.match(/^color\(\s*(srgb|display-p3|srgb-linear)\s+([-0-9.e]+)\s+([-0-9.e]+)\s+([-0-9.e]+)(?:\s*\/\s*([0-9.]+%?))?\s*\)$/);
    if (srgb) {
      const lin = srgb[1] === 'srgb-linear';
      const g2 = (v) => (lin ? gamma(Number.parseFloat(v)) : Number.parseFloat(v));
      return { r: clamp(g2(srgb[2])), g: clamp(g2(srgb[3])), b: clamp(g2(srgb[4])), a: clamp(al(srgb[5])) };
    }
    const lch = s.match(/^oklch\(\s*([0-9.]+%?)\s+([0-9.]+%?)\s+(-?[0-9.]+|none)(?:deg)?(?:\s*[/ ]\s*([0-9.]+%?))?\s*\)$/);
    const lab = s.match(/^oklab\(\s*([0-9.]+%?)\s+(-?[0-9.]+%?)\s+(-?[0-9.]+%?)(?:\s*[/ ]\s*([0-9.]+%?))?\s*\)$/);
    if (!lch && !lab) return undefined;
    const pn = (p, scale = 1) => (p.endsWith('%') ? (Number.parseFloat(p) / 100) * scale : Number.parseFloat(p));
    const l = pn((lch || lab)[1]);
    let a, b, alphaPart;
    if (lch) {
      const c = pn(lch[2], 0.4);
      const h = ((lch[3] === 'none' ? 0 : Number.parseFloat(lch[3])) * Math.PI) / 180;
      a = c * Math.cos(h);
      b = c * Math.sin(h);
      alphaPart = lch[4];
    } else {
      a = pn(lab[2], 0.4);
      b = pn(lab[3], 0.4);
      alphaPart = lab[4];
    }
    const l1 = Math.pow(l + 0.3963377774 * a + 0.2158037573 * b, 3);
    const m1 = Math.pow(l - 0.1055613458 * a - 0.0638541728 * b, 3);
    const s1 = Math.pow(l - 0.0894841775 * a - 1.291485548 * b, 3);
    return {
      r: clamp(gamma(4.0767416621 * l1 - 3.3077115913 * m1 + 0.2309699292 * s1)),
      g: clamp(gamma(-1.2684380046 * l1 + 2.6097574011 * m1 - 0.3413193965 * s1)),
      b: clamp(gamma(-0.0041960863 * l1 - 0.7034186147 * m1 + 1.707614701 * s1)),
      a: clamp(al(alphaPart)),
    };
  }
  const toFill = (c) => (c && c.a > 0 ? [{ type: 'SOLID', color: { r: round(c.r), g: round(c.g), b: round(c.b) }, opacity: round(c.a) }] : undefined);

  // ---- 可見性與裁切 ----
  const visCache = new Map();
  function isVisible(el) {
    if (visCache.has(el)) return visCache.get(el);
    let ok = true;
    if (!(el instanceof Element) || el.hidden || el.getAttribute('aria-hidden') === 'true' && el.matches('[data-fx-skip]')) ok = false;
    if (ok) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse') ok = false;
      else if (Number.parseFloat(cs.opacity || '1') <= 0.001) ok = false;
      else if (el.parentElement && el.parentElement !== document.documentElement && !isVisible(el.parentElement)) ok = false;
    }
    visCache.set(el, ok);
    return ok;
  }
  const absRect = (r) => ({ x: r.x + scrollX, y: r.y + scrollY, w: r.width, h: r.height });
  const clipCache = new Map();
  function clipOf(el) {
    // 傳回祖先 overflow 裁切與視窗寬度交集（絕對座標）。
    if (clipCache.has(el)) return clipCache.get(el);
    const parent = el.parentElement;
    let clip = parent && parent !== document.documentElement ? clipOf(parent) : { x: 0, y: 0, w: options.viewportWidth, h: 1e9 };
    if (parent && parent !== document.body && parent !== document.documentElement) {
      const cs = getComputedStyle(parent);
      if (/(hidden|clip|auto|scroll)/.test(cs.overflowX + cs.overflowY)) {
        const r = absRect(parent.getBoundingClientRect());
        const x1 = /(hidden|clip|auto|scroll)/.test(cs.overflowX) ? Math.max(clip.x, r.x) : clip.x;
        const x2 = /(hidden|clip|auto|scroll)/.test(cs.overflowX) ? Math.min(clip.x + clip.w, r.x + r.w) : clip.x + clip.w;
        const y1 = /(hidden|clip|auto|scroll)/.test(cs.overflowY) ? Math.max(clip.y, r.y) : clip.y;
        const y2 = /(hidden|clip|auto|scroll)/.test(cs.overflowY) ? Math.min(clip.y + clip.h, r.y + r.h) : clip.y + clip.h;
        clip = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
      }
    }
    clipCache.set(el, clip);
    return clip;
  }
  const intersect = (r, c) => {
    const x1 = Math.max(r.x, c.x), y1 = Math.max(r.y, c.y);
    const x2 = Math.min(r.x + r.w, c.x + c.w), y2 = Math.min(r.y + r.h, c.y + c.h);
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  };

  // ---- 文字 ----
  function renderedText(el) {
    const parts = [];
    const walk = (node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const parent = node.parentElement;
        const value = (node.nodeValue || '').replace(/\s+/g, ' ');
        if (!value.trim() || !parent || !isVisible(parent)) return;
        const range = document.createRange();
        range.selectNodeContents(node);
        const rendered = [...range.getClientRects()].some((r) => r.width > 0.5 && r.height > 0.5);
        if (rendered) parts.push(value);
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        if (node.tagName === 'BR') parts.push('\n');
        else if (!SKIP_TAGS.has(node.tagName) && isVisible(node)) node.childNodes.forEach(walk);
      }
    };
    el.childNodes.forEach(walk);
    return parts.join('').replace(/ *\n */g, '\n').replace(/[ \t]+/g, ' ').trim();
  }
  // React 字型：Inter → Noto Sans TC（本機沒有 Inter 時實際顯示 Noto Sans TC）；Figma 內以 Noto Sans TC 呈現。
  function fontNameFor(cs, text, weight, italic) {
    const family = String(cs.fontFamily || '');
    const w = weight;
    if (/^\s*"?Arial/i.test(family)) return { family: 'Arial', style: (w >= 600 ? 'Bold' : 'Regular') + (italic ? ' Italic' : '').replace('Regular Italic', 'Italic') };
    if (italic && /^[\x00-\x7F]*$/.test(text)) return { family: 'Inter', style: w >= 600 ? 'Bold Italic' : 'Italic' };
    const style = w <= 150 ? 'Thin' : w <= 350 ? 'Light' : w <= 450 ? 'Regular' : w <= 550 ? 'Medium' : w <= 750 ? 'Bold' : 'Black';
    return { family: 'Noto Sans TC', style };
  }
  function textStyle(el) {
    const cs = getComputedStyle(el);
    const lh = Number.parseFloat(cs.lineHeight);
    const color = parseColor(cs.color);
    return {
      fontSize: num(cs.fontSize) || 14,
      lineHeightPx: lh > 0 ? lh : undefined,
      fontWeight: Number.parseInt(cs.fontWeight, 10) || 400,
      italic: cs.fontStyle === 'italic' || cs.fontStyle === 'oblique',
      underline: /underline/.test(cs.textDecorationLine || cs.textDecoration || ''),
      letterSpacing: cs.letterSpacing && cs.letterSpacing !== 'normal' ? num(cs.letterSpacing) : undefined,
      textAlign: cs.textAlign,
      color: color ? { r: round(color.r), g: round(color.g), b: round(color.b) } : undefined,
      opacity: color && color.a < 1 ? round(color.a) : undefined,
      lineClamp: cs.webkitLineClamp && cs.webkitLineClamp !== 'none',
      // line-clamp 或單行 text-overflow: ellipsis → Figma 的最多行數＋結尾省略（全文保留）
      maxLines: cs.webkitLineClamp && cs.webkitLineClamp !== 'none' ? Number.parseInt(cs.webkitLineClamp, 10) : cs.textOverflow === 'ellipsis' && cs.whiteSpace === 'nowrap' && /hidden|clip/.test(cs.overflowX) ? 1 : undefined,
      cs,
    };
  }
  function makeText(name, text, rect, st, origin, forceMultiline) {
    const lh = st.lineHeightPx || st.fontSize * 1.4;
    const single = !forceMultiline && !text.includes('\n') && rect.h < lh * 1.6;
    // Range 的矩形是字身高度；CSS 行高較大時，上下各有半行距，Figma 文字框要從行框頂端開始。
    const lead = st.lineHeightPx && rect.lineH ? (st.lineHeightPx - rect.lineH) / 2 : 0;
    const node = {
      type: 'TEXT',
      name,
      x: round(rect.x - origin.x),
      y: round(rect.y - lead - origin.y),
      width: round(single ? rect.w + Math.ceil(st.fontSize * 0.4) : rect.w),
      height: round(rect.h + lead * 2),
      characters: text,
      fontName: fontNameFor(st.cs, text, st.fontWeight, st.italic),
      fontSize: st.fontSize,
      lineHeightPx: st.lineHeightPx,
      fontWeight: st.fontWeight,
      italic: st.italic || undefined,
      textDecoration: st.underline ? 'UNDERLINE' : undefined,
      letterSpacing: st.letterSpacing || undefined,
      textAlignHorizontal: st.textAlign === 'center' ? 'CENTER' : st.textAlign === 'right' || st.textAlign === 'end' ? 'RIGHT' : 'LEFT',
      textAutoResize: single ? 'WIDTH_AND_HEIGHT' : 'HEIGHT',
      fills: st.color ? [{ type: 'SOLID', color: st.color, opacity: st.opacity ?? 1 }] : undefined,
    };
    if (st.maxLines) {
      node.maxLines = st.maxLines;
      node.textTruncation = 'ENDING';
      node.textAutoResize = 'HEIGHT';
      const lineBox = st.lineHeightPx || st.fontSize * 1.45;
      node.height = round(Math.min(node.height, lineBox * st.maxLines));
      if (st.maxLines === 1 && rect.clipW) node.width = round(rect.clipW);
    }
    return node;
  }
  const unionRects = (rects) => {
    const rs = rects.filter((r) => r.width > 0.5 && r.height > 0.5);
    if (!rs.length) return null;
    const x1 = Math.min(...rs.map((r) => r.left)), y1 = Math.min(...rs.map((r) => r.top));
    const x2 = Math.max(...rs.map((r) => r.right)), y2 = Math.max(...rs.map((r) => r.bottom));
    return { x: x1 + scrollX, y: y1 + scrollY, w: x2 - x1, h: y2 - y1, lineH: rs[0].height };
  };

  // 段落內混合樣式：回傳正規化後的文字與每段來源元素的位置（與 renderedText 相同的空白規則）。
  function richText(el) {
    let out = '';
    const segs = [];
    const push = (value, parent) => {
      // white-space: pre / pre-line / pre-wrap 要保留原本的換行
      const ws = getComputedStyle(parent).whiteSpace;
      let v = /pre/.test(ws) ? value.replace(/[ \t\f\r]+/g, ' ').replace(/ *\n */g, '\n') : value.replace(/\s+/g, ' ');
      if ((out === '' || out.endsWith(' ') || out.endsWith('\n')) && v.startsWith(' ')) v = v.slice(1);
      if (!v) return;
      const start = out.length;
      out += v;
      segs.push({ start, end: out.length, parent });
    };
    const walkNode = (node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const parent = node.parentElement;
        if (!(node.nodeValue || '').trim() || !parent || !isVisible(parent)) return;
        const range = document.createRange();
        range.selectNodeContents(node);
        if ([...range.getClientRects()].some((r) => r.width > 0.5 && r.height > 0.5)) push(node.nodeValue, parent);
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        if (node.tagName === 'BR') out = out.replace(/ +$/, '') + '\n';
        else if (!SKIP_TAGS.has(node.tagName) && isVisible(node)) node.childNodes.forEach(walkNode);
      }
    };
    el.childNodes.forEach(walkNode);
    const text = out.replace(/^\n+/, '').replace(/\s+$/, '');
    for (const seg of segs) seg.end = Math.min(seg.end, text.length);
    return { text, segs: segs.filter((seg) => seg.end > seg.start) };
  }
  const sameStyle = (a, b) => a.fontWeight === b.fontWeight && a.fontSize === b.fontSize && a.underline === b.underline && a.italic === b.italic && JSON.stringify(a.color) === JSON.stringify(b.color) && a.opacity === b.opacity;
  function styledRanges(el, segs, base, text) {
    const ranges = [];
    for (const seg of segs) {
      if (seg.parent === el) continue;
      const st = textStyle(seg.parent);
      if (sameStyle(st, base)) continue;
      const r = {
        start: seg.start, end: seg.end,
        fills: st.color ? [{ type: 'SOLID', color: st.color, opacity: st.opacity ?? 1 }] : undefined,
        fontSize: st.fontSize,
        fontName: fontNameFor(st.cs, text.slice(seg.start, seg.end), st.fontWeight, st.italic),
        textDecoration: st.underline ? 'UNDERLINE' : 'NONE',
      };
      const prev = ranges.at(-1);
      if (prev && prev.end === r.start && JSON.stringify({ ...prev, start: 0, end: 0 }) === JSON.stringify({ ...r, start: 0, end: 0 })) prev.end = r.end;
      else ranges.push(r);
    }
    return ranges;
  }

  // ---- 圖片 / 圖示 ----
  let assetSeq = 0;
  const assets = []; // { index, kind: 'screenshot', rect }
  function imageNode(name, rect, origin, el, kind) {
    const index = assetSeq++;
    el.setAttribute('data-fx-asset', String(index));
    assets.push({ index, kind, name });
    const src = String(el.currentSrc || el.src || getComputedStyle(el).backgroundImage || '').slice(0, 300);
    return {
      type: 'IMAGE', name,
      x: round(rect.x - origin.x), y: round(rect.y - origin.y), width: round(Math.max(rect.w, 1)), height: round(Math.max(rect.h, 1)),
      assetIndex: index,
      src,
    };
  }
  function svgNode(el, rect, origin, name) {
    const clone = el.cloneNode(true);
    const cs = getComputedStyle(el);
    const color = cs.color;
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    if (!clone.getAttribute('viewBox')) {
      // 沒有 viewBox 時，以原本的 width/height 屬性或 bbox 補上，避免縮放後內容跑掉。
      const ow = Number.parseFloat(el.getAttribute('width')), oh = Number.parseFloat(el.getAttribute('height'));
      if (ow > 0 && oh > 0) clone.setAttribute('viewBox', `0 0 ${ow} ${oh}`);
      else { try { const bb = el.getBBox(); if (bb.width > 0 && bb.height > 0) clone.setAttribute('viewBox', `${bb.x} ${bb.y} ${bb.width} ${bb.height}`); } catch { /* 無 bbox */ } }
    }
    clone.setAttribute('width', String(round(rect.w)));
    clone.setAttribute('height', String(round(rect.h)));
    let markup = clone.outerHTML.replace(/currentColor/g, color);
    // 以計算後的 fill / stroke 補在 root，避免 class 控制的顏色遺失。
    const fill = cs.fill;
    const stroke = cs.stroke;
    const setRootAttr = (name, value) => {
      const head = markup.slice(0, markup.indexOf('>'));
      const re = new RegExp(`\\s${name}="[^"]*"`);
      markup = re.test(head) ? markup.replace(re, ` ${name}="${value}"`) : markup.replace('<svg', `<svg ${name}="${value}"`);
    };
    if (fill) setRootAttr('fill', fill);
    if (stroke) setRootAttr('stroke', stroke);
    return {
      type: 'SVG', name,
      x: round(rect.x - origin.x), y: round(rect.y - origin.y), width: round(Math.max(rect.w, 1)), height: round(Math.max(rect.h, 1)),
      svg: markup,
    };
  }

  // ---- 統計 / 紀錄 ----
  const stats = { Input: 0, Select: 0, Checkbox: 0, Radio: 0, Textarea: 0, Button: 0, Link: 0, Image: 0, Icon: 0, Text: 0, lineClampTexts: 0 };
    let ctrlSeq = 0;
  let currentRegion = null;
  // 同一頁多次擷取時，清掉上一次的圖片標記，避免截到舊元素。
  document.querySelectorAll('[data-fx-asset]').forEach((e) => e.removeAttribute('data-fx-asset'));
  const controlIds = [];

  const labelOf = (el) => {
    const aria = el.getAttribute('aria-label') || el.getAttribute('title') || '';
    const txt = (el.value && !['checkbox', 'radio'].includes(el.type) ? '' : '') || renderedText(el).replace(/\n/g, ' ');
    const alt = el.querySelector && el.querySelector('img[alt]')?.getAttribute('alt');
    return (aria || txt || alt || el.getAttribute('name') || el.getAttribute('placeholder') || el.tagName.toLowerCase()).trim().slice(0, 80);
  };

  function isSrOnly(el) {
    const r = el.getBoundingClientRect();
    return r.width <= 2 && r.height <= 2;
  }

  // ---- 主遞迴 ----
  const regionEls = {};
  for (const [name, sel] of Object.entries(REGION_SELECTORS)) {
    const el = document.querySelector(sel);
    if (el && isVisible(el)) regionEls[name] = el;
  }
  const regionSet = new Set(Object.values(regionEls));
  const inRegion = (el) => { for (const r of regionSet) if (r === el || r.contains(el)) return true; return false; };

  // linear-gradient → Figma GRADIENT_LINEAR
  function splitTop(str) {
    const parts = [];
    let depth = 0, cur = '';
    for (const ch of str) { if (ch === '(') depth++; if (ch === ')') depth--; if (ch === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; } else cur += ch; }
    if (cur.trim()) parts.push(cur.trim());
    return parts;
  }
  function parseLinearGradient(value) {
    const src = String(value || '');
    const start = src.indexOf('linear-gradient(');
    if (start < 0 || src.includes('url(')) return null;
    let depth = 0, end = -1;
    for (let i = start + 15; i < src.length; i++) { if (src[i] === '(') depth++; if (src[i] === ')') { depth--; if (depth === 0) { end = i; break; } } }
    const parts = splitTop(src.slice(start + 16, end));
    let angle = 180;
    const first = parts[0] || '';
    if (/^(to\s|-?[0-9.]+(deg|turn|rad|grad))/.test(first) || /^in\s/.test(first)) {
      parts.shift();
      const dir = first.replace(/\s+in\s+\S+.*$/, '').trim();
      const map = { 'to top': 0, 'to right': 90, 'to bottom': 180, 'to left': 270, 'to top right': 45, 'to right top': 45, 'to bottom right': 135, 'to right bottom': 135, 'to bottom left': 225, 'to left bottom': 225, 'to top left': 315, 'to left top': 315 };
      if (map[dir] !== undefined) angle = map[dir];
      else if (/deg$/.test(dir)) angle = Number.parseFloat(dir);
      else if (/turn$/.test(dir)) angle = Number.parseFloat(dir) * 360;
    }
    const stops = [];
    for (const part of parts) {
      const m = part.match(/^(rgba?\([^)]*\)|oklch\([^)]*\)|oklab\([^)]*\)|transparent)\s*([-0-9.]+%)?/);
      if (!m) continue;
      const c = m[1] === 'transparent' ? { r: 0, g: 0, b: 0, a: 0 } : parseColor(m[1]);
      if (!c) continue;
      stops.push({ position: m[2] ? Number.parseFloat(m[2]) / 100 : null, color: { r: round(c.r), g: round(c.g), b: round(c.b), a: round(c.a) } });
    }
    if (stops.length < 2) return null;
    stops.forEach((st, i) => { if (st.position === null) st.position = i / (stops.length - 1); });
    const rad = (angle * Math.PI) / 180;
    const dx = Math.sin(rad), dy = -Math.cos(rad);
    return {
      type: 'GRADIENT_LINEAR',
      gradientTransform: [[round(dx), round(dy), round(0.5 - 0.5 * dx - 0.5 * dy)], [round(-dy), round(dx), round(0.5 + 0.5 * dy - 0.5 * dx)]],
      gradientStops: stops,
    };
  }

  function backgroundNode(el, rect, origin, name) {
    const cs = getComputedStyle(el);
    const bg = parseColor(cs.backgroundColor);
    const gradient = parseLinearGradient(cs.backgroundImage);
    const sides = ['Top', 'Right', 'Bottom', 'Left'].map((s) => ({ w: num(cs[`border${s}Width`]), c: parseColor(cs[`border${s}Color`]), style: cs[`border${s}Style`] }));
    const visibleSides = sides.filter((s) => s.w > 0 && s.style !== 'none' && s.c && s.c.a > 0);
    const uniform = visibleSides.length === 4 && sides.every((s) => s.w === sides[0].w && s.style === sides[0].style);
    const node = {
      type: 'RECTANGLE', name,
      x: round(rect.x - origin.x), y: round(rect.y - origin.y), width: round(Math.max(rect.w, 1)), height: round(Math.max(rect.h, 1)),
      fills: gradient ? [...(toFill(bg) || []), gradient] : toFill(bg),
      cornerRadius: Math.min(num(cs.borderTopLeftRadius), rect.h / 2 + 0.01, rect.w / 2 + 0.01) || undefined,
    };
    if (uniform) { node.strokes = toFill(sides[0].c); node.strokeWeight = sides[0].w; node.strokeAlign = 'INSIDE'; }
    const effects = parseShadows(cs.boxShadow);
    if (effects.length) node.effects = effects;
    const extra = [];
    if (!uniform) {
      // 只有部分邊框（底線、分隔線）：拆成細長 Rectangle。
      const [t, r, b, l] = sides;
      const bar = (s, x, y, w, h, tag) => s.w > 0 && s.style !== 'none' && s.c && s.c.a > 0 && extra.push({ type: 'RECTANGLE', name: `${name} / ${tag}`, x: round(x), y: round(y), width: round(w), height: round(h), fills: toFill(s.c) });
      bar(t, rect.x - origin.x, rect.y - origin.y, rect.w, t.w, 'Border Top');
      bar(b, rect.x - origin.x, rect.y - origin.y + rect.h - b.w, rect.w, b.w, 'Border Bottom');
      bar(l, rect.x - origin.x, rect.y - origin.y, l.w, rect.h, 'Border Left');
      bar(r, rect.x - origin.x + rect.w - r.w, rect.y - origin.y, r.w, rect.h, 'Border Right');
    }
    const hasPaint = !!(node.fills || node.strokes || node.effects);
    return { node, extra, hasPaint };
  }

  // box-shadow → Figma DROP_SHADOW（Tailwind 會輸出多層，含透明的 ring 佔位層，透明層略過）。
  function parseShadows(value) {
    if (!value || value === 'none') return [];
    const layers = [];
    let depth = 0, cur = '';
    for (const ch of value) {
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (ch === ',' && depth === 0) { layers.push(cur); cur = ''; } else cur += ch;
    }
    layers.push(cur);
    const out = [];
    for (const layer of layers) {
      const inset = /\binset\b/.test(layer);
      const colorMatch = layer.match(/(rgba?\([^)]*\)|oklch\([^)]*\)|oklab\([^)]*\))/);
      const color = colorMatch ? parseColor(colorMatch[1]) : { r: 0, g: 0, b: 0, a: 1 };
      if (!color || color.a <= 0) continue;
      const nums = layer.replace(colorMatch ? colorMatch[1] : '', '').match(/-?[0-9.]+px/g) || [];
      const [ox, oy, blur, spread] = nums.map((n) => Number.parseFloat(n)).concat([0, 0, 0, 0]);
      out.push({
        type: inset ? 'INNER_SHADOW' : 'DROP_SHADOW',
        color: { r: round(color.r), g: round(color.g), b: round(color.b), a: round(color.a) },
        offset: { x: ox || 0, y: oy || 0 }, radius: blur || 0, spread: spread || 0,
      });
    }
    return out;
  }

  function newControl(kind, el, rect, origin, label, extraData) {
    const id = `${options.idPrefix}${String(++ctrlSeq).padStart(3, '0')}`;
    const frame = {
      type: 'FRAME', name: `${kind} / ${label}`,
      x: round(rect.x - origin.x), y: round(rect.y - origin.y), width: round(Math.max(rect.w, 1)), height: round(Math.max(rect.h, 1)),
      clipsContent: false,
      pluginData: { fxId: id, fxKind: kind, fxLabel: label, ...extraData },
      children: [],
    };
    if (options.markIds !== false) el.setAttribute('data-fx-id', id);
    const tcs = getComputedStyle(el);
    const durations = String(tcs.transitionDuration || '0s').split(',').map((d) => (d.trim().endsWith('ms') ? Number.parseFloat(d) : Number.parseFloat(d) * 1000));
    controlIds.push({ id, kind, label, href: extraData.href || null, x: frame.x, y: frame.y, region: currentRegion, transitionMs: Math.max(0, ...durations.filter((d) => !Number.isNaN(d))) });
    return frame;
  }

  // 可見的實際元件矩形（用於 label 內 sr-only radio/checkbox）
  function controlFor(el, origin, out) {
    const tag = el.tagName;
    const type = (el.getAttribute('type') || tag).toLowerCase();
    let rect = absRect(el.getBoundingClientRect());
    const cs = getComputedStyle(el);

    // ---- 單選／複選 ----
    if (tag === 'INPUT' && (type === 'checkbox' || type === 'radio')) {
      const kind = type === 'radio' ? 'Radio' : 'Checkbox';
      const label = el.closest('label')?.innerText?.replace(/\s+/g, ' ').trim().slice(0, 60) || el.getAttribute('aria-label') || el.getAttribute('name') || type;
      let boxEl = el;
      if (isSrOnly(el)) {
        // 官網式自繪：視覺圓環是緊接著 input 的 span。
        boxEl = el.nextElementSibling && el.nextElementSibling.tagName === 'SPAN' ? el.nextElementSibling : el.parentElement;
        boxEl.setAttribute('data-fx-skip', '1');
        rect = absRect(boxEl.getBoundingClientRect());
      }
      const frame = newControl(kind, el, rect, origin, label, { value: el.value, checked: el.checked, name: el.getAttribute('name') || '' });
      const boxCs = getComputedStyle(boxEl);
      const bgFill = parseColor(boxCs.backgroundColor);
      let border = parseColor(boxCs.borderTopColor) || { r: 0.72, g: 0.72, b: 0.72, a: 1 };
      const accent0 = parseColor(getComputedStyle(el).accentColor);
      if (el.checked && accent0 && !isSrOnly(el)) border = accent0;
      const bw = Math.max(num(boxCs.borderTopWidth), 1);
      frame.children.push({
        type: 'RECTANGLE', name: 'Background', x: 0, y: 0, width: round(rect.w), height: round(rect.h),
        fills: toFill(bgFill) || [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }],
        strokes: toFill(border), strokeWeight: bw,
        cornerRadius: type === 'radio' ? rect.h / 2 : num(boxCs.borderTopLeftRadius) || 2,
      });
      if (el.checked) {
        const after = getComputedStyle(boxEl, '::after');
        const dot = parseColor(after.backgroundColor);
        const size = num(after.width) || Math.round(rect.w * 0.5);
        const accent = parseColor(getComputedStyle(el).accentColor);
        const markColor = (dot && dot.a > 0 ? dot : accent || parseColor(boxCs.borderTopColor)) || { r: 0.1, g: 0.45, b: 0.9, a: 1 };
        frame.children.push({
          type: 'RECTANGLE', name: type === 'radio' ? 'Dot' : 'Check',
          x: round((rect.w - size) / 2), y: round((rect.h - size) / 2), width: round(size), height: round(size),
          fills: toFill(markColor), cornerRadius: type === 'radio' ? size / 2 : 1,
        });
      }
      stats[kind]++;
      out.push(frame);
      return true;
    }
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      if (isSrOnly(el) || !isVisible(el)) return true;
      const isSelect = tag === 'SELECT';
      const kind = isSelect ? 'Select' : tag === 'TEXTAREA' ? 'Textarea' : (['submit', 'button', 'reset'].includes(type) ? 'Button' : 'Input');
      const label = el.getAttribute('aria-label') || el.getAttribute('name') || el.getAttribute('placeholder') || type;
      let valueText = '';
      let isPlaceholder = false;
      if (isSelect) valueText = (el.selectedOptions?.[0]?.textContent || '').replace(/\s+/g, ' ').trim();
      else if (['submit', 'button', 'reset'].includes(type)) valueText = el.value || '';
      else if (type === 'password') valueText = '•'.repeat((el.value || '').length);
      else valueText = el.value || '';
      if (!valueText && !isSelect && el.getAttribute('placeholder')) { valueText = el.getAttribute('placeholder'); isPlaceholder = true; }
      const frame = newControl(kind, el, rect, origin, label, { inputType: type, name: el.getAttribute('name') || '', value: isPlaceholder ? '' : el.value || '' });
      const bg = backgroundNode(el, rect, rect, 'Background');
      frame.children.push(bg.node, ...bg.extra);
      if (valueText) {
        const pl = num(cs.paddingLeft) || 8;
        const st = textStyle(el);
        if (isPlaceholder) {
          const ph = parseColor(getComputedStyle(el, '::placeholder').color);
          if (ph) { st.color = { r: round(ph.r), g: round(ph.g), b: round(ph.b) }; st.opacity = ph.a < 1 ? round(ph.a) : undefined; }
        }
        const lh = st.lineHeightPx || st.fontSize * 1.4;
        const isButtonLike = kind === 'Button';
        const t = makeText('Text', valueText, { x: rect.x + (isButtonLike ? 0 : pl), y: rect.y + (tag === 'TEXTAREA' ? num(cs.paddingTop) : Math.max(0, (rect.h - lh) / 2)), w: Math.max(2, rect.w - (isButtonLike ? 0 : pl * 2)), h: tag === 'TEXTAREA' ? rect.h : lh }, st, rect, tag === 'TEXTAREA');
        if (isButtonLike || cs.textAlign === 'center') t.textAlignHorizontal = 'CENTER', t.textAutoResize = 'HEIGHT', t.width = round(rect.w);
        frame.children.push(t);
        stats.Text++;
      }
      if (isSelect) {
        if (cs.appearance === 'none' && /url\(/.test(cs.backgroundImage)) {
          // 自訂箭頭（背景圖）：在原位放一個只有背景圖、沒有文字的暫存元素，交給截圖流程
          const temp = document.createElement('div');
          temp.setAttribute('data-fx-temp', '1');
          Object.assign(temp.style, {
            position: 'absolute', left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.w}px`, height: `${rect.h}px`, pointerEvents: 'none',
            backgroundImage: cs.backgroundImage, backgroundRepeat: cs.backgroundRepeat, backgroundPosition: cs.backgroundPosition, backgroundSize: cs.backgroundSize,
            borderRadius: cs.borderRadius, zIndex: '-1',
          });
          document.body.appendChild(temp);
          frame.children.push(imageNode('Icon / Arrow', rect, rect, temp, 'bg'));
        } else if (cs.appearance !== 'none') {
          // 原生下拉箭頭（Chromium 樣式的 V 形）
          const c = parseColor(cs.color) || { r: 0.2, g: 0.2, b: 0.2, a: 1 };
          const stroke = `rgb(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)})`;
          frame.children.push({ type: 'SVG', name: 'Icon / Arrow', x: round(rect.w - 20), y: round(rect.h / 2 - 4), width: 10, height: 7, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="7" viewBox="0 0 10 7"><path d="M1 1.5l4 4 4-4" fill="none" stroke="${stroke}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>` });
        }
      }
      stats[kind]++;
      out.push(frame);
      return true;
    }
    return false;
  }

  function walkChildren(el, origin, out) {
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) emitLooseText(node, el, origin, out);
      else if (node.nodeType === Node.ELEMENT_NODE) walk(node, origin, out);
    }
  }

  function emitLooseText(textNode, parent, origin, out) {
    const value = (textNode.nodeValue || '').replace(/\s+/g, ' ');
    if (!value.trim() || !isVisible(parent)) return;
    const range = document.createRange();
    range.selectNodeContents(textNode);
    const rect = unionRects([...range.getClientRects()]);
    if (!rect) return;
    const inter = intersect(rect, clipOf(parent));
    if (inter.w <= 0 || inter.h <= 0) return;
    const st = textStyle(parent);
    const text = value.trim();
    out.push(makeText('Text', text, rect, st, origin, rect.h > (st.lineHeightPx || st.fontSize * 1.4) * 1.6));
    stats.Text++;
    if (st.lineClamp) stats.lineClampTexts++;
  }

  const isInlineish = (c) => {
    if (c.tagName === 'BR') return true;
    const d = getComputedStyle(c).display;
    return d === 'inline' || d === 'contents';
  };
  function isTextBlock(el) {
    if (el.matches(INTERACTIVE) || el.querySelector(INTERACTIVE) && false) return false;
    let hasText = false;
    for (const n of el.childNodes) if (n.nodeType === Node.TEXT_NODE && n.nodeValue.trim()) hasText = true;
    const kids = [...el.children].filter((c) => isVisible(c) || c.tagName === 'BR');
    if (!kids.length) return hasText;
    for (const c of kids) {
      if (!isInlineish(c)) return false;
      // 內嵌純文字連結可以留在段落內（之後另外建立 Button Frame 蓋在原位）
      const inlineLink = c.matches('a[href]') && !c.querySelector(`${INTERACTIVE},img,svg,picture,canvas,video`);
      if (!inlineLink && (c.matches(INTERACTIVE) || c.querySelector(`${INTERACTIVE},img,svg,picture,canvas,video`) || c.matches('img,svg,picture,canvas,video'))) return false;
      const cs = getComputedStyle(c);
      if (parseColor(cs.backgroundColor)?.a > 0 || num(cs.borderTopWidth) > 0 || num(cs.borderBottomWidth) > 0) return false;
    }
    return hasText || renderedText(el).length > 0;
  }

  function walk(el, origin, out) {
    if (SKIP_TAGS.has(el.tagName) || el.namespaceURI === 'http://www.w3.org/2000/svg' && el.tagName !== 'svg') return;
    if (!isVisible(el) || inRegion(el)) return;
    if (el.closest('[data-fx-skip]')) return;
    const absR = absRect(el.getBoundingClientRect());
    const clip = clipOf(el);
    const visible = intersect(absR, clip);
    const cs = getComputedStyle(el);
    const tag = el.tagName;

    // 沒有尺寸的包裝層仍要往下走（display:contents 等）。
    if (cs.display === 'contents') { walkChildren(el, origin, out); return; }
    // sr-only（1px 裁切的無障礙文字）不屬於畫面。
    if (absR.w <= 1.5 && absR.h <= 1.5 && !el.matches('input,select,textarea,svg,img')) return;
    if ((absR.w < 0.5 || absR.h < 0.5) && cs.display !== 'contents' && !el.matches('input,select,textarea')) {
      if (el.children.length && cs.overflow === 'visible') walkChildren(el, origin, out);
      return;
    }
    if ((visible.w <= 0 || visible.h <= 0) && !el.matches('input,select,textarea')) return;

    // ---- Hover 目標（非互動元素，例如卡片外框）：包成 Frame ----
    if (el.hasAttribute('data-fx-hover') && !el.matches(INTERACTIVE) && !el.__fxWrapped) {
      const frame = {
        type: 'FRAME', name: `Hover Area / ${tag.toLowerCase()}`,
        x: round(absR.x - origin.x), y: round(absR.y - origin.y), width: round(Math.max(absR.w, 1)), height: round(Math.max(absR.h, 1)),
        clipsContent: false, fills: [], pluginData: { fxHover: el.getAttribute('data-fx-hover') }, children: [],
      };
      el.__fxWrapped = true;
      try { walk(el, absR, frame.children); } finally { el.__fxWrapped = false; }
      out.push(frame);
      return;
    }

    // ---- 表單控制項 ----
    if (el.matches('input,select,textarea')) {
      if (controlFor(el, origin, out)) return;
    }

    // ---- SVG / 圖片 ----
    if (tag === 'svg') {
      const parentInteractive = el.parentElement?.closest(INTERACTIVE);
      out.push(svgNode(el, visible, origin, parentInteractive ? 'Icon' : 'Icon / svg'));
      stats.Icon++;
      return;
    }
    if (tag === 'IMG') {
      const src = el.currentSrc || el.src || '';
      if (/\.svg(\?|$)/i.test(src) && options.inlineSvg && options.inlineSvg[src]) {
        const svgText = options.inlineSvg[src].replace(/<svg([^>]*)>/, (m, attrs) => `<svg${attrs.replace(/\s(width|height)="[^"]*"/g, '')} width="${round(visible.w)}" height="${round(visible.h)}">`);
        out.push({ type: 'SVG', name: `Icon / ${el.getAttribute('alt') || 'svg'}`, x: round(visible.x - origin.x), y: round(visible.y - origin.y), width: round(visible.w), height: round(visible.h), svg: svgText });
        stats.Icon++;
      } else {
        out.push(imageNode(`Image / ${el.getAttribute('alt') || 'asset'}`, visible, origin, el, 'img'));
        stats.Image++;
      }
      return;
    }
    if (tag === 'CANVAS' || tag === 'VIDEO' || tag === 'PICTURE' && !el.querySelector('img')) {
      out.push(imageNode(`Image / ${tag.toLowerCase()}`, visible, origin, el, 'img'));
      stats.Image++;
      return;
    }

    // ---- 互動元件（Button Frame）----
    if (el.matches(INTERACTIVE)) {
      const label = labelOf(el);
      const href = tag === 'A' ? el.getAttribute('href') || '' : '';
      const isLink = tag === 'A';
      const kind = 'Button';
      const frame = newControl(kind, el, visible, origin, label, {
        tag: tag.toLowerCase(), href, ariaLabel: el.getAttribute('aria-label') || '', buttonType: el.getAttribute('type') || '',
        target: el.getAttribute('target') || '', ariaCurrent: el.getAttribute('aria-current') || '', cls: String(el.className || '').slice(0, 160), expanded: el.getAttribute('aria-expanded') || '',
      });
      if (el.hasAttribute('data-fx-hover')) frame.pluginData.fxHover = el.getAttribute('data-fx-hover');
      const bg = backgroundNode(el, absR, absR, 'Background');
      const bgImg = cs.backgroundImage && cs.backgroundImage.includes('url(');
      frame.x = round(absR.x - origin.x); frame.y = round(absR.y - origin.y); frame.width = round(Math.max(absR.w, 1)); frame.height = round(Math.max(absR.h, 1));
      frame.children.push(bg.node, ...bg.extra);
      if (bgImg) frame.children.push(imageNode('Image / background', absR, absR, el, 'bg'));
      if (opacityOf(el) < 1) frame.opacity = round(opacityOf(el));
      walkChildren(el, absR, frame.children);
      stats[isLink ? 'Link' : 'Button']++;
      out.push(frame);
      return;
    }

    // ---- 一般區塊 ----
    const bg = backgroundNode(el, absR, origin, `Block / ${tag.toLowerCase()}`);
    const bgImg = cs.backgroundImage && /url\(|radial-gradient|conic-gradient/.test(cs.backgroundImage);
    if (bgImg) { out.push(imageNode(`Image / ${tag.toLowerCase()} background`, visible, origin, el, 'bg')); stats.Image++; }
    else if (bg.hasPaint || bg.extra.length) { out.push(bg.node, ...bg.extra); if (!bg.hasPaint) out.splice(out.indexOf(bg.node), 1); }

    pseudoBlocks(el, absR, cs, origin, out);

    if (isTextBlock(el)) {
      const rich = richText(el);
      const text = rich.text;
      if (text) {
        const range = document.createRange();
        range.selectNodeContents(el);
        const rect = unionRects([...range.getClientRects()]);
        if (rect) {
          const st = textStyle(el);
          const lh = st.lineHeightPx || st.fontSize * 1.4;
          const multi = rect.h > lh * 1.6;
          const contentLeft = absR.x + num(cs.paddingLeft) + num(cs.borderLeftWidth);
          const contentW = absR.w - num(cs.paddingLeft) - num(cs.paddingRight) - num(cs.borderLeftWidth) - num(cs.borderRightWidth);
          const box = multi ? { x: Math.min(rect.x, contentLeft), y: rect.y, w: Math.max(rect.w, contentW), h: rect.h, lineH: rect.lineH } : rect;
          if (st.maxLines) { box.clipW = contentW; if (st.maxLines > 1) { box.x = Math.min(rect.x, contentLeft); box.w = contentW; } }
          const textNode = makeText(`Text / ${tag.toLowerCase()}`, text, box, st, origin, multi);
          const ranges = styledRanges(el, rich.segs, st, text);
          // 內嵌連結：段落裡保留原文字位置（範圍設為透明），連結本身做成 Button Frame 疊在原位。
          const linkFrames = [];
          for (const a of el.querySelectorAll('a[href]')) {
            const segs = rich.segs.filter((seg) => seg.parent === a || a.contains(seg.parent));
            if (!segs.length) continue;
            const startIdx = Math.min(...segs.map((x) => x.start)), endIdx = Math.max(...segs.map((x) => x.end));
            const lines = [...a.getClientRects()].filter((r) => r.width > 0.5 && r.height > 0.5);
            const linkRect = unionRects(lines);
            if (!linkRect) continue;
            const lst = textStyle(a.querySelector('*') && segs[0].parent !== a ? segs[0].parent : a);
            const frame = newControl('Button', a, linkRect, origin, text.slice(startIdx, endIdx).slice(0, 80), {
              tag: 'a', href: a.getAttribute('href') || '', ariaLabel: a.getAttribute('aria-label') || '', target: a.getAttribute('target') || '', cls: String(a.className || '').slice(0, 160), inline: '1',
            });
            if (a.hasAttribute('data-fx-hover')) frame.pluginData.fxHover = a.getAttribute('data-fx-hover');
            frame.fills = [];
            if (lines.length === 1) {
              ranges.push({ start: startIdx, end: endIdx, fills: [], fontSize: lst.fontSize, fontName: fontNameFor(lst.cs, text.slice(startIdx, endIdx), lst.fontWeight, lst.italic), textDecoration: 'NONE' });
              frame.children.push(makeText('Text', text.slice(startIdx, endIdx), { ...linkRect, w: linkRect.w }, lst, linkRect, false));
            } else {
              // 跨行連結：文字留在段落（套連結樣式），Button Frame 只負責點擊範圍
              ranges.push({ start: startIdx, end: endIdx, fills: lst.color ? [{ type: 'SOLID', color: lst.color, opacity: lst.opacity ?? 1 }] : undefined, fontSize: lst.fontSize, fontName: fontNameFor(lst.cs, text.slice(startIdx, endIdx), lst.fontWeight, lst.italic), textDecoration: lst.underline ? 'UNDERLINE' : 'NONE' });
              frame.children.push({ type: 'RECTANGLE', name: 'Background', x: 0, y: 0, width: round(linkRect.w), height: round(linkRect.h), fills: [] });
              stats.multiLineLinks = (stats.multiLineLinks || 0) + 1;
            }
            stats.Link++;
            linkFrames.push(frame);
          }
          if (ranges.length) textNode.styledRanges = ranges.sort((x, y) => x.start - y.start);
          out.push(textNode, ...linkFrames);
          stats.Text++;
          if (st.lineClamp) stats.lineClampTexts++;
          return;
        }
      }
    }
    walkChildren(el, origin, out);
  }
  // ::before / ::after 的純色區塊（例如標題前的橘色直條）。以 flex 版型的置中規則估算位置。
  function pseudoBlocks(el, absR, cs, origin, out) {
    for (const which of ['::before', '::after']) {
      const ps = getComputedStyle(el, which);
      if (!ps || ps.content === 'none' || ps.content === 'normal' || ps.display === 'none') continue;
      const bg = parseColor(ps.backgroundColor);
      const w = num(ps.width), h = num(ps.height);
      if (!bg || bg.a <= 0 || w < 1 || h < 1) continue;
      let x, y;
      if (ps.position === 'absolute') {
        x = absR.x + num(ps.left) + num(cs.borderLeftWidth);
        y = absR.y + (ps.top !== 'auto' ? num(ps.top) : absR.h - num(ps.bottom) - h);
      } else {
        const before = which === '::before';
        x = before ? absR.x + num(cs.paddingLeft) + num(cs.borderLeftWidth) + num(ps.marginLeft) : absR.x + absR.w - num(cs.paddingRight) - w - num(ps.marginRight);
        y = cs.display.includes('flex') && cs.alignItems === 'center' ? absR.y + (absR.h - h) / 2 : absR.y + num(cs.paddingTop);
      }
      out.push({ type: 'RECTANGLE', name: `Block / ${el.tagName.toLowerCase()}${which}`, x: round(x - origin.x), y: round(y - origin.y), width: round(w), height: round(h), fills: toFill(bg), cornerRadius: num(ps.borderTopLeftRadius) || undefined });
    }
  }
  const opacityOf = (el) => {
    let o = 1;
    let cur = el;
    while (cur && cur !== document.body) { o *= Number.parseFloat(getComputedStyle(cur).opacity || '1'); cur = cur.parentElement; }
    return o;
  };
  function textNodesIn(el) {
    const res = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      const v = (n.nodeValue || '').replace(/\s+/g, ' ').trim();
      if (v && n.parentElement && isVisible(n.parentElement)) res.push(v);
    }
    return res;
  }

  // ---- 區域（Header / Footer / Chat / Banner）----
  const regions = {};
  for (const [name, el] of Object.entries(regionEls)) {
    const r = absRect(el.getBoundingClientRect());
    const nodes = [];
    regionSet.delete(el); // 暫時解除排除，擷取區域內容
    const saved = new Set(regionSet);
    regionSet.clear();
    currentRegion = name;
    walkChildren(el, r, nodes);
    currentRegion = null;
    // 區域自身背景
    const bg = backgroundNode(el, r, r, 'Background');
    for (const s of saved) regionSet.add(s);
    regionSet.add(el);
    regions[name] = { rect: { x: round(r.x), y: round(r.y), width: round(r.w), height: round(r.h) }, nodes: bg.hasPaint ? [bg.node, ...nodes] : nodes };
  }
  // 區域文字（頁面比對時扣除）
  // 主內容
  const nodes = [];
  const root = options.rootSelector ? document.querySelector(options.rootSelector) : document.body;
  if (root && options.rootSelf) walk(root, { x: 0, y: 0 }, nodes);
  else if (root) walkChildren(root, { x: 0, y: 0 }, nodes);

  // 單一元素擷取（hover 狀態）只需要節點，略過整頁統計以加速。
  if (options.rootSelf) return { nodes, regions, assets, stats, controlIds };

  // 控制項計數（DOM 實際數量，供驗證比對）
  const outsideRegions = (e) => !inRegion(e) && isVisible(e);
  const domCounts = {
    input: [...document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=hidden])')].filter((e) => outsideRegions(e) && !isSrOnly(e)).length,
    select: [...document.querySelectorAll('select')].filter(outsideRegions).length,
    textarea: [...document.querySelectorAll('textarea')].filter(outsideRegions).length,
    checkbox: [...document.querySelectorAll('input[type=checkbox]')].filter((e) => !inRegion(e) && isVisible(e.parentElement || e)).length,
    radio: [...document.querySelectorAll('input[type=radio]')].filter((e) => !inRegion(e) && isVisible(e.parentElement || e)).length,
    button: [...document.querySelectorAll('button,[role=button]')].filter(outsideRegions).length,
    link: [...document.querySelectorAll('a[href]')].filter(outsideRegions).length,
  };

  const bodyText = (() => {
    const clone = [];
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      const p = n.parentElement;
      const v = (n.nodeValue || '').replace(/\s+/g, ' ').trim();
      if (!v || !p || !isVisible(p) || inRegion(p)) continue;
      const rg = document.createRange(); rg.selectNodeContents(n);
      if (![...rg.getClientRects()].some((r) => r.width > 0.5 && r.height > 0.5)) continue;
      const pr = absRect(p.getBoundingClientRect());
      if (pr.w <= 1.5 && pr.h <= 1.5) continue; // sr-only
      const inter = intersect(pr, clipOf(p));
      if (inter.w <= 0 || inter.h <= 0) continue;
      clone.push(v);
    }
    return clone;
  })();

  return {
    url: location.href,
    pathname: location.pathname,
    title: document.title,
    scrollHeight: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: innerWidth,
    nodes,
    regions,
    assets,
    stats,
    domCounts,
    bodyText,
    controlIds,
    headings: [...document.querySelectorAll('h1,h2')].filter((e) => isVisible(e) && !inRegion(e)).map((e) => e.innerText.replace(/\s+/g, ' ').trim()).slice(0, 4),
  };
}

