/**
 * app.js —— 客户端逻辑
 * 用真实浏览器 canvas 渲染结果，PerlerRender.renderPattern 跟
 * Node 端、小程序端用的是完全同一份代码（只是这里的 ctx 来自浏览器原生 canvas）。
 */

let selectedFile = null;
let lastResult = null; // 缓存最近一次转换结果，方便调整 cellSize/showLabels 时重绘不用重新请求
let paletteMap = {}; // 色号 -> rgb 查表，渲染和统计表都要用

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
  previewImg.src = url;
  previewImg.hidden = false;
  dropzoneHint.hidden = true;
  convertBtn.disabled = false;
  setStatus("");
}

// ============================================================
// 网格尺寸预设按钮
// ============================================================

document.querySelectorAll(".preset-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.getElementById("gridW").value = btn.dataset.w;
    document.getElementById("gridH").value = btn.dataset.h;
    document.querySelectorAll(".preset-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
  });
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

  const tbody = document.getElementById("statsBody");
  tbody.innerHTML = "";
  for (const [code, count] of lastResult.counts) {
    const rgb = paletteMap[code] || [200, 200, 200];
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${code}</td>
      <td><span class="swatch" style="background: rgb(${rgb.join(",")})"></span></td>
      <td>${count}</td>
    `;
    tbody.appendChild(tr);
  }
  statsBox.hidden = false;
}

// ============================================================
// 状态提示
// ============================================================

function setStatus(msg, isError = false) {
  const el = document.getElementById("statusLine");
  el.textContent = msg;
  el.classList.toggle("error", isError);
}
