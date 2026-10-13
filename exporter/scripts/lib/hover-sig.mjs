// 控制項外觀簽章：用來判斷 hover 前後是否不同，以及在不同畫面／Variant 間重複使用同一組 Hover 元件。
// 不含位置、ID、圖片 base64；圖片以來源網址（src）區分。
const DROP = new Set(['pluginData', 'imageData', 'assetIndex']);

export function signature(node) {
  const norm = (n, isRoot) => {
    const out = {};
    for (const [k, v] of Object.entries(n)) {
      if (DROP.has(k)) continue;
      if (isRoot && (k === 'x' || k === 'y' || k === 'name')) continue;
      if (k === 'children') out.children = v.map((c) => norm(c, false));
      else if (typeof v === 'number') out[k] = Math.round(v * 2) / 2;
      else out[k] = v;
    }
    return out;
  };
  return JSON.stringify(norm(node, true));
}
