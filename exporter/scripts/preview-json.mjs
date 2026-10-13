// 以簡易 HTML 轉譯器預覽產出的 Figma JSON，並和 React 實際畫面並排輸出，供目視檢查。
// 用法：node scripts/preview-json.mjs --size desktop|mobile --route /member/profile [--out file.png]
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { ROOT, BASE_URL, EDGE, SIZES, buildRouteMatrix, applyAfter } from './lib/route-matrix.mjs';

const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const sizeKey = arg('--size', 'desktop');
const route = arg('--route', '/');
const SIZE = SIZES[sizeKey];
const screens = JSON.parse(fs.readFileSync(path.join(ROOT, 'figma', 'screens', `${SIZE.dir}-all-screens-${SIZE.ver}.json`), 'utf8'));
const components = JSON.parse(fs.readFileSync(path.join(ROOT, 'figma', 'components', `${sizeKey}-components-${SIZE.ver}.json`), 'utf8'));
const nameArg = arg('--name', null);
const m = buildRouteMatrix(sizeKey).find((x) => (nameArg ? x.frameName === nameArg : x.route === route && x.primary));
if (!m) throw new Error(`找不到畫面：${nameArg || route}`);
const frame = screens.find((f) => f.name === m.frameName);

const c255 = (c, a) => `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${a})`;
const rgba = (fills) => {
  const f = (fills || []).find((x) => x.type === 'SOLID');
  if (!f) return 'transparent';
  return c255(f.color, f.opacity ?? 1);
};
// 多層填色（含線性漸層）→ CSS background
const background = (fills) => {
  if (!fills || !fills.length) return 'transparent';
  const layers = [...fills].reverse().map((f) => {
    if (f.type === 'SOLID') return `linear-gradient(${c255(f.color, f.opacity ?? 1)},${c255(f.color, f.opacity ?? 1)})`;
    if (f.type === 'GRADIENT_LINEAR') {
      const [dx, dy] = f.gradientTransform[0];
      const angle = Math.round((Math.atan2(dx, -dy) * 180) / Math.PI);
      return `linear-gradient(${angle}deg,${f.gradientStops.map((s) => `${c255(s.color, s.color.a)} ${Math.round(s.position * 100)}%`).join(',')})`;
    }
    return null;
  }).filter(Boolean);
  return layers.join(',');
};
const font = (n) => (n?.fontName ? `'${n.fontName.family}'` : "'Noto Sans TC'") + ",'Microsoft JhengHei',sans-serif";
const shadow = (n) => (n.effects?.length ? `box-shadow:${n.effects.map((e) => `${e.type === 'INNER_SHADOW' ? 'inset ' : ''}${e.offset.x}px ${e.offset.y}px ${e.radius}px ${e.spread}px rgba(${Math.round(e.color.r * 255)},${Math.round(e.color.g * 255)},${Math.round(e.color.b * 255)},${e.color.a})`).join(',')};` : '');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
function findVariant(compName, variant) {
  const c = components.find((x) => x.name === compName);
  if (!c) return null;
  if (c.type === 'COMPONENT_SET') return c.children.find((v) => v.name === variant) || c.children[0];
  return c;
}
function render(n) {
  const pos = `left:${n.x || 0}px;top:${n.y || 0}px;width:${n.width}px;height:${n.height}px;`;
  const op = n.opacity !== undefined ? `opacity:${n.opacity};` : '';
  switch (n.type) {
    case 'FRAME': case 'COMPONENT': {
      // 簡易 Auto Layout：依序堆疊子層（絕對定位子層維持原座標）
      let kidsData = n.children || [];
      if (n.layoutMode === 'VERTICAL' || n.layoutMode === 'HORIZONTAL') {
        let cursor = n.layoutMode === 'VERTICAL' ? (n.paddingTop || 0) : (n.paddingLeft || 0);
        kidsData = kidsData.map((c) => {
          if (c.layoutPositioning === 'ABSOLUTE') return c;
          const placed = n.layoutMode === 'VERTICAL' ? { ...c, x: n.paddingLeft || 0, y: cursor } : { ...c, x: cursor, y: n.paddingTop || 0 };
          cursor += (n.layoutMode === 'VERTICAL' ? c.height : c.width) + (n.itemSpacing || 0);
          return placed;
        });
      }
      const kids = kidsData.map(render).join('');
      // Figma：未指定 fills 的新 Frame 會是白底，這裡照實模擬，才能抓到破圖。
      const bg = n.fills === undefined ? '#fff' : background(n.fills);
      return `<div style="position:absolute;${pos}${op}background:${bg};${shadow(n)}${n.clipsContent ? 'overflow:hidden;' : ''}">${kids}</div>`;
    }
    case 'RECTANGLE': {
      const stroke = n.strokes?.length ? `border:${n.strokeWeight || 1}px solid ${rgba(n.strokes)};` : '';
      return `<div style="position:absolute;${pos}${op}box-sizing:border-box;background:${background(n.fills)};${stroke}${shadow(n)}border-radius:${n.cornerRadius || 0}px"></div>`;
    }
    case 'TEXT': {
      const wrap = n.textAutoResize === 'WIDTH_AND_HEIGHT' ? 'white-space:pre;' : 'white-space:pre-wrap;';
      const align = (n.textAlignHorizontal || 'LEFT').toLowerCase();
      // 範圍樣式 → span
      let html = esc(n.characters);
      if (n.styledRanges?.length) {
        const pieces = [];
        let pos = 0;
        for (const r of n.styledRanges) {
          if (r.start > pos) pieces.push(esc(n.characters.slice(pos, r.start)));
          const color = r.fills ? (r.fills.length ? rgba(r.fills) : 'transparent') : 'inherit';
          pieces.push(`<span style="color:${color};font-family:${font(r)};font-weight:${/Bold|Black/.test(r.fontName?.style || '') ? 700 : /Medium/.test(r.fontName?.style || '') ? 500 : 'inherit'};font-size:${r.fontSize}px;${r.textDecoration === 'UNDERLINE' ? 'text-decoration:underline;' : ''}">${esc(n.characters.slice(r.start, r.end))}</span>`);
          pos = r.end;
        }
        pieces.push(esc(n.characters.slice(pos)));
        html = pieces.join('');
      }
      return `<div style="position:absolute;left:${n.x}px;top:${n.y}px;width:${n.width}px;${wrap}${op}font-family:${font(n)};font-size:${n.fontSize}px;line-height:${n.lineHeightPx || n.fontSize * 1.3}px;font-weight:${n.fontWeight || 400};${n.italic ? 'font-style:italic;' : ''}${n.textDecoration === 'UNDERLINE' ? 'text-decoration:underline;' : ''}${n.letterSpacing ? `letter-spacing:${n.letterSpacing}px;` : ''}color:${rgba(n.fills)};text-align:${align};${n.maxLines ? `display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:${n.maxLines};overflow:hidden;white-space:${n.maxLines === 1 ? 'nowrap' : 'normal'};text-overflow:ellipsis;height:${n.height}px;` : ''}">${html}</div>`;
    }
    case 'IMAGE':
      return `<img style="position:absolute;${pos}${op}object-fit:fill" src="data:image/png;base64,${n.imageData}">`;
    case 'SVG':
      return `<div style="position:absolute;${pos}${op}">${n.svg}</div>`;
    case 'INSTANCE': {
      const v = findVariant(n.component, n.variant);
      if (!v) return `<div style="position:absolute;${pos}background:#fcc"></div>`;
      const vbg = v.fills === undefined ? '#fff' : rgba(v.fills);
      return `<div style="position:absolute;${pos}background:${vbg};${v.opacity !== undefined ? `opacity:${v.opacity};` : ''}">${(v.children || []).map(render).join('')}</div>`;
    }
    default: return '';
  }
}
const html = `<html><body style="margin:0;background:#888"><div style="position:relative;width:${frame.width}px;height:${frame.height}px;background:#fff;overflow:hidden">${render({ ...frame, x: 0, y: 0, type: 'FRAME', clipsContent: true })}</div></body></html>`;
const browser = await chromium.launch({ headless: true, executablePath: EDGE });
const ctx = await browser.newContext({ viewport: { width: SIZE.width, height: SIZE.height } });
await ctx.addInitScript((a) => localStorage.setItem('uupon-auth-status', a), m.auth);
const page = await ctx.newPage();
await page.setContent(html);
await page.waitForTimeout(300);
const outBase = arg('--out', path.join(ROOT, 'reports', 'work', `preview-${sizeKey}`));
fs.mkdirSync(path.dirname(outBase), { recursive: true });
await page.screenshot({ path: `${outBase}-figma.png`, fullPage: true });
await page.goto(`${BASE_URL}${m.route}`);
await page.waitForTimeout(1000);
if (m.pathname === '/survey') await page.click('[role="dialog"] button[aria-label="關閉"]:not(.fixed)').catch(() => {});
await applyAfter(page, m);
await page.waitForTimeout(300);
await page.screenshot({ path: `${outBase}-react.png`, fullPage: true });
await browser.close();
console.log('saved', `${outBase}-figma.png`, `${outBase}-react.png`);
