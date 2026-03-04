/**
 * Standalone script to test ImageBorderCropper logic on T.png → Test.png
 * Uses the same algorithm and constants as ImageBorderCropper.ts
 */
import { createCanvas, loadImage } from "canvas";
import { readFileSync, writeFileSync } from "fs";

// ── Constants (mirrored from ImageBorderCropper.ts) ──
const DARK_THRESHOLD = 80;
const LIGHT_THRESHOLD = 230;
const EDGE_CONSENSUS = 0.65;
const MIN_BORDERED_EDGES = 3;
const MAX_BORDER_THICKNESS = 4;
const MIN_GAP_THICKNESS = 5;
const SAMPLE_INTERVAL = 5;
const MAX_CROP_FRACTION = 0.15;
const MIN_DIMENSION_PX = 80;
const TRANSITION_DEPTH = 10;

function getLuminance(r, g, b) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function getPixelLuminance(pixels, width, height, edge, lineIndex, depth) {
  let x, y;
  switch (edge) {
    case "top":
      x = lineIndex;
      y = depth;
      break;
    case "bottom":
      x = lineIndex;
      y = height - 1 - depth;
      break;
    case "left":
      x = depth;
      y = lineIndex;
      break;
    case "right":
      x = width - 1 - depth;
      y = lineIndex;
      break;
  }
  x = Math.min(Math.max(x, 0), width - 1);
  y = Math.min(Math.max(y, 0), height - 1);
  const idx = (y * width + x) * 4;
  return getLuminance(pixels[idx], pixels[idx + 1], pixels[idx + 2]);
}

function scanLine(pixels, width, height, edge, lineIndex) {
  const depthDimension = edge === "top" || edge === "bottom" ? height : width;
  const maxDepth = Math.floor(depthDimension * MAX_CROP_FRACTION);
  let borderPixels = 0;
  let gapPixels = 0;
  let inBorder = true;

  for (let depth = 0; depth < maxDepth; depth++) {
    const lum = getPixelLuminance(pixels, width, height, edge, lineIndex, depth);

    if (inBorder) {
      if (lum <= DARK_THRESHOLD) {
        borderPixels++;
        if (borderPixels > MAX_BORDER_THICKNESS) return null;
      } else if (borderPixels > 0 && lum >= LIGHT_THRESHOLD) {
        inBorder = false;
        gapPixels = 1;
      } else if (borderPixels === 0 && lum >= LIGHT_THRESHOLD) {
        return null;
      } else {
        if (borderPixels === 0) return null;
        borderPixels++;
        if (borderPixels > MAX_BORDER_THICKNESS) return null;
      }
    } else {
      if (lum >= LIGHT_THRESHOLD) {
        gapPixels++;
      } else {
        if (gapPixels >= MIN_GAP_THICKNESS) return depth;
        return null;
      }
    }
  }

  if (!inBorder && gapPixels >= MIN_GAP_THICKNESS) {
    return maxDepth;
  }
  return null;
}

function edgeIsDark(pixels, width, height, edge) {
  const perpLength = edge === "top" || edge === "bottom" ? width : height;
  const depthDimension = edge === "top" || edge === "bottom" ? height : width;
  const sampleCount = Math.floor(perpLength / SAMPLE_INTERVAL);
  if (sampleCount === 0) return false;

  let darkWithTransitionCount = 0;
  for (let s = 0; s < sampleCount; s++) {
    const lineIndex = s * SAMPLE_INTERVAL;

    let hasDarkEdge = false;
    for (let depth = 0; depth < MAX_BORDER_THICKNESS; depth++) {
      if (getPixelLuminance(pixels, width, height, edge, lineIndex, depth) <= DARK_THRESHOLD) {
        hasDarkEdge = true;
        break;
      }
    }
    if (!hasDarkEdge) continue;

    let hasTransition = false;
    const maxCheck = Math.min(TRANSITION_DEPTH, depthDimension - 1);
    for (let depth = MAX_BORDER_THICKNESS; depth <= maxCheck; depth++) {
      if (getPixelLuminance(pixels, width, height, edge, lineIndex, depth) > DARK_THRESHOLD) {
        hasTransition = true;
        break;
      }
    }
    if (hasTransition) darkWithTransitionCount++;
  }
  return darkWithTransitionCount >= Math.ceil(sampleCount * EDGE_CONSENSUS);
}

function pixelsHaveAllSideBakedBorder(pixels, width, height) {
  const edges = ["top", "bottom", "left", "right"];
  for (const edge of edges) {
    if (!edgeIsDark(pixels, width, height, edge)) return false;
  }
  return true;
}

function analyzeEdge(pixels, width, height, edge) {
  const perpLength = edge === "top" || edge === "bottom" ? width : height;
  const sampleCount = Math.floor(perpLength / SAMPLE_INTERVAL);
  if (sampleCount === 0) return { detected: false, cropPosition: 0 };

  const cropPositions = [];
  for (let s = 0; s < sampleCount; s++) {
    const lineIndex = s * SAMPLE_INTERVAL;
    const pos = scanLine(pixels, width, height, edge, lineIndex);
    if (pos !== null) cropPositions.push(pos);
  }

  const needed = Math.ceil(sampleCount * EDGE_CONSENSUS);
  console.log(
    `  ${edge}: ${cropPositions.length}/${sampleCount} scan lines detected (need ${needed}), positions: [${cropPositions.slice(0, 10).join(", ")}${cropPositions.length > 10 ? "..." : ""}]`
  );

  if (cropPositions.length < needed) {
    return { detected: false, cropPosition: 0 };
  }

  cropPositions.sort((a, b) => a - b);
  const median = cropPositions[Math.floor(cropPositions.length / 2)];
  const min = cropPositions[0];
  const max = cropPositions[cropPositions.length - 1];
  console.log(`  ${edge}: median=${median}px, range=[${min}, ${max}]`);

  return { detected: true, cropPosition: median };
}

async function main() {
  const inputFile = process.argv[2] || "T.png";
  console.log(`Input: ${inputFile}`);
  const buf = readFileSync(inputFile);
  const img = await loadImage(buf);
  const w = img.width;
  const h = img.height;
  console.log(`Image: ${w}x${h}`);
  console.log(
    `Max scan depth: top/bottom=${Math.floor(h * MAX_CROP_FRACTION)}px, left/right=${Math.floor(w * MAX_CROP_FRACTION)}px`
  );

  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const pixels = ctx.getImageData(0, 0, w, h).data;

  const edges = ["top", "bottom", "left", "right"];
  const results = {};
  let detectedCount = 0;

  const allSideBaked = pixelsHaveAllSideBakedBorder(pixels, w, h);
  console.log(`\nAll-side baked border: ${allSideBaked}`);

  console.log("\nEdge analysis:");
  for (const edge of edges) {
    results[edge] = analyzeEdge(pixels, w, h, edge);
    if (results[edge].detected) detectedCount++;
  }

  console.log(`\nDetected edges: ${detectedCount}/${edges.length} (need ${MIN_BORDERED_EDGES})`);

  if (detectedCount < MIN_BORDERED_EDGES) {
    console.log("Not enough edges detected — no crop applied.");
    return;
  }

  const cropRect = {
    top: results.top.detected ? results.top.cropPosition : 0,
    bottom: results.bottom.detected ? results.bottom.cropPosition : 0,
    left: results.left.detected ? results.left.cropPosition : 0,
    right: results.right.detected ? results.right.cropPosition : 0,
  };

  // Validate MAX_CROP_FRACTION
  if (
    cropRect.top > h * MAX_CROP_FRACTION ||
    cropRect.bottom > h * MAX_CROP_FRACTION ||
    cropRect.left > w * MAX_CROP_FRACTION ||
    cropRect.right > w * MAX_CROP_FRACTION
  ) {
    console.log("Crop exceeds MAX_CROP_FRACTION — skipping.");
    return;
  }

  const newW = w - cropRect.left - cropRect.right;
  const newH = h - cropRect.top - cropRect.bottom;

  if (newW < MIN_DIMENSION_PX || newH < MIN_DIMENSION_PX) {
    console.log(`Cropped dimensions ${newW}x${newH} too small — skipping.`);
    return;
  }

  console.log(
    `\nCrop: T:${cropRect.top} B:${cropRect.bottom} L:${cropRect.left} R:${cropRect.right}`
  );
  console.log(`Result: ${w}x${h} → ${newW}x${newH}`);

  const cropCanvas = createCanvas(newW, newH);
  const cropCtx = cropCanvas.getContext("2d");
  cropCtx.drawImage(canvas, cropRect.left, cropRect.top, newW, newH, 0, 0, newW, newH);

  const outBuf = cropCanvas.toBuffer("image/png");
  writeFileSync("Test.png", outBuf);
  console.log(`Saved to Test.png (${outBuf.length} bytes)`);
}

main().catch(console.error);
