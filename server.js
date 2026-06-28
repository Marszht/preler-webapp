/**
 * server.js
 * 拼豆底稿生成 —— 单页 Node 应用
 * ------------------------------------------------------------
 * 图片解码/缩放用 Jimp（纯 JS，无原生编译依赖，所以这个项目能在
 * 任何普通 Node 环境装上跑起来，不需要系统装图形库）。
 * 核心算法用 lib/perlerCore.js（零依赖，和小程序版是同一份代码）。
 * 渲染交给浏览器端的真实 canvas 去做（lib/perlerRender.js 直接复用）。
 */
const express = require("express");
const multer = require("multer");
const { Jimp } = require("jimp");

const PerlerCore = require("./lib/perlerCore");
const { MARD_221_PALETTE } = require("./lib/mardPalette");

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
});

app.use(express.static("public"));
app.use("/lib", express.static("lib")); // 让浏览器能直接 <script src="/lib/perlerCore.js">

// 把色卡也暴露给前端展示用
app.get("/api/palette", (req, res) => {
  res.json({ palette: MARD_221_PALETTE });
});

app.post("/api/convert", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "没有收到图片文件" });
    }

    const body = req.body;
    const gridW = clampInt(body.gridW, 10, 200, 60);
    const gridH = clampInt(body.gridH, 10, 200, 60);
    const distanceMode = body.distanceMode === "ciede2000" ? "ciede2000" : "lab";
    const dither = ["none", "floyd-steinberg", "atkinson"].includes(body.dither)
      ? body.dither
      : "floyd-steinberg";
    const ditherStrength = clampFloat(body.ditherStrength, 0, 1, 1);
    const maxColors = body.maxColors ? clampInt(body.maxColors, 2, 221, 24) : null;
    const despeckle = body.despeckle !== "false";
    const removeBg = body.removeBg === "true";
    const autoCrop = body.autoCrop === "true";
    const useAlpha = body.useAlpha !== "false";
    const bgColor = parseRgbString(body.bgColor, [0, 0, 0]);
    const bgThreshold = clampInt(body.bgThreshold, 0, 100, 12);
    const brightness = clampFloat(body.brightness, -100, 100, 0);
    const contrast = clampFloat(body.contrast, -100, 100, 0);
    const saturation = clampFloat(body.saturation, -100, 100, 0);

    // ---- 1. 用 Jimp 解码图片，拿到 RGBA 像素 ----
    const image = await Jimp.read(req.file.buffer);
    let srcImageData = jimpToImageData(image);

    // ---- 2. 自动裁切主体（可选）----
    if (autoCrop) {
      const bbox = PerlerCore.detectContentBoundingBox(srcImageData, {
        bgColor,
        bgThreshold,
        useAlpha,
        padding: 0.04,
      });
      if (bbox) {
        image.crop({
          x: bbox.x0,
          y: bbox.y0,
          w: bbox.x1 - bbox.x0,
          h: bbox.y1 - bbox.y0,
        });
        srcImageData = jimpToImageData(image);
      }
    }

    // ---- 3. 预处理：亮度/对比度/饱和度 ----
    if (brightness !== 0 || contrast !== 0 || saturation !== 0) {
      PerlerCore.adjustImage(srcImageData, { brightness, contrast, saturation });
    }

    // ---- 4. 缩放到目标格子数（用核心算法自带的区域平均缩放，效果稳定可控）----
    const smallImageData = PerlerCore.resizeAreaAverage(srcImageData, gridW, gridH);

    // ---- 5. 背景遮罩（可选）----
    let bgMask = null;
    if (removeBg) {
      bgMask = PerlerCore.computeBackgroundMask(smallImageData, gridW, gridH, {
        bgColor,
        bgThreshold,
        useAlpha,
      });
    }

    // ---- 6. 核心量化算法 ----
    const result = PerlerCore.imageToPattern(smallImageData, MARD_221_PALETTE, {
      distanceMode,
      dither,
      ditherStrength,
      maxColors,
      bgMask,
      despeckle,
    });

    const sortedCounts = PerlerCore.sortCounts(result.counts);
    const totalBeads = sortedCounts.reduce((sum, [, n]) => sum + n, 0);

    res.json({
      pattern: result.pattern,
      width: result.width,
      height: result.height,
      counts: sortedCounts,
      totalBeads,
      colorCount: sortedCounts.length,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "处理图片时出错: " + err.message });
  }
});

// ============================================================
// 工具函数
// ============================================================

/** Jimp 实例 -> perlerCore 需要的 {data, width, height} 格式（RGBA Uint8ClampedArray）*/
function jimpToImageData(image) {
  const { width, height } = image.bitmap;
  // Jimp v1 的 bitmap.data 已经是 RGBA 顺序的 Buffer，逐字节兼容 Uint8ClampedArray 语义
  const data = Uint8ClampedArray.from(image.bitmap.data);
  return { data, width, height };
}

function clampInt(val, min, max, fallback) {
  const n = parseInt(val, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function clampFloat(val, min, max, fallback) {
  const n = parseFloat(val);
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function parseRgbString(str, fallback) {
  if (!str) return fallback;
  const parts = str.split(",").map((s) => parseInt(s.trim(), 10));
  if (parts.length !== 3 || parts.some(Number.isNaN)) return fallback;
  return parts;
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`拼豆底稿生成器运行在 http://localhost:${PORT}`);
});
