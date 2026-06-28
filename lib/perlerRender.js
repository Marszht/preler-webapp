/**
 * perlerRender.js
 * 把 pattern 矩阵渲染成带网格线、色号文字的底稿图。
 * ------------------------------------------------------------
 * 只使用最基础、最通用的 Canvas 2D Context API：
 *   fillRect / strokeRect / fillText / font / fillStyle / strokeStyle
 * 这套 API Node 的 `canvas` 包和 WeChat 小程序的 canvas 组件都支持，
 * 所以这一份代码两边可以直接复用，不用维护两套渲染逻辑。
 *
 * 用法（两边一致）：
 *   const { renderPattern } = require('./perlerRender');
 *   renderPattern(ctx, pattern, paletteMap, { cellSize: 20, showLabels: true });
 *
 * ctx: CanvasRenderingContext2D（Node: canvas.getContext('2d')；
 *      小程序: canvas组件通过 wx.createCanvasContext / canvas.getContext('2d') 拿到）
 * paletteMap: { "A1": [250,244,200], ... }  代码 -> RGB 的查表
 */

function rgbToCss([r, g, b]) {
  return `rgb(${r},${g},${b})`;
}

function relativeLuminance([r, g, b]) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array<Array<string|null>>} pattern
 * @param {Object} paletteMap  色号 -> [r,g,b]
 * @param {Object} options
 *   - cellSize: number          每格像素大小，默认 20
 *   - showLabels: boolean       是否在格子里写色号文字，默认 true
 *   - gridLineColor: string     网格线颜色，默认 'rgb(180,180,180)'
 *   - bgCellColor: string       背景格(null)的填充色，默认 'rgb(250,250,250)'
 *   - bgGridLineColor: string   背景格网格线颜色，默认 'rgb(225,225,225)'
 *   - fontSizeRatio: number     字号 = cellSize * ratio，默认 0.32
 */
function renderPattern(ctx, pattern, paletteMap, options = {}) {
  const {
    cellSize = 20,
    showLabels = true,
    gridLineColor = "rgb(180,180,180)",
    bgCellColor = "rgb(250,250,250)",
    bgGridLineColor = "rgb(225,225,225)",
    fontSizeRatio = 0.32,
  } = options;

  const h = pattern.length;
  const w = h > 0 ? pattern[0].length : 0;

  ctx.font = `bold ${Math.max(8, Math.round(cellSize * fontSizeRatio))}px sans-serif`;
  ctx.textBaseline = "top";

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const code = pattern[y][x];
      const x0 = x * cellSize;
      const y0 = y * cellSize;

      if (code === null) {
        ctx.fillStyle = bgCellColor;
        ctx.fillRect(x0, y0, cellSize, cellSize);
        ctx.strokeStyle = bgGridLineColor;
        ctx.strokeRect(x0, y0, cellSize, cellSize);
        continue;
      }

      const rgb = paletteMap[code] || [200, 200, 200];
      ctx.fillStyle = rgbToCss(rgb);
      ctx.fillRect(x0, y0, cellSize, cellSize);
      ctx.strokeStyle = gridLineColor;
      ctx.strokeRect(x0, y0, cellSize, cellSize);

      if (showLabels) {
        const brightness = relativeLuminance(rgb);
        ctx.fillStyle = brightness > 140 ? "rgb(0,0,0)" : "rgb(255,255,255)";
        ctx.fillText(code, x0 + 2, y0 + 2);
      }
    }
  }
}

/** 把色卡数组 [{code, rgb}] 转换成 renderPattern 需要的 { code: rgb } 查表格式 */
function paletteToMap(palette) {
  const map = {};
  for (const p of palette) map[p.code] = p.rgb;
  return map;
}

const PerlerRender = { renderPattern, paletteToMap, rgbToCss };

if (typeof module === "object" && module.exports) {
  module.exports = PerlerRender;
} else {
  (typeof self !== "undefined" ? self : this).PerlerRender = PerlerRender;
}
