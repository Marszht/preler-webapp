const assert = require("assert");
const PerlerCore = require("../lib/perlerCore");

function makeImage(width, height, rgba) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = rgba[0];
    data[i * 4 + 1] = rgba[1];
    data[i * 4 + 2] = rgba[2];
    data[i * 4 + 3] = rgba[3];
  }
  return { data, width, height };
}

function setPixel(image, x, y, rgba) {
  const o = (y * image.width + x) * 4;
  image.data[o] = rgba[0];
  image.data[o + 1] = rgba[1];
  image.data[o + 2] = rgba[2];
  image.data[o + 3] = rgba[3];
}

function setRect(image, x0, y0, x1, y1, rgba) {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      setPixel(image, x, y, rgba);
    }
  }
}

function testWhiteBackground() {
  const image = makeImage(5, 5, [255, 255, 255, 255]);
  setRect(image, 1, 1, 3, 3, [20, 90, 220, 255]);

  const mask = PerlerCore.computeSolidBackgroundMask(image, 5, 5, {
    bgThreshold: 45,
    useAlpha: true,
  });

  assert.strictEqual(mask[0][0], true, "edge white background should be removed");
  assert.strictEqual(mask[2][2], false, "blue subject should be preserved");
}

function testDisconnectedWhiteInterior() {
  const image = makeImage(7, 7, [255, 255, 255, 255]);
  for (let x = 2; x <= 4; x++) {
    setPixel(image, x, 2, [0, 0, 0, 255]);
    setPixel(image, x, 4, [0, 0, 0, 255]);
  }
  for (let y = 2; y <= 4; y++) {
    setPixel(image, 2, y, [0, 0, 0, 255]);
    setPixel(image, 4, y, [0, 0, 0, 255]);
  }

  const mask = PerlerCore.computeSolidBackgroundMask(image, 7, 7, {
    bgThreshold: 45,
    useAlpha: true,
  });

  assert.strictEqual(mask[0][0], true, "outer white background should be removed");
  assert.strictEqual(mask[3][3], false, "white detail inside a closed subject should stay");
}

function testTransparentPixels() {
  const image = makeImage(3, 3, [200, 0, 0, 255]);
  setPixel(image, 1, 1, [200, 0, 0, 0]);

  const mask = PerlerCore.computeSolidBackgroundMask(image, 3, 3, {
    bgThreshold: 45,
    useAlpha: true,
  });

  assert.strictEqual(mask[1][1], true, "transparent pixels should remain background");
}

function testManualBackgroundMask() {
  const image = makeImage(4, 4, [0, 180, 255, 255]);
  setRect(image, 1, 1, 2, 2, [240, 40, 40, 255]);

  const mask = PerlerCore.computeBackgroundMask(image, 4, 4, {
    bgColor: [0, 180, 255],
    bgThreshold: 30,
    useAlpha: true,
  });

  assert.strictEqual(mask[0][0], true, "manual cyan background should be removed");
  assert.strictEqual(mask[1][1], false, "manual foreground should be preserved");
}

testWhiteBackground();
testDisconnectedWhiteInterior();
testTransparentPixels();
testManualBackgroundMask();

console.log("Background removal verification passed.");
