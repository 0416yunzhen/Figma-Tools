// 全部路由：JSON 轉譯畫面 vs React 實際畫面 逐像素比對，輸出差異比例與差異圖。
// 用法：node scripts/diff-all.mjs --size desktop|mobile [--only /route]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { ROOT, EDGE, SIZES, buildRouteMatrix } from './lib/route-matrix.mjs';

const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const sizeKey = arg('--size', 'desktop');
const only = arg('--only', null);
const SIZE = SIZES[sizeKey];
const OUT = path.join(ROOT, 'reports', 'work', `diff-${sizeKey}`);
fs.mkdirSync(OUT, { recursive: true });
const matrix = buildRouteMatrix(sizeKey).filter((m) => !only || m.route === only);
const slug = (s) => s.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();

for (const m of matrix) {
  const base = path.join(OUT, slug(m.frameName));
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'preview-json.mjs'), '--size', sizeKey, '--route', m.route, '--name', m.frameName, '--out', base], { stdio: 'ignore' });
}

const browser = await chromium.launch({ headless: true, executablePath: EDGE });
const page = await browser.newPage();
await page.setContent('<canvas id="a"></canvas><canvas id="b"></canvas>');
const results = [];
for (const m of matrix) {
  const base = path.join(OUT, slug(m.frameName));
  const a = fs.readFileSync(`${base}-figma.png`).toString('base64');
  const b = fs.readFileSync(`${base}-react.png`).toString('base64');
  const r = await page.evaluate(async ({ a, b }) => {
    const load = (src) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = src; });
    const [ia, ib] = await Promise.all([load(`data:image/png;base64,${a}`), load(`data:image/png;base64,${b}`)]);
    const w = Math.max(ia.width, ib.width), h = Math.max(ia.height, ib.height);
    const ca = document.getElementById('a'), cb = document.getElementById('b');
    ca.width = cb.width = w; ca.height = cb.height = h;
    const xa = ca.getContext('2d'), xb = cb.getContext('2d');
    xa.fillStyle = xb.fillStyle = '#ff00ff'; xa.fillRect(0, 0, w, h); xb.fillRect(0, 0, w, h);
    xa.drawImage(ia, 0, 0); xb.drawImage(ib, 0, 0);
    const da = xa.getImageData(0, 0, w, h).data, db = xb.getImageData(0, 0, w, h).data;
    const out = xa.createImageData(w, h);
    let diff = 0;
    // 以 8×8 區塊比較平均色，降低字型反鋸齒造成的雜訊
    const B = 8;
    const bw = Math.ceil(w / B), bh = Math.ceil(h / B);
    let blocks = 0;
    for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
      let sa = [0, 0, 0], sb = [0, 0, 0], n = 0;
      for (let y = by * B; y < Math.min(h, by * B + B); y++) for (let x = bx * B; x < Math.min(w, bx * B + B); x++) {
        const i = (y * w + x) * 4;
        for (let k = 0; k < 3; k++) { sa[k] += da[i + k]; sb[k] += db[i + k]; }
        n++;
      }
      const d = Math.abs(sa[0] - sb[0]) / n + Math.abs(sa[1] - sb[1]) / n + Math.abs(sa[2] - sb[2]) / n;
      blocks++;
      const bad = d > 40;
      if (bad) diff++;
      for (let y = by * B; y < Math.min(h, by * B + B); y++) for (let x = bx * B; x < Math.min(w, bx * B + B); x++) {
        const i = (y * w + x) * 4;
        const g = (db[i] + db[i + 1] + db[i + 2]) / 3;
        out.data[i] = bad ? 255 : g * 0.6 + 100; out.data[i + 1] = bad ? 0 : g * 0.6 + 100; out.data[i + 2] = bad ? 0 : g * 0.6 + 100; out.data[i + 3] = 255;
      }
    }
    xa.putImageData(out, 0, 0);
    return { ratio: diff / blocks, w, h, heightA: ia.height, heightB: ib.height, png: ca.toDataURL('image/png').split(',')[1] };
  }, { a, b });
  fs.writeFileSync(`${base}-diff.png`, Buffer.from(r.png, 'base64'));
  results.push({ frame: m.frameName, route: m.route, diffRatio: Math.round(r.ratio * 10000) / 100, figmaHeight: r.heightA, reactHeight: r.heightB });
}
await browser.close();
results.sort((x, y) => y.diffRatio - x.diffRatio);
fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(results, null, 1));
for (const r of results) console.log(String(r.diffRatio).padStart(6) + '%', r.frame, r.figmaHeight === r.reactHeight ? '' : `高度 ${r.figmaHeight}/${r.reactHeight}`);
