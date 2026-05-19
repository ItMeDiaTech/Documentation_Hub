/**
 * Embedded image border detection and cropping.
 *
 * Screen-captured images often include the original document's visible border.
 * When the pipeline then applies its own border via borderAndCenterLargeImages(),
 * the result is a double-border. This module detects that embedded dark border
 * and crops it away so the pipeline's border sits cleanly against
 * the actual content.
 *
 * Uses the existing `canvas` package for pixel analysis and docxmlater's
 * Image.updateImageData() to replace the buffer in-place.
 */

import { createCanvas, loadImage } from "canvas";
import { Document, Image, ImageRun, Paragraph, Revision } from "docxmlater";

// ── Detection constants ──────────────────────────────────────────────
export const DARK_THRESHOLD = 80; // luminance <= this = border pixel
export const EDGE_CONSENSUS = 0.65; // 65 % of scan lines must detect border
export const MIN_BORDERED_EDGES = 4; // all 4 edges must have border pattern for cropping
// All 4 edges must show a border pattern before we skip the pipeline border.
// A 3-edge detection is an INCOMPLETE baked border (e.g. a screenshot whose top
// edge blends into surrounding content): such an image is neither cropped
// (cropping needs 4 edges) nor would it look correct without the pipeline
// border, so the pipeline border must still be applied.
export const MIN_BORDER_SKIP_EDGES = 4; // edges with border pattern → skip adding pipeline border
export const MAX_BORDER_THICKNESS = 4; // border line max 4 px
export const SAMPLE_INTERVAL = 5; // sample every 5th column / row
export const MAX_CROP_FRACTION = 0.20; // never crop > 20 % from one edge
export const MIN_DIMENSION_PX = 80; // skip images < 80 px
export const TRANSITION_DEPTH = 10; // check pixels at depth 4-10 for light transition
export const MAX_BORDER_ZONE = 16; // max depth to search for border pixels (must accommodate initial skip + border thickness)
export const MAX_INITIAL_SKIP = 20; // max non-dark pixels to skip at edge start (white padding before border)
export const MIN_POST_BORDER_NONDARK = 2; // consecutive non-dark pixels to confirm border ended
export const MAX_POSITION_SPREAD = 8; // max crop position variation across scan lines
export const MAX_BORDER_GAP = 3; // max consecutive non-dark pixels within a border (anti-aliasing tolerance)

export type Edge = "top" | "bottom" | "left" | "right";

// ── Public API ───────────────────────────────────────────────────────

export interface CropResult {
  croppedCount: number;
  skippedCount: number;
  errorCount: number;
  /** Images detected as having baked-in dark borders on all 4 sides. */
  allSideBakedBorderImages: Set<Image>;
  /** Images that had their embedded border cropped away and need a pipeline border. */
  croppedImages: Set<Image>;
  /** Images with Word crop — skipped analysis, need border check by caller */
  wordCroppedImages: Set<Image>;
}

interface CropRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface EdgeResult {
  detected: boolean;
  cropPosition: number;
  /** Number of scan lines that detected a border pattern. */
  sampleHits: number;
  /** Total number of scan lines sampled. */
  sampleCount: number;
  /** Max minus min crop position across detecting scan lines. -1 if not enough hits. */
  spread: number;
}

/**
 * Iterate every raster image in the document, detect embedded borders,
 * and crop them away.
 */
export async function cropEmbeddedImageBorders(
  doc: Document,
  log: { debug: Function; info: Function; warn: Function }
): Promise<CropResult> {
  const result: CropResult = { croppedCount: 0, skippedCount: 0, errorCount: 0, allSideBakedBorderImages: new Set(), croppedImages: new Set(), wordCroppedImages: new Set() };

  const images = collectImages(doc);
  log.debug(`Found ${images.length} images to analyse for embedded borders`);

  for (const image of images) {
    try {
      await processOneImage(image, result, log);
    } catch (err) {
      result.errorCount++;
      log.warn(
        `Error processing image for embedded border crop: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  return result;
}

/** Pixel-level check: are all 4 edges predominantly dark? */
export function pixelsHaveAllSideBakedBorder(
  pixels: Uint8ClampedArray,
  width: number,
  height: number
): boolean {
  const edges: Edge[] = ["top", "bottom", "left", "right"];
  for (const edge of edges) {
    if (!edgeIsDark(pixels, width, height, edge)) return false;
  }
  return true;
}

// ── Image collection ─────────────────────────────────────────────────

/**
 * Collect all Image elements from a single paragraph, including those
 * nested inside ImageRun and Revision containers.
 */
export function collectParagraphImages(para: Paragraph): Image[] {
  const images: Image[] = [];
  for (const item of para.getContent()) {
    if (item instanceof Image) {
      images.push(item);
    }
    if (item instanceof ImageRun) {
      images.push(item.getImageElement());
    }
    if (item instanceof Revision) {
      for (const revItem of item.getContent()) {
        if (revItem instanceof ImageRun) {
          images.push(revItem.getImageElement());
        }
      }
    }
  }
  return images;
}

function collectImages(doc: Document): Image[] {
  const images: Image[] = [];
  for (const para of doc.getAllParagraphs()) {
    images.push(...collectParagraphImages(para));
  }
  return images;
}

// ── Word crop helpers ─────────────────────────────────────────────────

function hasWordCrop(crop: { left: number; top: number; right: number; bottom: number } | undefined): boolean {
  return !!crop && (crop.left > 0 || crop.top > 0 || crop.right > 0 || crop.bottom > 0);
}

// ── Per-image processing ─────────────────────────────────────────────

async function processOneImage(
  image: Image,
  result: CropResult,
  log: { debug: Function; info: Function; warn: Function }
): Promise<void> {
  const ext = image.getExtension()?.toLowerCase();

  // Skip non-raster formats
  if (ext === "svg" || ext === "emf" || ext === "wmf") {
    result.skippedCount++;
    return;
  }

  const MAX_IMAGE_BUFFER_BYTES = 50 * 1024 * 1024; // 50 MB
  const buf = image.getImageDataSafe();
  if (!buf || buf.length === 0) {
    result.skippedCount++;
    return;
  }
  if (buf.length > MAX_IMAGE_BUFFER_BYTES) {
    result.skippedCount++;
    return;
  }

  // Word-cropped images: skip all analysis, caller handles border
  const wordCrop = image.getCrop?.();
  if (hasWordCrop(wordCrop)) {
    result.wordCroppedImages.add(image);
    return;
  }

  // Load into canvas to get full pixel data
  const img = await loadImage(buf);
  const w = img.width;
  const h = img.height;

  if (w < MIN_DIMENSION_PX || h < MIN_DIMENSION_PX) {
    result.skippedCount++;
    return;
  }

  const MAX_PIXEL_COUNT = 25_000_000;
  if (w * h > MAX_PIXEL_COUNT) {
    log.debug(`Skipping image: ${w}x${h} exceeds pixel budget`);
    result.skippedCount++;
    return;
  }

  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);

  const imageData = ctx.getImageData(0, 0, w, h);
  const analysisPixels = imageData.data;

  // Run crop detection
  const { cropRect, detectedEdges } = detectEmbeddedBorder(analysisPixels, w, h, log);

  if (!cropRect) {
    if (detectedEdges >= MIN_BORDER_SKIP_EDGES || pixelsHaveAllSideBakedBorder(analysisPixels, w, h)) {
      result.allSideBakedBorderImages.add(image);
      log.debug(
        `No crop needed: image has border on ${detectedEdges}/4 edges (>= ${MIN_BORDER_SKIP_EDGES} → skip pipeline border)`
      );
    }
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

  // Crop from the analysis canvas
  const cropCanvas = createCanvas(newW, newH);
  const cropCtx = cropCanvas.getContext("2d");
  cropCtx.drawImage(canvas, cropRect.left, cropRect.top, newW, newH, 0, 0, newW, newH);

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
    `Cropped embedded border: ${w}x${h} → ${newW}x${newH} (removed T:${cropRect.top} B:${cropRect.bottom} L:${cropRect.left} R:${cropRect.right})`
  );
  result.croppedCount++;
  result.croppedImages.add(image);
}

// ── Border detection ─────────────────────────────────────────────────

interface BorderDetectionResult {
  cropRect: CropRect | null;
  detectedEdges: number;
}

function detectEmbeddedBorder(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  log?: { debug: Function }
): BorderDetectionResult {
  const edges: Edge[] = ["top", "bottom", "left", "right"];
  const results: Record<Edge, EdgeResult> = {} as Record<Edge, EdgeResult>;
  let detectedCount = 0;

  for (const edge of edges) {
    results[edge] = analyzeEdge(pixels, width, height, edge);
    if (results[edge].detected) detectedCount++;
  }

  // Per-edge diagnostic summary
  if (log) {
    const parts = edges.map((e) => {
      const r = results[e];
      const pct = r.sampleCount > 0 ? Math.round((r.sampleHits / r.sampleCount) * 100) : 0;
      if (r.detected) return `${e}=${r.cropPosition}px(s:${r.spread},${pct}%)`;
      return `${e}=REJECT(s:${r.spread},${pct}%)`;
    });
    log.debug(
      `Edge crop [${width}x${height}]: ${parts.join(" ")} → ${detectedCount}/${edges.length} need ${MIN_BORDERED_EDGES}`
    );
  }

  if (detectedCount < MIN_BORDERED_EDGES) return { cropRect: null, detectedEdges: detectedCount };

  return {
    cropRect: {
      top: results.top.detected ? results.top.cropPosition : 0,
      bottom: results.bottom.detected ? results.bottom.cropPosition : 0,
      left: results.left.detected ? results.left.cropPosition : 0,
      right: results.right.detected ? results.right.cropPosition : 0,
    },
    detectedEdges: detectedCount,
  };
}

/**
 * Analyze one edge of the image for the border+gap pattern.
 *
 * Samples every SAMPLE_INTERVAL-th line perpendicular to the edge.
 * Each scan line looks inward for: dark border (1-4 px) then white gap (5-20 px).
 * Uses the median crop position from all detecting scan lines.
 */
function analyzeEdge(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  edge: Edge
): EdgeResult {
  const noResult: EdgeResult = { detected: false, cropPosition: 0, sampleHits: 0, sampleCount: 0, spread: -1 };
  const perpLength = edge === "top" || edge === "bottom" ? width : height;
  const sampleCount = Math.floor(perpLength / SAMPLE_INTERVAL);
  if (sampleCount === 0) return noResult;

  const cropPositions: number[] = [];

  for (let s = 0; s < sampleCount; s++) {
    const lineIndex = s * SAMPLE_INTERVAL;
    const pos = scanLine(pixels, width, height, edge, lineIndex);
    if (pos !== null) cropPositions.push(pos);
  }

  const needed = Math.ceil(sampleCount * EDGE_CONSENSUS);
  if (cropPositions.length < needed) {
    return { detected: false, cropPosition: 0, sampleHits: cropPositions.length, sampleCount, spread: -1 };
  }

  // Use median crop position (robust against corner artifacts)
  cropPositions.sort((a, b) => a - b);
  const median = cropPositions[Math.floor(cropPositions.length / 2)];

  // Reject if crop positions vary too much — genuine embedded borders are uniform,
  // content borders (like T_3.png) produce variable positions across scan lines
  const spread = cropPositions[cropPositions.length - 1] - cropPositions[0];
  if (spread > MAX_POSITION_SPREAD) {
    return { detected: false, cropPosition: 0, sampleHits: cropPositions.length, sampleCount, spread };
  }

  return { detected: true, cropPosition: median, sampleHits: cropPositions.length, sampleCount, spread };
}

/**
 * Check whether the outermost 1-MAX_BORDER_THICKNESS pixels of one edge
 * are predominantly dark AND transition to lighter content just beyond
 * the border zone (depth MAX_BORDER_THICKNESS to TRANSITION_DEPTH).
 *
 * The transition check prevents false positives on dark-themed screenshots
 * where the edge content itself is dark but is not a thin border line.
 */
export function edgeIsDark(pixels: Uint8ClampedArray, width: number, height: number, edge: Edge): boolean {
  const perpLength = edge === "top" || edge === "bottom" ? width : height;
  const depthDimension = edge === "top" || edge === "bottom" ? height : width;
  const sampleCount = Math.floor(perpLength / SAMPLE_INTERVAL);
  if (sampleCount === 0) return false;

  let darkWithTransitionCount = 0;
  for (let s = 0; s < sampleCount; s++) {
    const lineIndex = s * SAMPLE_INTERVAL;

    // Step 1: Check outer pixels (0..MAX_BORDER_THICKNESS-1) are dark
    let hasDarkEdge = false;
    for (let depth = 0; depth < MAX_BORDER_THICKNESS; depth++) {
      if (getPixelLuminance(pixels, width, height, edge, lineIndex, depth) <= DARK_THRESHOLD) {
        hasDarkEdge = true;
        break;
      }
    }
    if (!hasDarkEdge) continue;

    // Step 2: Check transition — pixels just beyond border zone should be lighter
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

/**
 * Scan one line from the given edge inward, looking for a border pattern.
 * Handles compound/anti-aliased borders where the outermost pixel(s)
 * may be white or mid-tone, and the border may consist of multiple dark
 * lines separated by small gaps (e.g., T_4.png has dark at depth 1 and 4).
 *
 * 4-phase algorithm:
 *   Phase 1:   Find first dark pixel within MAX_INITIAL_SKIP px from edge.
 *   Phase 2:   Scan border zone (MAX_BORDER_ZONE px anchored to first dark pixel).
 *   Phase 3:   Verify MIN_POST_BORDER_NONDARK consecutive non-dark pixels
 *              immediately after the last dark pixel (confirms border ended).
 *   Phase 4:   Return crop position at border edge (lastDarkDepth + 1).
 *
 * @returns crop position (just past the border line), or null
 */
export function scanLine(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  edge: Edge,
  lineIndex: number
): number | null {
  const depthDimension = edge === "top" || edge === "bottom" ? height : width;
  const maxDepth = Math.floor(depthDimension * MAX_CROP_FRACTION);

  // ── Phase 1: Find first dark pixel (skip initial white gap) ──
  let firstDarkDepth = -1;
  const skipLimit = Math.min(MAX_INITIAL_SKIP + 1, maxDepth);
  for (let depth = 0; depth < skipLimit; depth++) {
    if (getPixelLuminance(pixels, width, height, edge, lineIndex, depth) <= DARK_THRESHOLD) {
      firstDarkDepth = depth;
      break;
    }
  }
  if (firstDarkDepth === -1) return null; // no border pixels found within skip zone

  // ── Phase 2: Scan border zone anchored to firstDarkDepth ──
  // Stop scanning if we encounter a gap larger than MAX_BORDER_GAP consecutive
  // non-dark pixels — prevents reaching internal content borders (e.g., form
  // field borders, dropdown outlines) that happen to fall within MAX_BORDER_ZONE.
  let lastDarkDepth = firstDarkDepth;
  let darkCount = 1;
  let consecutiveNonDark = 0;
  const borderZoneEnd = Math.min(firstDarkDepth + MAX_BORDER_ZONE, maxDepth);
  for (let depth = firstDarkDepth + 1; depth < borderZoneEnd; depth++) {
    if (getPixelLuminance(pixels, width, height, edge, lineIndex, depth) <= DARK_THRESHOLD) {
      lastDarkDepth = depth;
      darkCount++;
      consecutiveNonDark = 0;
    } else {
      consecutiveNonDark++;
      if (consecutiveNonDark > MAX_BORDER_GAP) break;
    }
  }
  if (darkCount > MAX_BORDER_THICKNESS) return null; // too many dark pixels for a border

  // ── Phase 3: Verify border ended ─────────────────────────────────
  // Need MIN_POST_BORDER_NONDARK consecutive non-dark pixels after last dark
  let nondarkRun = 0;
  let borderEndConfirmed = false;
  for (let depth = lastDarkDepth + 1; depth < maxDepth; depth++) {
    const lum = getPixelLuminance(pixels, width, height, edge, lineIndex, depth);
    if (lum > DARK_THRESHOLD) {
      nondarkRun++;
      if (nondarkRun >= MIN_POST_BORDER_NONDARK) {
        borderEndConfirmed = true;
        break;
      }
    } else {
      return null; // more dark pixels beyond border zone — not a clean border
    }
  }
  if (!borderEndConfirmed) return null; // ran out of pixels before confirming border ended

  // ── Phase 4: Crop right after the border line ──
  // Previous approach scanned past whitespace to content, but content appears
  // at varying depths across scan lines (text, UI elements at different positions),
  // causing high spread that rejects valid borders. Cropping at the border edge
  // keeps positions consistent and preserves the image's internal padding.
  return lastDarkDepth + 1;
}

/**
 * Get luminance (0-255) for a pixel identified by edge, perpendicular line
 * index, and depth from the edge.
 */
export function getPixelLuminance(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  edge: Edge,
  lineIndex: number,
  depth: number
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
export function getLuminance(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}
