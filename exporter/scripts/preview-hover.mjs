// 預覽 Hover 元件：每組並排顯示 Default / Hover，供目視檢查。
// 用法：node scripts/preview-hover.mjs --match 關鍵字 [--limit 12]
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { ROOT, EDGE } from './lib/route-matrix.mjs';

const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const match = arg('--match', '');
const limit = Number(arg('--limit', 12));
const components = JSON.parse(fs.readFileSync(path.join(ROOT, 'figma', 'components', 'desktop-components-v1.json'), 'utf8'));
const sets = components.filter((c) => c.type === 'COMPONENT_SET' && c.name.startsWith('Hover /') && c.name.includes(match)).slice(0, limit);
const byName = new Map(components.map((c) => [c.name, c]));
const c255 = (c, a) => `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${a})`;
const bg = (fills) => {
  if (!fills || !fills.length) return 'transparent';
  return [...fills].reverse().map((f) => (f.type === 'SOLID' ? `linear-gradient(${c255(f.color, f.opacity ?? 1)},${c255(f.color, f.opacity ?? 1)})` : f.type === 'GRADIENT_LINEAR' ? `linear-gradient(${Math.round((Math.atan2(f.gradientTransform[0][0], -f.gradientTransform[0][1]) * 180) / Math.PI)}deg,${f.gradientStops.map((s) => `${c255(s.color, s.color.a)} ${Math.round(s.position * 100)}%`).join(',')})` : null)).filter(Boolean).join(',');
};
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
function render(n) {
  const pos = `position:absolute;left:${n.x || 0}px;top:${n.y || 0}px;width:${n.width}px;height:${n.height}px;${n.opacity !== undefined ? `opacity:${n.opacity};` : ''}`;
  const sh = n.effects?.length ? `box-shadow:${n.effects.map((e) => `${e.offset.x}px ${e.offset.y}px ${e.radius}px ${e.spread}px ${c255(e.color, e.color.a)}`).join(',')};` : '';
  if (n.type === 'FRAME' || n.type === 'COMPONENT') return `<div style="${pos}background:${n.fills === undefined ? '#fff' : bg(n.fills)};${sh}">${(n.children || []).map(render).join('')}</div>`;
  if (n.type === 'RECTANGLE') return `<div style="${pos}box-sizing:border-box;background:${bg(n.fills)};${n.strokes?.length ? `border:${n.strokeWeight}px solid ${c255(n.strokes[0].color, n.strokes[0].opacity ?? 1)};` : ''}${sh}border-radius:${n.cornerRadius || 0}px"></div>`;
  if (n.type === 'TEXT') return `<div style="position:absolute;left:${n.x}px;top:${n.y}px;width:${n.width}px;white-space:${n.textAutoResize === 'WIDTH_AND_HEIGHT' ? 'pre' : 'pre-wrap'};font-family:'Noto Sans TC';font-size:${n.fontSize}px;line-height:${n.lineHeightPx || n.fontSize * 1.4}px;font-weight:${n.fontWeight || 400};color:${n.fills?.[0] ? c255(n.fills[0].color, n.fills[0].opacity ?? 1) : '#000'};${n.textDecoration === 'UNDERLINE' ? 'text-decoration:underline;' : ''}text-align:${(n.textAlignHorizontal || 'LEFT').toLowerCase()}">${esc(n.characters)}</div>`;
  if (n.type === 'IMAGE') return `<img style="${pos}" src="data:image/png;base64,${n.imageData}">`;
  if (n.type === 'SVG') return `<div style="${pos}">${n.svg}</div>`;
  if (n.type === 'INSTANCE') {
    const c = byName.get(n.component);
    const v = c?.type === 'COMPONENT_SET' ? c.children.find((x) => x.name === n.variant) : c;
    return v ? `<div style="${pos}">${(v.children || []).map(render).join('')}</div>` : '';
  }
  return '';
}
const rows = sets.map((set) => {
  const [d, h] = set.children;
  const w = d.width, hgt = d.height;
  return `<div style="margin:10px;font:12px sans-serif">${esc(set.name)}</div><div style="display:flex;gap:30px;margin:0 10px 20px">${[d, h].map((v) => `<div style="position:relative;width:${w}px;height:${hgt}px;outline:1px dashed #aaa">${render({ ...v, x: 0, y: 0 })}</div>`).join('')}</div>`;
}).join('');
const browser = await chromium.launch({ headless: true, executablePath: EDGE });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
await page.setContent(`<html><body style="margin:0;background:#f4f4f4">${rows}</body></html>`);
await page.waitForTimeout(300);
const out = path.join(ROOT, 'reports', 'work', `hover-preview${match ? '-' + match.replace(/[^a-zA-Z0-9]/g, '') : ''}.png`);
await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log(sets.length, out);
