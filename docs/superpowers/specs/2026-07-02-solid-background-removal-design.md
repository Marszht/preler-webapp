# Solid Background Removal Design

## Goal

Improve background removal for white and solid-color images without adding paid services or machine-learning dependencies. The first version should handle clean product images, logos, illustrations, and simple photos on mostly uniform backgrounds.

## Scope

This version targets white, gray, and other solid or near-solid backgrounds. It does not try to match remove.bg-level subject segmentation for hair, fur, transparent objects, or complex natural scenes.

## Approach

Add an automatic solid-background mode to the existing background mask flow.

1. Sample pixels from the four corners and outer image edges.
2. Estimate the dominant background color from those edge samples.
3. Run flood fill from image borders and mark only edge-connected pixels whose color is close to the estimated background.
4. Convert the flood-filled pixel mask into the existing grid-level `bgMask`.

This improves on the current global color threshold because similar colors inside the subject are preserved unless they connect to the image edge.

## User Controls

Keep the existing remove-background checkbox and tolerance input. When background removal is enabled, default to automatic solid-background detection. The tolerance remains user-adjustable; a default around `45` is better for white or light solid backgrounds than the current conservative value.

Manual background color can remain as a fallback for unusual solid backgrounds if automatic sampling is wrong.

## Data Flow

The server decodes the uploaded image with Jimp, applies optional crop and adjustments, then computes a background mask before quantizing colors. The new algorithm should live in `lib/perlerCore.js` and return the same `true = background` grid mask shape used by `imageToPattern`.

## Error Handling

If edge sampling cannot produce a usable color, fall back to the current manual `bgColor` and `bgThreshold` behavior. Transparent PNG pixels should continue to count as background.

## Testing

Add focused Node-level tests or a small verification script for:

- White background with a non-white subject.
- Subject containing white interior details that should not be removed.
- Transparent PNG input still treated as background.
- Manual fallback still works for a configured background color.
