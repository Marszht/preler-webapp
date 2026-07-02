/**
 * perlerCore.js
 * 拼豆底稿生成 —— 纯算法核心，零依赖
 * ------------------------------------------------------------
 * 不依赖 fs / canvas / 任何 Node 专属 API，因此可以原样：
 *  - require() 进 Node.js 脚本/服务
 *  - 复制进 WeChat 小程序的 utils 目录直接 require
 *  - 跑在浏览器 / Web Worker 里
 *
 * 输入输出都使用平台无关的数据结构：
 *  - 图片数据: { data: Uint8ClampedArray|Array, width, height }  (RGBA, 0-255)
 *    这正是 canvas getImageData() 的返回结构，Node-canvas 和小程序 canvas
 *    的 getImageData 都是这个格式，所以上层不用关心平台差异。
 *  - 色卡: [{ code: "A1", rgb: [250,244,200] }, ...]
 *
 * 用法：
 *   const { imageToPattern } = require('./perlerCore');
 *   const result = imageToPattern(imageData, palette, options);
 *   // result.pattern: Array<Array<string|null>>  (null = 背景，不出豆)
 *   // result.counts:  { "A1": 12, "B3": 8, ... }
 */

// ============================================================
// 颜色空间转换 & 色差公式
// ============================================================

/** sRGB -> CIE Lab，逐通道，输入 0-255 */
function rgbToLab(r, g, b) {
  let [rl, gl, bl] = [r, g, b].map((v) => {
    v = v / 255;
    return v > 0.04045 ? Math.pow((v + 0.055) / 1.055, 2.4) : v / 12.92;
  });

  // sRGB -> XYZ (D65)
  let x = rl * 0.4124564 + gl * 0.3575761 + bl * 0.1804375;
  let y = rl * 0.2126729 + gl * 0.7151522 + bl * 0.072175;
  let z = rl * 0.0193339 + gl * 0.119192 + bl * 0.9503041;

  // 归一化到 D65 白点
  x /= 0.95047;
  y /= 1.0;
  z /= 1.08883;

  const f = (t) => (t > 0.008856 ? Math.pow(t, 1 / 3) : 7.787 * t + 16 / 116);
  const fx = f(x),
    fy = f(y),
    fz = f(z);

  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/**
 * CIEDE2000 色差公式 —— 比简单 Lab 欧氏距离更接近人眼感知，
 * 尤其在中等饱和度、色相过渡区域差异明显。
 * 输入: 两组 [L, a, b]
 */
function deltaE2000(lab1, lab2) {
  const [L1, a1, b1] = lab1;
  const [L2, a2, b2] = lab2;

  const avgL = (L1 + L2) / 2;
  const C1 = Math.sqrt(a1 * a1 + b1 * b1);
  const C2 = Math.sqrt(a2 * a2 + b2 * b2);
  const avgC = (C1 + C2) / 2;

  const G = 0.5 * (1 - Math.sqrt(Math.pow(avgC, 7) / (Math.pow(avgC, 7) + Math.pow(25, 7))));
  const a1p = a1 * (1 + G);
  const a2p = a2 * (1 + G);

  const C1p = Math.sqrt(a1p * a1p + b1 * b1);
  const C2p = Math.sqrt(a2p * a2p + b2 * b2);
  const avgCp = (C1p + C2p) / 2;

  const h1p = (Math.atan2(b1, a1p) * 180) / Math.PI + (Math.atan2(b1, a1p) < 0 ? 360 : 0);
  const h2p = (Math.atan2(b2, a2p) * 180) / Math.PI + (Math.atan2(b2, a2p) < 0 ? 360 : 0);

  let deltahp;
  if (Math.abs(h1p - h2p) <= 180) deltahp = h2p - h1p;
  else if (h2p <= h1p) deltahp = h2p - h1p + 360;
  else deltahp = h2p - h1p - 360;

  const deltaLp = L2 - L1;
  const deltaCp = C2p - C1p;
  const deltaHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((deltahp * Math.PI) / 360);

  const avgHp = Math.abs(h1p - h2p) <= 180 ? (h1p + h2p) / 2 : (h1p + h2p + 360) / 2;

  const T =
    1 -
    0.17 * Math.cos(((avgHp - 30) * Math.PI) / 180) +
    0.24 * Math.cos((2 * avgHp * Math.PI) / 180) +
    0.32 * Math.cos(((3 * avgHp + 6) * Math.PI) / 180) -
    0.2 * Math.cos(((4 * avgHp - 63) * Math.PI) / 180);

  const SL = 1 + (0.015 * Math.pow(avgL - 50, 2)) / Math.sqrt(20 + Math.pow(avgL - 50, 2));
  const SC = 1 + 0.045 * avgCp;
  const SH = 1 + 0.015 * avgCp * T;

  const deltaTheta = 30 * Math.exp(-Math.pow((avgHp - 275) / 25, 2));
  const RC = 2 * Math.sqrt(Math.pow(avgCp, 7) / (Math.pow(avgCp, 7) + Math.pow(25, 7)));
  const RT = -RC * Math.sin((2 * deltaTheta * Math.PI) / 180);

  const kL = 1,
    kC = 1,
    kH = 1;

  return Math.sqrt(
    Math.pow(deltaLp / (kL * SL), 2) +
      Math.pow(deltaCp / (kC * SC), 2) +
      Math.pow(deltaHp / (kH * SH), 2) +
      RT * (deltaCp / (kC * SC)) * (deltaHp / (kH * SH))
  );
}

/** 简单 Lab 欧氏距离，比 CIEDE2000 快很多倍，差距图片够用 */
function labEuclidean(lab1, lab2, lWeight = 1) {
  const dl = (lab1[0] - lab2[0]) * lWeight;
  const da = lab1[1] - lab2[1];
  const db = lab1[2] - lab2[2];
  return dl * dl + da * da + db * db; // 不开根号，只用于比较大小
}

// ============================================================
// 色卡预处理
// ============================================================

/** 把 [{code, rgb}] 色卡预先转换成 Lab，避免每像素重复计算 */
function buildPaletteIndex(palette) {
  return palette.map((p) => ({
    code: p.code,
    rgb: p.rgb,
    lab: rgbToLab(p.rgb[0], p.rgb[1], p.rgb[2]),
  }));
}

/**
 * 在色卡里找最接近的颜色。
 * distanceMode: 'lab' (默认，快) | 'ciede2000' (更准，慢约5-10倍)
 */
function findNearestColor(rgb, paletteIndex, distanceMode = "lab", lWeight = 1) {
  const lab = rgbToLab(rgb[0], rgb[1], rgb[2]);
  let best = -1;
  let bestDist = Infinity;

  for (let i = 0; i < paletteIndex.length; i++) {
    const dist =
      distanceMode === "ciede2000"
        ? deltaE2000(lab, paletteIndex[i].lab)
        : labEuclidean(lab, paletteIndex[i].lab, lWeight);
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
}

// ============================================================
// K-means 预聚类 —— 限制最终用色种类数
// ============================================================

/**
 * 对图片本身的像素颜色做 K-means 聚类，得到 maxColors 个代表色，
 * 再用这些代表色去色卡里匹配 —— 而不是让全部 221 色都有机会出现。
 * 这样最终成品颜色种类可控，方便备料采购。
 *
 * pixels: [[r,g,b], ...]
 * 返回: [[r,g,b], ...] 代表色（长度 = maxColors）
 */
function kmeansColors(pixels, maxColors, iterations = 8) {
  if (pixels.length <= maxColors) return pixels.slice();

  // 用直方图分箱采样初始中心，比随机选点更稳定
  const step = Math.max(1, Math.floor(pixels.length / (maxColors * 20)));
  const sample = [];
  for (let i = 0; i < pixels.length; i += step) sample.push(pixels[i]);

  let centers = [];
  for (let i = 0; i < maxColors; i++) {
    centers.push(sample[Math.floor((i * sample.length) / maxColors)].slice());
  }

  for (let iter = 0; iter < iterations; iter++) {
    const sums = centers.map(() => [0, 0, 0, 0]); // r,g,b,count

    for (const px of sample) {
      let best = 0;
      let bestDist = Infinity;
      for (let c = 0; c < centers.length; c++) {
        const dr = px[0] - centers[c][0];
        const dg = px[1] - centers[c][1];
        const db = px[2] - centers[c][2];
        const dist = dr * dr + dg * dg + db * db;
        if (dist < bestDist) {
          bestDist = dist;
          best = c;
        }
      }
      sums[best][0] += px[0];
      sums[best][1] += px[1];
      sums[best][2] += px[2];
      sums[best][3] += 1;
    }

    centers = centers.map((c, i) =>
      sums[i][3] > 0
        ? [sums[i][0] / sums[i][3], sums[i][1] / sums[i][3], sums[i][2] / sums[i][3]]
        : c
    );
  }

  return centers.map((c) => c.map((v) => Math.round(v)));
}

/**
 * 根据 K-means 代表色，从完整色卡里挑出对应的最近色子集，
 * 得到一份"缩减版色卡"，仅含 maxColors 种颜色。
 */
function reducePalette(imageDataLike, fullPaletteIndex, maxColors) {
  const { data, width, height } = imageDataLike;
  const pixels = [];
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    if (data[o + 3] < 10) continue; // 跳过全透明像素
    pixels.push([data[o], data[o + 1], data[o + 2]]);
  }
  if (pixels.length === 0) return fullPaletteIndex;

  const representativeColors = kmeansColors(pixels, maxColors);
  const seen = new Set();
  const reduced = [];
  for (const rgb of representativeColors) {
    const idx = findNearestColor(rgb, fullPaletteIndex, "lab");
    const entry = fullPaletteIndex[idx];
    if (!seen.has(entry.code)) {
      seen.add(entry.code);
      reduced.push(entry);
    }
  }
  return reduced.length > 0 ? reduced : fullPaletteIndex;
}

// ============================================================
// 背景识别（任意背景色 + 容差，或 alpha 通道）
// ============================================================

function colorDistanceSq(data, offset, rgb) {
  const dr = data[offset] - rgb[0];
  const dg = data[offset + 1] - rgb[1];
  const db = data[offset + 2] - rgb[2];
  return dr * dr + dg * dg + db * db;
}

function isTransparentBackground(data, offset, useAlpha) {
  return useAlpha && data[offset + 3] < 128;
}

/**
 * 从图片四周采样，估算最可能的纯色背景。
 * 用粗分箱统计能容忍 JPEG 噪点和轻微阴影，比直接取四角平均更稳定。
 */
function estimateEdgeBackgroundColor(srcImageData, useAlpha = true) {
  const { data, width, height } = srcImageData;
  if (!width || !height) return null;

  const buckets = new Map();
  const addPixel = (x, y) => {
    const o = (y * width + x) * 4;
    if (isTransparentBackground(data, o, useAlpha)) return;
    const key = `${data[o] >> 4},${data[o + 1] >> 4},${data[o + 2] >> 4}`;
    const bucket = buckets.get(key) || { count: 0, r: 0, g: 0, b: 0 };
    bucket.count++;
    bucket.r += data[o];
    bucket.g += data[o + 1];
    bucket.b += data[o + 2];
    buckets.set(key, bucket);
  };

  for (let x = 0; x < width; x++) {
    addPixel(x, 0);
    if (height > 1) addPixel(x, height - 1);
  }
  for (let y = 1; y < height - 1; y++) {
    addPixel(0, y);
    if (width > 1) addPixel(width - 1, y);
  }

  let best = null;
  for (const bucket of buckets.values()) {
    if (!best || bucket.count > best.count) best = bucket;
  }
  if (!best) return null;
  return [
    Math.round(best.r / best.count),
    Math.round(best.g / best.count),
    Math.round(best.b / best.count),
  ];
}

function pixelMaskToGridMask(pixelMask, srcWidth, srcHeight, gridW, gridH) {
  const cellW = srcWidth / gridW;
  const cellH = srcHeight / gridH;
  const mask = [];

  for (let gy = 0; gy < gridH; gy++) {
    const row = [];
    for (let gx = 0; gx < gridW; gx++) {
      const x0 = Math.floor(gx * cellW);
      const x1 = Math.floor((gx + 1) * cellW);
      const y0 = Math.floor(gy * cellH);
      const y1 = Math.floor((gy + 1) * cellH);

      let bgCount = 0;
      let total = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          total++;
          if (pixelMask[y * srcWidth + x]) bgCount++;
        }
      }
      row.push(total > 0 && bgCount / total > 0.5);
    }
    mask.push(row);
  }
  return mask;
}

/**
 * 像素级纯色背景识别：从图片边缘出发 flood-fill，只删除和边缘连通的背景。
 * 这样主体内部接近背景色的细节不会被误删。
 */
function computeSolidBackgroundPixelMask(srcImageData, options = {}) {
  const { bgColor = [255, 255, 255], bgThreshold = 45, useAlpha = true } = options;
  const { data, width, height } = srcImageData;
  const total = width * height;
  const mask = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;
  const detectedColor = estimateEdgeBackgroundColor(srcImageData, useAlpha) || bgColor;
  const thresholdSq = bgThreshold * bgThreshold;

  const isBackgroundCandidate = (idx) => {
    const o = idx * 4;
    if (isTransparentBackground(data, o, useAlpha)) return true;
    return colorDistanceSq(data, o, detectedColor) <= thresholdSq;
  };

  const addIfBackground = (idx) => {
    if (idx < 0 || idx >= total || mask[idx] || !isBackgroundCandidate(idx)) return;
    mask[idx] = 1;
    queue[tail++] = idx;
  };

  for (let x = 0; x < width; x++) {
    addIfBackground(x);
    addIfBackground((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y++) {
    addIfBackground(y * width);
    addIfBackground(y * width + width - 1);
  }

  while (head < tail) {
    const idx = queue[head++];
    const x = idx % width;
    if (x > 0) addIfBackground(idx - 1);
    if (x < width - 1) addIfBackground(idx + 1);
    if (idx >= width) addIfBackground(idx - width);
    if (idx < total - width) addIfBackground(idx + width);
  }

  if (useAlpha) {
    for (let idx = 0; idx < total; idx++) {
      if (data[idx * 4 + 3] < 128) mask[idx] = 1;
    }
  }

  return { mask, width, height, bgColor: detectedColor };
}

function computeSolidBackgroundMask(srcImageData, gridW, gridH, options = {}) {
  const result = computeSolidBackgroundPixelMask(srcImageData, options);
  return pixelMaskToGridMask(result.mask, result.width, result.height, gridW, gridH);
}

function contentBoundingBoxFromPixelMask(pixelMask, width, height, padding = 0.04) {
  let minX = width,
    minY = height,
    maxX = -1,
    maxY = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (pixelMask[y * width + x]) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < 0) return null;

  const padX = Math.round((maxX - minX) * padding);
  const padY = Math.round((maxY - minY) * padding);
  return {
    x0: Math.max(0, minX - padX),
    y0: Math.max(0, minY - padY),
    x1: Math.min(width, maxX + padX + 1),
    y1: Math.min(height, maxY + padY + 1),
  };
}

/**
 * 计算每个网格格子是否为背景（true = 背景，不出豆）。
 * 在原图分辨率上逐像素判定，再按格子区域统计背景像素占比。
 */
function computeBackgroundMask(srcImageData, gridW, gridH, options = {}) {
  const { bgColor = [0, 0, 0], bgThreshold = 12, useAlpha = true } = options;
  const { data, width, height } = srcImageData;

  const cellW = width / gridW;
  const cellH = height / gridH;
  const mask = [];

  for (let gy = 0; gy < gridH; gy++) {
    const row = [];
    for (let gx = 0; gx < gridW; gx++) {
      const x0 = Math.floor(gx * cellW);
      const x1 = Math.floor((gx + 1) * cellW);
      const y0 = Math.floor(gy * cellH);
      const y1 = Math.floor((gy + 1) * cellH);

      let bgCount = 0;
      let total = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const o = (y * width + x) * 4;
          total++;
          if (useAlpha && data[o + 3] < 128) {
            bgCount++;
            continue;
          }
          if (colorDistanceSq(data, o, bgColor) < bgThreshold * bgThreshold) bgCount++;
        }
      }
      row.push(total > 0 && bgCount / total > 0.5);
    }
    mask.push(row);
  }
  return mask;
}

/**
 * 检测主体内容的最小包围框（排除背景），用于自动裁切构图。
 * 返回 { x0, y0, x1, y1 } 像素坐标，若整图都是背景则返回 null。
 */
function detectContentBoundingBox(srcImageData, options = {}) {
  const {
    bgColor = [0, 0, 0],
    bgThreshold = 12,
    useAlpha = true,
    padding = 0.04,
    bgMode = "manual",
  } = options;
  const { data, width, height } = srcImageData;

  if (bgMode === "auto") {
    const result = computeSolidBackgroundPixelMask(srcImageData, {
      bgColor,
      bgThreshold,
      useAlpha,
    });
    return contentBoundingBoxFromPixelMask(result.mask, width, height, padding);
  }

  let minX = width,
    minY = height,
    maxX = -1,
    maxY = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      let isBg;
      if (useAlpha && data[o + 3] < 128) {
        isBg = true;
      } else {
        isBg = colorDistanceSq(data, o, bgColor) < bgThreshold * bgThreshold;
      }
      if (!isBg) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < 0) return null; // 整图都是背景

  const padX = Math.round((maxX - minX) * padding);
  const padY = Math.round((maxY - minY) * padding);
  return {
    x0: Math.max(0, minX - padX),
    y0: Math.max(0, minY - padY),
    x1: Math.min(width, maxX + padX + 1),
    y1: Math.min(height, maxY + padY + 1),
  };
}

// ============================================================
// 预处理：亮度 / 对比度 / 饱和度
// ============================================================

/** 就地调整 imageDataLike 的亮度对比度饱和度。三个参数都是 -100~100，0 = 不调整 */
function adjustImage(imageDataLike, { brightness = 0, contrast = 0, saturation = 0 } = {}) {
  const { data } = imageDataLike;
  const cFactor = (259 * (contrast + 255)) / (255 * (259 - contrast));

  for (let i = 0; i < data.length; i += 4) {
    let r = data[i],
      g = data[i + 1],
      b = data[i + 2];

    // 亮度
    r += brightness;
    g += brightness;
    b += brightness;

    // 对比度
    r = cFactor * (r - 128) + 128;
    g = cFactor * (g - 128) + 128;
    b = cFactor * (b - 128) + 128;

    // 饱和度（简单灰度混合法）
    if (saturation !== 0) {
      const gray = 0.299 * r + 0.587 * g + 0.114 * b;
      const satFactor = 1 + saturation / 100;
      r = gray + (r - gray) * satFactor;
      g = gray + (g - gray) * satFactor;
      b = gray + (b - gray) * satFactor;
    }

    data[i] = Math.max(0, Math.min(255, r));
    data[i + 1] = Math.max(0, Math.min(255, g));
    data[i + 2] = Math.max(0, Math.min(255, b));
  }
  return imageDataLike;
}

// ============================================================
// 网格化缩放（区域平均，无需 canvas drawImage 时的兜底实现）
// ============================================================

/**
 * 简单区域平均缩放：把 srcImageData 缩小到 dstW x dstH。
 * 注：如果调用方已经有 canvas（Node-canvas / 小程序 canvas），
 * 更推荐直接用 ctx.drawImage 做缩放（有 GPU/库加速，更快更好）。
 * 这个函数是给「拿不到 canvas，只有原始像素数组」场景的兜底方案。
 */
function resizeAreaAverage(srcImageData, dstW, dstH) {
  const { data, width: sw, height: sh } = srcImageData;
  const dst = new Uint8ClampedArray(dstW * dstH * 4);

  for (let dy = 0; dy < dstH; dy++) {
    const sy0 = Math.floor((dy * sh) / dstH);
    const sy1 = Math.max(sy0 + 1, Math.floor(((dy + 1) * sh) / dstH));
    for (let dx = 0; dx < dstW; dx++) {
      const sx0 = Math.floor((dx * sw) / dstW);
      const sx1 = Math.max(sx0 + 1, Math.floor(((dx + 1) * sw) / dstW));

      let r = 0,
        g = 0,
        b = 0,
        a = 0,
        n = 0;
      for (let sy = sy0; sy < sy1; sy++) {
        for (let sx = sx0; sx < sx1; sx++) {
          const o = (sy * sw + sx) * 4;
          r += data[o];
          g += data[o + 1];
          b += data[o + 2];
          a += data[o + 3];
          n++;
        }
      }
      const o2 = (dy * dstW + dx) * 4;
      dst[o2] = r / n;
      dst[o2 + 1] = g / n;
      dst[o2 + 2] = b / n;
      dst[o2 + 3] = a / n;
    }
  }
  return { data: dst, width: dstW, height: dstH };
}

// ============================================================
// 抖动算法
// ============================================================

const DITHER_KERNELS = {
  "floyd-steinberg": [
    { dx: 1, dy: 0, w: 7 / 16 },
    { dx: -1, dy: 1, w: 3 / 16 },
    { dx: 0, dy: 1, w: 5 / 16 },
    { dx: 1, dy: 1, w: 1 / 16 },
  ],
  // Atkinson: 总权重只有 6/8，会让误差"丢掉"一部分而不是全部扩散，
  // 效果比 Floyd-Steinberg 更柔和、噪点更少，复古游戏机像素画常用
  atkinson: [
    { dx: 1, dy: 0, w: 1 / 8 },
    { dx: 2, dy: 0, w: 1 / 8 },
    { dx: -1, dy: 1, w: 1 / 8 },
    { dx: 0, dy: 1, w: 1 / 8 },
    { dx: 1, dy: 1, w: 1 / 8 },
    { dx: 0, dy: 2, w: 1 / 8 },
  ],
};

// ============================================================
// 主流程：图片 -> 拼豆图纸
// ============================================================

/**
 * @param {object} imageDataLike  { data: Uint8ClampedArray, width, height } — 已经缩放到目标格子数的图（RGBA）
 *   注意：缩放本身建议调用方用 canvas drawImage 完成（效果比本模块的兜底缩放好），
 *   本函数假定传入的 imageDataLike 的 width/height 就是目标格子数 gridW x gridH。
 * @param {Array<{code,rgb}>} palette  色卡
 * @param {object} options
 *   - distanceMode: 'lab' | 'ciede2000'           默认 'lab'
 *   - dither: 'none' | 'floyd-steinberg' | 'atkinson'  默认 'floyd-steinberg'
 *   - ditherStrength: 0~1                          默认 1（误差扩散强度，0=等同none）
 *   - maxColors: number|null                       默认 null（不限制，用全色卡）
 *   - bgMask: boolean[][]|null                      默认 null（由调用方提前算好传入，或不去背景）
 *   - despeckle: boolean                            默认 true（合并孤立噪点格）
 */
function imageToPattern(imageDataLike, palette, options = {}) {
  const {
    distanceMode = "lab",
    dither = "floyd-steinberg",
    ditherStrength = 1,
    maxColors = null,
    bgMask = null,
    despeckle = true,
  } = options;

  const { data, width: w, height: h } = imageDataLike;

  let paletteIndex = buildPaletteIndex(palette);
  if (maxColors && maxColors > 0 && maxColors < paletteIndex.length) {
    paletteIndex = reducePalette(imageDataLike, paletteIndex, maxColors);
  }

  // 工作缓冲区（float，误差扩散用）
  const work = new Float64Array(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    work[i * 3] = data[i * 4];
    work[i * 3 + 1] = data[i * 4 + 1];
    work[i * 3 + 2] = data[i * 4 + 2];
  }

  const pattern = [];
  for (let y = 0; y < h; y++) pattern.push(new Array(w).fill(null));
  const counts = {};

  const kernel = DITHER_KERNELS[dither] || null;

  for (let y = 0; y < h; y++) {
    // 蛇形扫描，减轻误差扩散的方向性纹路
    const leftToRight = y % 2 === 0;
    for (let xi = 0; xi < w; xi++) {
      const x = leftToRight ? xi : w - 1 - xi;

      if (bgMask && bgMask[y] && bgMask[y][x]) continue; // 背景格，保持 null

      const o = (y * w + x) * 3;
      const r = Math.max(0, Math.min(255, work[o]));
      const g = Math.max(0, Math.min(255, work[o + 1]));
      const b = Math.max(0, Math.min(255, work[o + 2]));

      const idx = findNearestColor([r, g, b], paletteIndex, distanceMode);
      const entry = paletteIndex[idx];
      pattern[y][x] = entry.code;
      counts[entry.code] = (counts[entry.code] || 0) + 1;

      if (kernel && ditherStrength > 0) {
        const errR = (r - entry.rgb[0]) * ditherStrength;
        const errG = (g - entry.rgb[1]) * ditherStrength;
        const errB = (b - entry.rgb[2]) * ditherStrength;

        for (const { dx, dy, w: weight } of kernel) {
          const nx = leftToRight ? x + dx : x - dx;
          const ny = y + dy;
          if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
          if (bgMask && bgMask[ny] && bgMask[ny][nx]) continue;
          const no = (ny * w + nx) * 3;
          work[no] += errR * weight;
          work[no + 1] += errG * weight;
          work[no + 2] += errB * weight;
        }
      }
    }
  }

  if (despeckle) {
    despecklePattern(pattern, w, h);
  }

  return { pattern, counts, width: w, height: h, paletteUsed: paletteIndex };
}

/**
 * 去噪：如果一个格子的颜色和它上下左右四个邻居都不一样，
 * 但四个邻居里有 3 个或以上是同一种颜色，就把它合并成那个颜色。
 * 目的是清掉孤立的"杂色点"，让图纸看起来更干净、更像是手工设计的而不是算法噪点。
 * 只处理非背景格，背景格(null)不参与也不被覆盖。
 */
function despecklePattern(pattern, w, h) {
  const original = pattern.map((row) => row.slice());

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const here = original[y][x];
      if (here === null) continue;

      const neighbors = [];
      if (x > 0 && original[y][x - 1] !== null) neighbors.push(original[y][x - 1]);
      if (x < w - 1 && original[y][x + 1] !== null) neighbors.push(original[y][x + 1]);
      if (y > 0 && original[y - 1][x] !== null) neighbors.push(original[y - 1][x]);
      if (y < h - 1 && original[y + 1][x] !== null) neighbors.push(original[y + 1][x]);

      if (neighbors.length < 3) continue;
      if (neighbors.includes(here)) continue; // 跟至少一个邻居同色，不算孤立点

      const tally = {};
      for (const n of neighbors) tally[n] = (tally[n] || 0) + 1;
      let majorityColor = null;
      let majorityCount = 0;
      for (const [color, count] of Object.entries(tally)) {
        if (count > majorityCount) {
          majorityCount = count;
          majorityColor = color;
        }
      }
      if (majorityCount >= 3) {
        pattern[y][x] = majorityColor;
      }
    }
  }
}

/** 统计颜色用量，按数量从多到少排序，返回 [[code, count], ...] */
function sortCounts(counts) {
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}

// ============================================================
// 导出（UMD：Node require() 和浏览器 <script> 标签都能用）
// ============================================================

const PerlerCore = {
  rgbToLab,
  deltaE2000,
  buildPaletteIndex,
  findNearestColor,
  kmeansColors,
  reducePalette,
  estimateEdgeBackgroundColor,
  computeSolidBackgroundPixelMask,
  computeSolidBackgroundMask,
  computeBackgroundMask,
  detectContentBoundingBox,
  adjustImage,
  resizeAreaAverage,
  imageToPattern,
  despecklePattern,
  sortCounts,
};

if (typeof module === "object" && module.exports) {
  module.exports = PerlerCore;
} else {
  (typeof self !== "undefined" ? self : this).PerlerCore = PerlerCore;
}
