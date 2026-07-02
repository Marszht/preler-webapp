# Solid Background Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add automatic white/solid-color background removal based on edge sampling and edge-connected flood fill.

**Architecture:** Keep the image pipeline unchanged and replace only background mask generation when auto mode is selected. `lib/perlerCore.js` owns pixel-level detection and grid-mask conversion; `server.js` parses the mode and passes options; `public/index.html` and `public/app.js` expose the control.

**Tech Stack:** Node.js, Express, Jimp, vanilla browser JavaScript, built-in `assert` for verification.

---

### Task 1: Core Background Detection

**Files:**
- Modify: `lib/perlerCore.js`

- [x] **Step 1: Add helpers**

Add helpers near the background-recognition section:

```js
function colorDistanceSq(data, offset, rgb) {
  const dr = data[offset] - rgb[0];
  const dg = data[offset + 1] - rgb[1];
  const db = data[offset + 2] - rgb[2];
  return dr * dr + dg * dg + db * db;
}

function estimateEdgeBackgroundColor(srcImageData, useAlpha = true) {
  // Sample borders, quantize colors into coarse bins, return dominant average RGB.
}
```

- [x] **Step 2: Add flood-fill mask**

Implement `computeSolidBackgroundPixelMask(srcImageData, options)` that:

```js
const thresholdSq = bgThreshold * bgThreshold;
// Start from border pixels that match the sampled color or alpha background.
// Use a queue and 4-neighbor flood fill.
// Return { mask, width, height, bgColor }.
```

- [x] **Step 3: Convert pixel mask to grid mask**

Implement `pixelMaskToGridMask(pixelMask, srcWidth, srcHeight, gridW, gridH)` and count a grid cell as background when more than 50% of its pixels are marked.

- [x] **Step 4: Export auto-mask APIs**

Export `computeSolidBackgroundMask`, `computeSolidBackgroundPixelMask`, and `estimateEdgeBackgroundColor`.

### Task 2: Server and UI Wiring

**Files:**
- Modify: `server.js`
- Modify: `public/index.html`
- Modify: `public/app.js`

- [x] **Step 1: Parse mode on the server**

In `server.js`, read:

```js
const bgMode = body.bgMode === "manual" ? "manual" : "auto";
```

Use `computeSolidBackgroundMask` when `removeBg && bgMode === "auto"`, otherwise keep `computeBackgroundMask`.

- [x] **Step 2: Add UI mode selector**

In `public/index.html`, add a select inside background options:

```html
<select id="bgMode">
  <option value="auto" selected>自动识别纯色背景</option>
  <option value="manual">手动指定背景色</option>
</select>
```

Change default `bgColor` to `255,255,255` and default `bgThreshold` to `45`.

- [x] **Step 3: Submit mode from browser**

In `public/app.js`, append:

```js
formData.append("bgMode", document.getElementById("bgMode").value);
```

### Task 3: Verification

**Files:**
- Create: `scripts/verify-bg-removal.js`
- Modify: `package.json`

- [x] **Step 1: Add verification script**

Create a Node script that uses `assert` and synthetic image data to verify:

```js
const result = PerlerCore.computeSolidBackgroundMask(image, 5, 5, {
  bgThreshold: 45,
  useAlpha: true,
});
assert.strictEqual(result[0][0], true);
assert.strictEqual(result[2][2], false);
```

- [x] **Step 2: Add npm test command**

Set:

```json
"test": "node scripts/verify-bg-removal.js"
```

- [x] **Step 3: Run tests**

Run: `npm test`

Expected: all background-removal verification checks pass.
