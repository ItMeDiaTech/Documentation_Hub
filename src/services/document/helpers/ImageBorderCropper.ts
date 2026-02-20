/**
 * Embedded image border detection and cropping.
 *
 * Screen-captured images often include the original document's visible border.
 * When the pipeline then applies its own border via borderAndCenterLargeImages(),
 * the result is a double-border. This module detects that embedded dark border
 * (+ white gap) and crops it away so the pipeline's border sits cleanly against
 * the actual content.
 *
 * Uses the existing `canvas` package for pixel analysis and docxmlater's
 * Image.updateImageData() to replace the buffer in-place.
 */

import { createCanvas, loadImage } from "canvas";
import { Document, Image, ImageRun, Revision } from "docxmlater";

// ── Detection constants ──────────────────────────────────────────────
const DARK_THRESHOLD = 80;        // luminance <= this = border pixel
const LIGHT_THRESHOLD = 230;      // luminance >= this = gap/padding pixel
const EDGE_CONSENSUS = 0.65;      // 65 % of scan lines must detect border
const MIN_BORDERED_EDGES = 3;     // at least 3 of 4 edges
const MAX_BORDER_THICKNESS = 4;   // border line max 4 px
const MIN_GAP_THICKNESS = 2;      // white gap at least 2 px
const MAX_SCAN_DEPTH = 25;        // scan max 25 px from edge
const SAMPLE_INTERVAL = 5;        // sample every 5th column / row
const MAX_CROP_FRACTION = 0.15;   // never crop > 15 % from one edge
const MIN_DIMENSION_PX = 80;      // skip images < 80 px

const EMUS_PER_PIXEL = 9525;

type Edge = "top" | "bottom" | "left" | "right";

// ── Public API ───────────────────────────────────────────────────────

export interface CropResult {
  croppedCount: number;
  skippedCount: number;
  errorCount: number;
}

interface CropRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

interface EdgeResult {
  detected: boolean;
  cropPosition: number;
}

/**
 * Iterate every raster image in the document, detect embedded borders,
 * and crop them away.
 */
export async function cropEmbeddedImageBorders(
  doc: Document,
  log: { debug: Function; info: Function; warn: Function },
): Promise<CropResult> {
  const result: CropResult = { croppedCount: 0, skippedCount: 0, errorCount: 0 };

  const images = collectImages(doc);
  log.debug(`Found ${images.length} images to analyse for embedded borders`);

  for (const image of images) {
    try {
      await processOneImage(image, result, log);
    } catch (err) {
      result.errorCount++;
      log.warn(
        `Error processing image for embedded border crop: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return result;
}

// ── Image collection ─────────────────────────────────────────────────

function collectImages(doc: Document): Image[] {
  const images: Image[] = [];
  for (const para of doc.getAllParagraphs()) {
    for (const item of para.getContent()) {
      if (item instanceof Image) {
        images.push(item);
      }
      if (item instanceof ImageRun) {
        images.push(item.getImageElement());
      }
      if (item instanceof Revision) {
        for (const run of item.getRuns()) {
          if (run instanceof ImageRun) {
            images.push(run.getImageElement());
          }
        }
      }
    }
  }
  return images;
}

// ── Per-image processing ─────────────────────────────────────────────

async function processOneImage(
  image: Image,
  result: CropResult,
  log: { debug: Function; info: Function; warn: Function },
): Promise<void> {
  const ext = image.getExtension()?.toLowerCase();

  // Skip non-raster formats
  if (ext === "svg" || ext === "emf" || ext === "wmf") {
    result.skippedCount++;
    return;
  }

  const buf = image.getImageDataSafe();
  if (!buf || buf.length === 0) {
    result.skippedCount++;
    return;
  }

  // Load into canvas to get pixel data
  const img = await loadImage(buf);
  const w = img.width;
  const h = img.height;

  if (w < MIN_DIMENSION_PX || h < MIN_DIMENSION_PX) {
    result.skippedCount++;
    return;
  }

  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, w, h);
  const pixels = imageData.data; // Uint8ClampedArray [r,g,b,a, ...]

  const cropRect = detectEmbeddedBorder(pixels, w, h);
  if (!cropRect) {
    result.skippedCount++;
    return;
  }

  // Validate: never crop more than MAX_CROP_FRACTION from any edge
  if (
    cropRect.top > h * MAX_CROP_FRACTION ||
    cropRect.bottom > h * MAX_CROP_FRACTION ||
    cropRect.left > w * MAX_CROP_FRACTION ||
    cropRect.right > w * MAX_CROP_FRACTION
  ) {
    log.debug(`Skipping image: crop exceeds ${MAX_CROP_FRACTION * 100}% on an edge`);
    result.skippedCount++;
    return;
  }

  // Validate minimum remaining dimensions
  const newW = w - cropRect.left - cropRect.right;
  const newH = h - cropRect.top - cropRect.bottom;
  if (newW < MIN_DIMENSION_PX || newH < MIN_DIMENSION_PX) {
    log.debug(`Skipping image: cropped dimensions ${newW}x${newH} too small`);
    result.skippedCount++;
    return;
  }

  // Crop via canvas
  const cropCanvas = createCanvas(newW, newH);
  const cropCtx = cropCanvas.getContext("2d");
  cropCtx.drawImage(
    canvas,
    cropRect.left,
    cropRect.top,
    newW,
    newH,
    0,
    0,
    newW,
    newH,
  );

  // Preserve format: JPEG for JPEG inputs, PNG otherwise
  const isJpeg = ext === "jpeg" || ext === "jpg";
  const croppedBuffer = isJpeg
    ? cropCanvas.toBuffer("image/jpeg", { quality: 0.92 })
    : cropCanvas.toBuffer("image/png");

  // Replace image data
  await image.updateImageData(croppedBuffer);

  // Update display dimensions proportionally
  const origWidthEMU = image.getWidth();
  const origHeightEMU = image.getHeight();
  const newWidthEMU = Math.round(origWidthEMU * (newW / w));
  const newHeightEMU = Math.round(origHeightEMU * (newH / h));
  image.setSize(newWidthEMU, newHeightEMU);

  log.debug(
    `Cropped embedded border: ${w}x${h} → ${newW}x${newH} (removed T:${cropRect.top} B:${cropRect.bottom} L:${cropRect.left} R:${cropRect.right})`,
  );
  result.croppedCount++;
}

// ── Border detection ─────────────────────────────────────────────────

function detectEmbeddedBorder(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): CropRect | null {
  const edges: Edge[] = ["top", "bottom", "left", "right"];
  const results: Record<Edge, EdgeResult> = {} as Record<Edge, EdgeResult>;
  let detectedCount = 0;

  for (const edge of edges) {
    results[edge] = analyzeEdge(pixels, width, height, edge);
    if (results[edge].detected) detectedCount++;
  }

  if (detectedCount < MIN_BORDERED_EDGES) return null;

  return {
    top: results.top.detected ? results.top.cropPosition : 0,
    bottom: results.bottom.detected ? results.bottom.cropPosition : 0,
    left: results.left.detected ? results.left.cropPosition : 0,
    right: results.right.detected ? results.right.cropPosition : 0,
  };
}

/**
 * Analyze one edge of the image for the border+gap pattern.
 *
 * Samples every SAMPLE_INTERVAL-th line perpendicular to the edge.
 * Each scan line looks inward for: dark border (1-4 px) then white gap (2-20 px).
 * Uses the median crop position from all detecting scan lines.
 */
function analyzeEdge(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  edge: Edge,
): EdgeResult {
  const perpLength = edge === "top" || edge === "bottom" ? width : height;
  const sampleCount = Math.floor(perpLength / SAMPLE_INTERVAL);
  if (sampleCount === 0) return { detected: false, cropPosition: 0 };

  const cropPositions: number[] = [];

  for (let s = 0; s < sampleCount; s++) {
    const lineIndex = s * SAMPLE_INTERVAL;
    const pos = scanLine(pixels, width, height, edge, lineIndex);
    if (pos !== null) cropPositions.push(pos);
  }

  const needed = Math.ceil(sampleCount * EDGE_CONSENSUS);
  if (cropPositions.length < needed) {
    return { detected: false, cropPosition: 0 };
  }

  // Use median crop position (robust against corner artifacts)
  cropPositions.sort((a, b) => a - b);
  const median = cropPositions[Math.floor(cropPositions.length / 2)];

  return { detected: true, cropPosition: median };
}

/**
 * Scan one line from the given edge inward, looking for the
 * dark-border + white-gap pattern.
 *
 * @returns crop position (pixels from edge) where content starts, or null
 */
function scanLine(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  edge: Edge,
  lineIndex: number,
): number | null {
  const maxDepth = MAX_SCAN_DEPTH;
  let borderPixels = 0;
  let gapPixels = 0;
  let inBorder = true;

  for (let depth = 0; depth < maxDepth; depth++) {
    const lum = getPixelLuminance(pixels, width, height, edge, lineIndex, depth);

    if (inBorder) {
      if (lum <= DARK_THRESHOLD) {
        borderPixels++;
        if (borderPixels > MAX_BORDER_THICKNESS) return null; // too thick for a border
      } else if (borderPixels > 0 && lum >= LIGHT_THRESHOLD) {
        // Transition: dark → light (border ended, gap started)
        inBorder = false;
        gapPixels = 1;
      } else if (borderPixels === 0 && lum >= LIGHT_THRESHOLD) {
        // No dark border found at all — not a border pattern
        return null;
      } else {
        // Mid-tone pixel before finding border — not a clean border
        if (borderPixels === 0) return null;
        // After some border pixels, a mid-tone could be anti-aliasing; keep scanning
        borderPixels++;
        if (borderPixels > MAX_BORDER_THICKNESS) return null;
      }
    } else {
      // In gap region
      if (lum >= LIGHT_THRESHOLD) {
        gapPixels++;
      } else {
        // Hit non-light pixel — gap ended, content starts
        if (gapPixels >= MIN_GAP_THICKNESS) {
          return depth; // content starts here
        }
        return null; // gap too thin
      }
    }
  }

  // Reached max scan depth while still in gap — content starts just past gap
  if (!inBorder && gapPixels >= MIN_GAP_THICKNESS) {
    return borderPixels + gapPixels;
  }

  return null;
}

/**
 * Get luminance (0-255) for a pixel identified by edge, perpendicular line
 * index, and depth from the edge.
 */
function getPixelLuminance(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  edge: Edge,
  lineIndex: number,
  depth: number,
): number {
  let x: number;
  let y: number;

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

  // Clamp to image bounds
  x = Math.min(Math.max(x, 0), width - 1);
  y = Math.min(Math.max(y, 0), height - 1);

  const idx = (y * width + x) * 4;
  const r = pixels[idx];
  const g = pixels[idx + 1];
  const b = pixels[idx + 2];
  return getLuminance(r, g, b);
}

/** Standard perceived luminance (ITU-R BT.601). */
function getLuminance(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}
