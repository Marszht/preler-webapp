/**
 * app.js —— 客户端逻辑
 * 用真实浏览器 canvas 渲染结果，PerlerRender.renderPattern 跟
 * Node 端、小程序端用的是完全同一份代码（只是这里的 ctx 来自浏览器原生 canvas）。
 */

let selectedFile = null;
let lastResult = null; // 缓存最近一次转换结果，方便调整 cellSize/showLabels 时重绘不用重新请求
let paletteMap = {}; // 色号 -> rgb 查表，渲染和统计表都要用
let imageAspectRatio = null; // 原图宽高比，用于宽高双向联动
let syncingGridSize = false;

// ---- 拉取色卡（用于渲染查表 + 统计表展示色块）----
fetch("/api/palette")
  .then((r) => r.json())
  .then(({ palette }) => {
    paletteMap = PerlerRender.paletteToMap(palette);
  });

// ============================================================
// 图片选择 / 拖拽
// ============================================================

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const previewImg = document.getElementById("previewImg");
const dropzoneHint = document.getElementById("dropzoneHint");
const convertBtn = document.getElementById("convertBtn");
const gridWInput = document.getElementById("gridW");
const gridHInput = document.getElementById("gridH");

fileInput.addEventListener("change", (e) => {
  if (e.target.files[0]) handleFile(e.target.files[0]);
});

["dragover", "dragleave", "drop"].forEach((evt) => {
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    if (evt === "dragover") dropzone.classList.add("dragover");
    if (evt === "dragleave" || evt === "drop") dropzone.classList.remove("dragover");
  });
});

dropzone.addEventListener("drop", (e) => {
  const file = e.dataTransfer.files[0];
  if (file) handleFile(file);
});

function handleFile(file) {
  if (!file.type.startsWith("image/")) {
    setStatus("请选择图片文件", true);
    return;
  }
  selectedFile = file;
  const url = URL.createObjectURL(file);
  convertBtn.disabled = true;
  previewImg.onload = () => {
    imageAspectRatio = previewImg.naturalWidth / previewImg.naturalHeight;
    updateGridSizeFrom("height");
    convertBtn.disabled = false;
    setStatus(
      `图片 ${previewImg.naturalWidth}×${previewImg.naturalHeight} · 网格 ${gridWInput.value}×${gridHInput.value}`
    );
    URL.revokeObjectURL(url);
  };
  previewImg.onerror = () => {
    selectedFile = null;
    imageAspectRatio = null;
    convertBtn.disabled = true;
    setStatus("图片读取失败，请换一张图片", true);
    URL.revokeObjectURL(url);
  };
  previewImg.src = url;
  previewImg.hidden = false;
  dropzoneHint.hidden = true;
  setStatus("");
}

// ============================================================
// 网格尺寸预设按钮
// ============================================================

document.querySelectorAll(".preset-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    gridHInput.value = btn.dataset.h;
    if (!updateGridSizeFrom("height")) gridWInput.value = btn.dataset.h;
    document.querySelectorAll(".preset-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
  });
});

function clampGridSize(value) {
  return Math.max(10, Math.min(200, value));
}

function updateGridSizeFrom(changedDimension) {
  if (!imageAspectRatio || syncingGridSize) return false;

  const sourceInput = changedDimension === "width" ? gridWInput : gridHInput;
  const sourceValue = parseInt(sourceInput.value, 10);
  if (Number.isNaN(sourceValue)) return false;

  syncingGridSize = true;
  let width;
  let height;

  if (changedDimension === "width") {
    width = clampGridSize(sourceValue);
    height = Math.round(width / imageAspectRatio);
    if (height > 200) {
      height = 200;
      width = Math.round(height * imageAspectRatio);
    }
    if (height < 10) {
      height = 10;
      width = Math.round(height * imageAspectRatio);
    }
  } else {
    height = clampGridSize(sourceValue);
    width = Math.round(height * imageAspectRatio);
    if (width > 200) {
      width = 200;
      height = Math.round(width / imageAspectRatio);
    }
    if (width < 10) {
      width = 10;
      height = Math.round(width / imageAspectRatio);
    }
  }

  gridWInput.value = clampGridSize(width);
  gridHInput.value = clampGridSize(height);
  syncingGridSize = false;
  return true;
}

gridWInput.addEventListener("input", () => updateGridSizeFrom("width"));
gridWInput.addEventListener("change", () => {
  if (!gridWInput.value) gridWInput.value = 60;
  updateGridSizeFrom("width");
});

gridHInput.addEventListener("input", () => updateGridSizeFrom("height"));
gridHInput.addEventListener("change", () => {
  if (!gridHInput.value) gridHInput.value = 60;
  updateGridSizeFrom("height");
});

// ============================================================
// 滑杆数值实时显示
// ============================================================

function bindRangeDisplay(rangeId, displayId, suffix = "") {
  const range = document.getElementById(rangeId);
  const display = document.getElementById(displayId);
  range.addEventListener("input", () => {
    display.textContent = range.value + suffix;
  });
}
bindRangeDisplay("ditherStrength", "ditherStrengthVal", "%");
bindRangeDisplay("brightness", "brightnessVal");
bindRangeDisplay("contrast", "contrastVal");
bindRangeDisplay("saturation", "saturationVal");

// ============================================================
// 背景选项的展开/收起
// ============================================================

const removeBgCheckbox = document.getElementById("removeBg");
const bgOptions = document.getElementById("bgOptions");
removeBgCheckbox.addEventListener("change", () => {
  bgOptions.hidden = !removeBgCheckbox.checked;
});

// ============================================================
// 提交转换请求
// ============================================================

convertBtn.addEventListener("click", async () => {
  if (!selectedFile) return;

  convertBtn.disabled = true;
  setStatus("正在转换…");

  const formData = new FormData();
  formData.append("image", selectedFile);
  formData.append("gridW", document.getElementById("gridW").value);
  formData.append("gridH", document.getElementById("gridH").value);
  formData.append("distanceMode", document.getElementById("distanceMode").value);
  formData.append("maxColors", document.getElementById("maxColors").value);
  formData.append("dither", document.getElementById("dither").value);
  formData.append("ditherStrength", document.getElementById("ditherStrength").value / 100);
  formData.append("despeckle", document.getElementById("despeckle").checked);
  formData.append("removeBg", removeBgCheckbox.checked);
  formData.append("bgMode", document.getElementById("bgMode").value);
  formData.append("useAlpha", document.getElementById("useAlpha").checked);
  formData.append("bgColor", document.getElementById("bgColor").value);
  formData.append("bgThreshold", document.getElementById("bgThreshold").value);
  formData.append("autoCrop", document.getElementById("autoCrop").checked);
  formData.append("brightness", document.getElementById("brightness").value);
  formData.append("contrast", document.getElementById("contrast").value);
  formData.append("saturation", document.getElementById("saturation").value);

  try {
    const res = await fetch("/api/convert", { method: "POST", body: formData });
    const data = await res.json();

    if (!res.ok) {
      setStatus(data.error || "转换失败", true);
      convertBtn.disabled = false;
      return;
    }

    lastResult = data;
    renderResult();
    renderStats();
    setStatus(`完成 · ${data.totalBeads} 颗豆 · ${data.colorCount} 种颜色`);
  } catch (err) {
    setStatus("网络错误: " + err.message, true);
  } finally {
    convertBtn.disabled = false;
  }
});

// ============================================================
// 渲染结果（用浏览器原生 canvas + perlerRender.js）
// ============================================================

const resultCanvas = document.getElementById("resultCanvas");
const canvasPlaceholder = document.getElementById("canvasPlaceholder");
const resultActions = document.getElementById("resultActions");
const statsBox = document.getElementById("stats");

function renderResult() {
  if (!lastResult) return;

  const cellSize = parseInt(document.getElementById("cellSize").value, 10) || 10;
  const showLabels = document.getElementById("showLabels").checked;

  resultCanvas.width = lastResult.width * cellSize;
  resultCanvas.height = lastResult.height * cellSize;
  const ctx = resultCanvas.getContext("2d");

  // 跟 Node / 小程序完全同一份渲染函数
  PerlerRender.renderPattern(ctx, lastResult.pattern, paletteMap, {
    cellSize,
    showLabels: showLabels && cellSize >= 8, // 格子太小文字会糊成一片，干脆不画
  });

  resultCanvas.hidden = false;
  canvasPlaceholder.hidden = true;
  resultActions.hidden = false;
}

document.getElementById("cellSize").addEventListener("input", renderResult);
document.getElementById("showLabels").addEventListener("change", renderResult);

document.getElementById("downloadBtn").addEventListener("click", () => {
  const link = document.createElement("a");
  link.download = "perler-pattern.png";
  link.href = resultCanvas.toDataURL("image/png");
  link.click();
});

// ============================================================
// 用色统计表
// ============================================================

function renderStats() {
  if (!lastResult) return;

  document.getElementById("statsSummary").innerHTML =
    `总用豆量 <b>${lastResult.totalBeads}</b> 颗　·　共 <b>${lastResult.colorCount}</b> 种颜色　·　` +
    `网格 <b>${lastResult.width}×${lastResult.height}</b>`;

  const grid = document.getElementById("statsGrid");
  grid.innerHTML = "";

  const groups = groupCountsByCode(lastResult.counts);
  for (const [group, entries] of groups) {
    const groupEl = document.createElement("section");
    groupEl.className = "bead-stat-group";

    const label = document.createElement("div");
    label.className = "bead-stat-group-label";
    label.textContent = group;

    const list = document.createElement("div");
    list.className = "bead-stat-list";

    for (const [code, count] of entries) {
      const rgb = paletteMap[code] || [200, 200, 200];
      const item = document.createElement("div");
      item.className = "bead-stat-item";
      item.setAttribute("aria-label", `${code} ${count} 颗`);

      const swatch = document.createElement("div");
      swatch.className = "bead-stat-swatch";
      swatch.style.background = `rgb(${rgb.join(",")})`;
      swatch.style.color = getReadableTextColor(rgb);
      swatch.textContent = code;

      const countEl = document.createElement("div");
      countEl.className = "bead-stat-count";
      countEl.textContent = `×${count}`;

      item.appendChild(swatch);
      item.appendChild(countEl);
      list.appendChild(item);
    }

    groupEl.appendChild(label);
    groupEl.appendChild(list);
    grid.appendChild(groupEl);
  }
  statsBox.hidden = false;
}

function groupCountsByCode(counts) {
  const sorted = counts.slice().sort(([codeA], [codeB]) => compareBeadCodes(codeA, codeB));
  const groups = new Map();
  for (const entry of sorted) {
    const group = getCodeGroup(entry[0]);
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(entry);
  }
  return groups;
}

function compareBeadCodes(codeA, codeB) {
  const a = parseBeadCode(codeA);
  const b = parseBeadCode(codeB);
  if (a.prefix !== b.prefix) return a.prefix.localeCompare(b.prefix, "en");
  if (a.number !== b.number) return a.number - b.number;
  return a.suffix.localeCompare(b.suffix, "en");
}

function parseBeadCode(code) {
  const match = String(code).match(/^([A-Za-z]+)(\d+)(.*)$/);
  if (!match) return { prefix: String(code), number: 0, suffix: "" };
  return {
    prefix: match[1].toUpperCase(),
    number: parseInt(match[2], 10),
    suffix: match[3] || "",
  };
}

function getCodeGroup(code) {
  const match = String(code).match(/^[A-Za-z]+/);
  return match ? match[0].toUpperCase() : "#";
}

function getReadableTextColor(rgb) {
  const luminance = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
  return luminance > 0.58 ? "#1f1b16" : "#ffffff";
}

// ============================================================
// 状态提示
// ============================================================

function setStatus(msg, isError = false) {
  const el = document.getElementById("statusLine");
  el.textContent = msg;
  el.classList.toggle("error", isError);
}
