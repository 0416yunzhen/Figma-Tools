// 從最新產出的 JSON 挑出小而完整的範例，寫到技能的 templates/ 資料夾，供日後當作範本參考。
// 完整產出每個檔案有 10–15MB（含 base64 圖片），不適合放進技能；範例只保留結構，圖片以佔位文字取代。
// 用法：node scripts/make-skill-samples.mjs [--out <資料夾>]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT } from './lib/route-matrix.mjs';

const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const OUT = arg('--out', path.join(os.homedir(), '.claude', 'skills', 'react-to-figma', 'templates'));
const read = (...p) => JSON.parse(fs.readFileSync(path.join(ROOT, 'figma', ...p), 'utf8'));
const write = (name, obj) => {
  const text = JSON.stringify(obj, null, 2);
  fs.writeFileSync(path.join(OUT, name), text, 'utf8');
  console.log(`${name.padEnd(42)} ${(text.length / 1024).toFixed(1)} KB`);
};
fs.mkdirSync(OUT, { recursive: true });

const IMG = '<BASE64_PNG_OMITTED>';
const strip = (n) => {
  if (Array.isArray(n)) return n.map(strip);
  if (n && typeof n === 'object') {
    const o = {};
    for (const [k, v] of Object.entries(n)) {
      if (k === 'imageData' && typeof v === 'string') o[k] = IMG;
      else if (k === 'svg' && typeof v === 'string' && v.length > 600) o[k] = v.slice(0, 600) + '…（SVG 其餘省略）';
      else o[k] = strip(v);
    }
    return o;
  }
  return n;
};

const screens = read('screens', 'mobile-390-all-screens-v1.json');
const comps = read('components', 'mobile-components-v1.json');
const protoMobile = read('prototype', 'mobile-390-v1.json');
const compsDesktop = read('components', 'desktop-components-v1.json');
const protoDesktop = read('prototype', 'desktop-1440-v1.json');
const byName = (list, name) => list.find((x) => x.name === name);
const variants = (set, names) => ({ ...set, children: set.children.filter((v) => names.includes(v.name)) });

// 1. 一般畫面：簡單頁面（Button Frame、Input、Text、Block 的寫法；Header／Footer／Chat 為 INSTANCE）
write('screen-simple-forgot-password.json', strip(byName(screens, 'Auth / Forgot Password / Mobile')));
// 2. 含手風琴的畫面：三段垂直 Auto Layout（上方／手風琴／下方）＋絕對定位的固定圖層
const faq = byName(screens, 'FAQ / Mobile');
write('screen-accordion-auto-layout.json', strip({
  ...faq,
  children: faq.children.map((c) => (c.children && c.children.length > 12 ? { ...c, children: c.children.slice(0, 12), _note: '子層只保留前 12 個' } : c)),
}));
// 3. 共用元件
write('component-header-set.json', strip(variants(byName(comps, 'Header / Mobile'), ['Auth=Guest, Menu=Closed', 'Auth=Guest, Menu=Earn'])));
write('component-footer.json', strip(byName(comps, 'Footer / Mobile')));
write('component-banner-set.json', strip(variants(byName(comps, 'Banner / Mobile'), ['Slide=01', 'Slide=02'])));
write('component-chat-set.json', strip(byName(comps, 'Chat / Mobile')));
write('component-accordion-single-open.json', strip(variants(byName(comps, 'FAQ Accordion / Mobile'), ['Open=None', 'Open=01'])));
write('component-accordion-multi-open.json', strip(variants(byName(comps, 'Survey FAQ Accordion / Mobile'), ['Q1=Closed, Q2=Closed, Q3=Closed, Q4=Closed', 'Q1=Open, Q2=Closed, Q3=Closed, Q4=Closed'])));
write('frame-overlay-survey-prompt.json', strip(byName(comps, 'Survey Prompt / Overlay / Mobile')));
// 4. 狀態元件（Desktop：Hover；Checkbox：點擊）
const hover = compsDesktop.find((c) => c.type === 'COMPONENT_SET' && c.name.startsWith('Hover /') && c.children.some((v) => v.children?.length > 3)) || compsDesktop.find((c) => c.name.startsWith('Hover /'));
write('component-hover-set.json', strip(hover));
write('component-checkbox-set.json', strip(compsDesktop.find((c) => c.name.startsWith('Checkbox #'))));
// 5. Prototype：每種觸發與動作各挑幾條，其餘欄位完整保留
const pick = (pred, n) => protoDesktop.reactions.filter(pred).slice(0, n);
const sample = [
  ...pick((r) => r.action.type === 'NAVIGATE' && r.source.scope === 'screen', 2),
  ...pick((r) => r.action.type === 'NAVIGATE' && r.source.scope === 'component', 2),
  ...pick((r) => r.action.type === 'CHANGE_TO' && r.trigger === 'ON_CLICK' && /Banner/.test(r.source.component || ''), 2),
  ...pick((r) => r.trigger === 'AFTER_TIMEOUT' && r.action.type === 'CHANGE_TO', 1),
  ...pick((r) => r.trigger === 'MOUSE_ENTER', 1),
  ...pick((r) => r.trigger === 'MOUSE_LEAVE', 1),
  ...pick((r) => r.trigger === 'ON_HOVER', 1),
  ...pick((r) => r.action.type === 'OVERLAY', 1),
  ...pick((r) => r.action.type === 'CLOSE', 1),
  ...pick((r) => /^Checkbox/.test(r.source.component || ''), 2),
  ...pick((r) => r.note === '分頁切換', 1),
];
write('prototype-v8-sample.json', { ...protoDesktop, reactions: sample });
write('prototype-v8-mobile-header.json', {
  ...protoMobile,
  reactions: protoMobile.reactions.filter((r) => r.source.component === 'Header / Mobile').slice(0, 6),
});
console.log('完成 →', OUT);
