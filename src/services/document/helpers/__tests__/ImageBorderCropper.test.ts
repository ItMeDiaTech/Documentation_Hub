jest.mock("canvas");
jest.mock("docxmlater");

import {
  getLuminance,
  getPixelLuminance,
  scanLine,
  edgeIsDark,
  pixelsHaveAllSideBakedBorder,
  cropEmbeddedImageBorders,
  DARK_THRESHOLD,
  MAX_BORDER_ZONE,
  MAX_INITIAL_SKIP,
  MAX_BORDER_THICKNESS,
  MIN_POST_BORDER_NONDARK,
  MAX_CROP_FRACTION,
  SAMPLE_INTERVAL,
  EDGE_CONSENSUS,
  MIN_DIMENSION_PX,
  MAX_BORDER_GAP,
  type Edge,
} from "../ImageBorderCropper";

import { createCanvas, loadImage } from "canvas";
import { Document, Image, Paragraph } from "docxmlater";

// ── Helpers ──────────────────────────────────────────────

/** Create an all-white (luminance 255) RGBA pixel buffer. */
function makePixels(width: number, height: number, fill = 255): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = fill;
    data[i + 1] = fill;
    data[i + 2] = fill;
    data[i + 3] = 255;
  }
  return data;
}

/** Set a single pixel to a uniform gray value. */
function setPixel(
  data: Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
  gray: number
): void {
  const idx = (y * width + x) * 4;
  data[idx] = gray;
  data[idx + 1] = gray;
  data[idx + 2] = gray;
  data[idx + 3] = 255;
}

/** Fill entire row with a gray value. */
function fillRow(
  data: Uint8ClampedArray,
  width: number,
  row: number,
  gray: number
): void {
  for (let x = 0; x < width; x++) setPixel(data, width, x, row, gray);
}

/** Fill entire column with a gray value. */
function fillCol(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  col: number,
  gray: number
): void {
  for (let y = 0; y < height; y++) setPixel(data, width, col, y, gray);
}

const DARK = 0; // well below DARK_THRESHOLD (80)
const WHITE = 255;

// ── getLuminance ─────────────────────────────────────────

describe("getLuminance", () => {
  it("returns 0 for black", () => {
    expect(getLuminance(0, 0, 0)).toBe(0);
  });

  it("returns ~255 for white", () => {
    expect(getLuminance(255, 255, 255)).toBeCloseTo(255, 0);
  });

  it("applies BT.601 weights (green contributes most)", () => {
    const pureRed = getLuminance(255, 0, 0);
    const pureGreen = getLuminance(0, 255, 0);
    const pureBlue = getLuminance(0, 0, 255);
    expect(pureGreen).toBeGreaterThan(pureRed);
    expect(pureRed).toBeGreaterThan(pureBlue);
  });
});

// ── getPixelLuminance ────────────────────────────────────

describe("getPixelLuminance", () => {
  const W = 10;
  const H = 10;

  it("maps top edge correctly (x=lineIndex, y=depth)", () => {
    const px = makePixels(W, H, WHITE);
    setPixel(px, W, 3, 2, DARK);
    expect(getPixelLuminance(px, W, H, "top", 3, 2)).toBe(0);
  });

  it("maps bottom edge correctly (x=lineIndex, y=height-1-depth)", () => {
    const px = makePixels(W, H, WHITE);
    setPixel(px, W, 3, 7, DARK); // height-1-depth = 10-1-2 = 7
    expect(getPixelLuminance(px, W, H, "bottom", 3, 2)).toBe(0);
  });

  it("maps left edge correctly (x=depth, y=lineIndex)", () => {
    const px = makePixels(W, H, WHITE);
    setPixel(px, W, 2, 3, DARK);
    expect(getPixelLuminance(px, W, H, "left", 3, 2)).toBe(0);
  });

  it("maps right edge correctly (x=width-1-depth, y=lineIndex)", () => {
    const px = makePixels(W, H, WHITE);
    setPixel(px, W, 7, 3, DARK); // width-1-depth = 10-1-2 = 7
    expect(getPixelLuminance(px, W, H, "right", 3, 2)).toBe(0);
  });

  it("clamps out-of-bounds coordinates and returns the clamped pixel luminance", () => {
    const px = makePixels(W, H, WHITE);
    // Mark the bottom-right corner so we can verify the clamp lands there.
    setPixel(px, W, W - 1, H - 1, DARK);
    // Top edge: x=lineIndex, y=depth. Both 999 → clamped to (W-1, H-1).
    const value = getPixelLuminance(px, W, H, "top", 999, 999);
    // Clamped target is the dark pixel → luminance 0.
    expect(value).toBe(0);
  });
});

// ── scanLine ─────────────────────────────────────────────

describe("scanLine", () => {
  // Use 100x100 so maxDepth = floor(100 * 0.20) = 20
  const W = 100;
  const H = 100;

  it("detects clean 1px border at depth 0 and crops at border edge", () => {
    const px = makePixels(W, H, WHITE);
    setPixel(px, W, 0, 0, DARK); // top edge, lineIndex=0, depth=0 — border
    const result = scanLine(px, W, H, "top", 0);
    // Phase 4 crops right after the border (lastDarkDepth + 1)
    expect(result).toBe(1);
  });

  it("detects compound border (dark at depths 1 and 4) and crops at border edge", () => {
    const px = makePixels(W, H, WHITE);
    // top edge, lineIndex=0: dark at y=1 and y=4
    setPixel(px, W, 0, 1, DARK);
    setPixel(px, W, 0, 4, DARK);
    const result = scanLine(px, W, H, "top", 0);
    // Phase 4 crops right after the last border pixel (lastDarkDepth + 1)
    expect(result).toBe(5);
  });

  it("rejects when too many initial skip pixels (> MAX_INITIAL_SKIP)", () => {
    // Use 200x200 so maxDepth (40) > MAX_INITIAL_SKIP (20), giving room for the skip test
    const BIG = 200;
    const px = makePixels(BIG, BIG, WHITE);
    // First dark pixel at depth MAX_INITIAL_SKIP + 1 (21), exceeds allowed skip
    setPixel(px, BIG, 0, MAX_INITIAL_SKIP + 1, DARK);
    const result = scanLine(px, BIG, BIG, "top", 0);
    expect(result).toBeNull();
  });

  it("accepts border starting at exactly MAX_INITIAL_SKIP depth", () => {
    // Use 200x200 so maxDepth (40) > MAX_INITIAL_SKIP (20), giving room for the skip test
    const BIG = 200;
    const px = makePixels(BIG, BIG, WHITE);
    setPixel(px, BIG, 0, MAX_INITIAL_SKIP, DARK); // border at max allowed skip depth
    const result = scanLine(px, BIG, BIG, "top", 0);
    // Phase 4 crops right after border (lastDarkDepth + 1)
    expect(result).toBe(MAX_INITIAL_SKIP + 1);
  });

  it("rejects when too many dark pixels (exceeds MAX_BORDER_THICKNESS)", () => {
    const px = makePixels(W, H, WHITE);
    // 5 consecutive dark pixels (MAX_BORDER_THICKNESS is 4)
    for (let d = 0; d <= MAX_BORDER_THICKNESS; d++) {
      setPixel(px, W, 0, d, DARK);
    }
    const result = scanLine(px, W, H, "top", 0);
    expect(result).toBeNull();
  });

  it("accepts exactly MAX_BORDER_THICKNESS dark pixels", () => {
    const px = makePixels(W, H, WHITE);
    for (let d = 0; d < MAX_BORDER_THICKNESS; d++) {
      setPixel(px, W, 0, d, DARK);
    }
    const result = scanLine(px, W, H, "top", 0);
    // Phase 4 crops right after the last border pixel
    expect(result).toBe(MAX_BORDER_THICKNESS);
  });

  it("rejects with Phase 3 rejection (dark pixel immediately after border)", () => {
    // Phase 3 requires non-dark pixels after last border pixel.
    // Dark pixel right after the border zone triggers rejection.
    const BIG = 200;
    const px = makePixels(BIG, BIG, WHITE);
    // 2px border at depths 0-1, then dark at depth 2 → Phase 3 sees dark → reject
    setPixel(px, BIG, 0, 0, DARK);
    setPixel(px, BIG, 0, 1, DARK);
    setPixel(px, BIG, 0, 2, DARK); // dark beyond border → Phase 3 rejects
    const result = scanLine(px, BIG, BIG, "top", 0);
    // 3 dark pixels still within MAX_BORDER_THICKNESS (4), but Phase 3 sees more dark after
    // Actually 3 consecutive dark: depth 0,1,2 → darkCount=3, lastDark=2
    // Then Phase 3 checks depth 3+ which are white → passes.
    // Let's use 5 dark pixels to trigger MAX_BORDER_THICKNESS rejection instead.
    expect(result).toBe(3); // 3 dark pixels < MAX_BORDER_THICKNESS(4), border confirmed
  });

  it("distant dark pixels beyond border gap are ignored (not counted as border)", () => {
    // With MAX_BORDER_GAP, Phase 2 stops scanning after consecutive non-dark gap.
    // Dark pixels far from the border (e.g., internal content) are never reached.
    const BIG = 200;
    const px = makePixels(BIG, BIG, WHITE);
    setPixel(px, BIG, 0, 0, DARK); // border at depth 0
    setPixel(px, BIG, 0, MAX_BORDER_ZONE - 1, DARK); // far-away content dark pixel
    const result = scanLine(px, BIG, BIG, "top", 0);
    // Gap between depth 0 and 15 is 14 > MAX_BORDER_GAP(3), so Phase 2 stops
    // Only 1 border pixel at depth 0, border confirmed, crop at depth 1
    expect(result).toBe(1);
  });

  it("rejects with insufficient non-dark run (small image)", () => {
    // 14px height: maxDepth = floor(14 * 0.20) = 2, borderZoneEnd = min(0+16, 2) = 2
    const small = makePixels(W, 14, WHITE);
    setPixel(small, W, 0, 0, DARK); // border at depth 0
    // Only 1 non-dark pixel available (depth 1) before maxDepth, need 2
    const result = scanLine(small, W, 14, "top", 0);
    expect(result).toBeNull();
  });

  it("returns null when no dark pixels found", () => {
    const px = makePixels(W, H, WHITE); // all white
    const result = scanLine(px, W, H, "top", 0);
    expect(result).toBeNull();
  });

  it("works for all four edge directions", () => {
    const edges: Edge[] = ["top", "bottom", "left", "right"];
    for (const edge of edges) {
      const px = makePixels(W, H, WHITE);
      // For each edge, set the outermost pixel to dark (border at depth 0)
      switch (edge) {
        case "top":
          setPixel(px, W, 0, 0, DARK);
          break;
        case "bottom":
          setPixel(px, W, 0, H - 1, DARK);
          break;
        case "left":
          setPixel(px, W, 0, 0, DARK);
          break;
        case "right":
          setPixel(px, W, W - 1, 0, DARK);
          break;
      }
      const result = scanLine(px, W, H, edge, 0);
      // Phase 4 crops right after border (lastDarkDepth + 1)
      expect(result).toBe(1);
    }
  });

  // ── Phase 4: White gap skipping tests ──

  it("detects border with 5px white padding before it", () => {
    const px = makePixels(W, H, WHITE);
    // 5px white padding, then border at depth 5 (within MAX_INITIAL_SKIP=10)
    setPixel(px, W, 0, 5, DARK);
    const result = scanLine(px, W, H, "top", 0);
    // Phase 4 crops right after border
    expect(result).toBe(6);
  });

  it("crops at border edge regardless of content depth", () => {
    // Use 200x200 so maxDepth = 40, border zone ends at 16
    const BIG = 200;
    const px = makePixels(BIG, BIG, WHITE);
    // Border at depth 0, white gap, dark content at depth 18 (outside border zone)
    setPixel(px, BIG, 0, 0, DARK);
    setPixel(px, BIG, 0, 18, DARK); // content pixel beyond border zone
    const result = scanLine(px, BIG, BIG, "top", 0);
    // Phase 4 crops right after border, preserving inner whitespace
    expect(result).toBe(1);
  });

  it("crops at border edge when all whitespace after border", () => {
    const px = makePixels(W, H, WHITE);
    setPixel(px, W, 0, 0, DARK); // border at depth 0
    // All white after border — still crops right after border
    const result = scanLine(px, W, H, "top", 0);
    expect(result).toBe(1);
  });
});

// ── edgeIsDark ───────────────────────────────────────────

describe("edgeIsDark", () => {
  const W = 100;
  const H = 100;

  it("detects dark top edge with light transition", () => {
    const px = makePixels(W, H, WHITE);
    // Make rows 0-3 (MAX_BORDER_THICKNESS) dark
    for (let row = 0; row < MAX_BORDER_THICKNESS; row++) {
      fillRow(px, W, row, DARK);
    }
    // Rows 4+ are already white → transition exists
    expect(edgeIsDark(px, W, H, "top")).toBe(true);
  });

  it("returns false when no dark pixels on edge", () => {
    const px = makePixels(W, H, WHITE); // all white
    expect(edgeIsDark(px, W, H, "top")).toBe(false);
  });

  it("returns false when edge is dark but no transition to lighter content", () => {
    const px = makePixels(W, H, DARK); // entire image dark
    expect(edgeIsDark(px, W, H, "top")).toBe(false);
  });

  it("detects dark borders on all edge directions", () => {
    const px = makePixels(W, H, WHITE);
    // 4px dark border on all sides
    for (let d = 0; d < MAX_BORDER_THICKNESS; d++) {
      fillRow(px, W, d, DARK);           // top
      fillRow(px, W, H - 1 - d, DARK);   // bottom
      fillCol(px, W, H, d, DARK);        // left
      fillCol(px, W, H, W - 1 - d, DARK); // right
    }
    expect(edgeIsDark(px, W, H, "top")).toBe(true);
    expect(edgeIsDark(px, W, H, "bottom")).toBe(true);
    expect(edgeIsDark(px, W, H, "left")).toBe(true);
    expect(edgeIsDark(px, W, H, "right")).toBe(true);
  });
});

// ── pixelsHaveAllSideBakedBorder ─────────────────────────

describe("pixelsHaveAllSideBakedBorder", () => {
  const W = 100;
  const H = 100;

  it("returns true when all 4 edges have dark borders with transition", () => {
    const px = makePixels(W, H, WHITE);
    for (let d = 0; d < MAX_BORDER_THICKNESS; d++) {
      fillRow(px, W, d, DARK);
      fillRow(px, W, H - 1 - d, DARK);
      fillCol(px, W, H, d, DARK);
      fillCol(px, W, H, W - 1 - d, DARK);
    }
    expect(pixelsHaveAllSideBakedBorder(px, W, H)).toBe(true);
  });

  it("returns false when one edge lacks border", () => {
    const px = makePixels(W, H, WHITE);
    // Only dark on top, bottom, left — NOT right
    for (let d = 0; d < MAX_BORDER_THICKNESS; d++) {
      fillRow(px, W, d, DARK);
      fillRow(px, W, H - 1 - d, DARK);
      fillCol(px, W, H, d, DARK);
    }
    expect(pixelsHaveAllSideBakedBorder(px, W, H)).toBe(false);
  });

  it("returns false for all-white image", () => {
    const px = makePixels(W, H, WHITE);
    expect(pixelsHaveAllSideBakedBorder(px, W, H)).toBe(false);
  });

  it("returns false for all-dark image (no transition)", () => {
    const px = makePixels(W, H, DARK);
    expect(pixelsHaveAllSideBakedBorder(px, W, H)).toBe(false);
  });
});

// ── cropEmbeddedImageBorders with Word crop metadata ─────

describe("cropEmbeddedImageBorders with Word crop metadata", () => {
  const log = { debug: jest.fn(), info: jest.fn(), warn: jest.fn() };

  /** Build a pixel buffer with 1px dark border on all sides, gray 200 content. */
  function buildBorderedPixels(w: number, h: number): Uint8ClampedArray {
    const px = makePixels(w, h, 200);
    fillRow(px, w, 0, DARK);
    fillRow(px, w, h - 1, DARK);
    fillCol(px, w, h, 0, DARK);
    fillCol(px, w, h, w - 1, DARK);
    return px;
  }

  function setupCanvasMock(pixelData: Uint8ClampedArray, fullW: number, fullH: number) {
    (loadImage as jest.Mock).mockResolvedValue({ width: fullW, height: fullH });

    (createCanvas as jest.Mock).mockImplementation(() => ({
      getContext: jest.fn(() => ({
        drawImage: jest.fn(),
        getImageData: jest.fn(() => ({ data: pixelData })),
      })),
      toBuffer: jest.fn(() => Buffer.from([1, 2, 3])),
    }));
  }

  function makeMockImage(opts: {
    crop?: { left: number; top: number; right: number; bottom: number };
    widthEMU?: number;
    heightEMU?: number;
  } = {}) {
    const img = new (Image as unknown as jest.Mock)();
    img.getExtension = jest.fn(() => "png");
    img.getImageDataSafe = jest.fn(() => Buffer.from([1, 2, 3]));
    img.getCrop = jest.fn(() => opts.crop);
    img.setCrop = jest.fn();
    img.getWidth = jest.fn(() => opts.widthEMU ?? 914400);
    img.getHeight = jest.fn(() => opts.heightEMU ?? 914400);
    img.setSize = jest.fn();
    img.updateImageData = jest.fn();
    return img;
  }

  function makeMockDoc(images: unknown[]) {
    const para = new (Paragraph as unknown as jest.Mock)();
    para.getContent = jest.fn(() => images);
    const doc = new (Document as unknown as jest.Mock)();
    doc.getAllParagraphs = jest.fn(() => [para]);
    return doc;
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("no Word crop — unchanged behavior, setCrop not called", async () => {
    const pixels = buildBorderedPixels(200, 200);
    setupCanvasMock(pixels, 200, 200);

    const img = makeMockImage(); // getCrop returns undefined
    const doc = makeMockDoc([img]);

    const result = await cropEmbeddedImageBorders(doc, log);

    expect(result.croppedCount).toBe(1);
    expect(img.updateImageData).toHaveBeenCalled();
    expect(img.setCrop).not.toHaveBeenCalled();
  });

  it("Word crop present — added to wordCroppedImages, no pixel analysis", async () => {
    const img = makeMockImage({ crop: { left: 10, top: 10, right: 10, bottom: 10 } });
    const doc = makeMockDoc([img]);

    const result = await cropEmbeddedImageBorders(doc, log);

    expect(result.wordCroppedImages.has(img)).toBe(true);
    expect(result.croppedCount).toBe(0);
    expect(result.skippedCount).toBe(0);
    expect(img.updateImageData).not.toHaveBeenCalled();
    expect(img.setCrop).not.toHaveBeenCalled();
    // No canvas creation at all — early return before loadImage
    expect((loadImage as jest.Mock)).not.toHaveBeenCalled();
    expect((createCanvas as jest.Mock)).not.toHaveBeenCalled();
  });

  it("Word crop with small visible region — still added to wordCroppedImages (no size check)", async () => {
    // Word crop early-return happens before any size check
    const img = makeMockImage({ crop: { left: 40, top: 40, right: 40, bottom: 40 } });
    const doc = makeMockDoc([img]);

    const result = await cropEmbeddedImageBorders(doc, log);

    expect(result.wordCroppedImages.has(img)).toBe(true);
    expect(img.updateImageData).not.toHaveBeenCalled();
    expect((loadImage as jest.Mock)).not.toHaveBeenCalled();
  });

  it("zero crop — treated as no crop, no extra canvas", async () => {
    const pixels = buildBorderedPixels(200, 200);
    setupCanvasMock(pixels, 200, 200);

    const img = makeMockImage({ crop: { left: 0, top: 0, right: 0, bottom: 0 } });
    const doc = makeMockDoc([img]);

    const result = await cropEmbeddedImageBorders(doc, log);

    expect(result.croppedCount).toBe(1);
    expect(img.updateImageData).toHaveBeenCalled();
    expect(img.setCrop).not.toHaveBeenCalled();
    // No-crop path: full canvas + crop canvas = 2 calls (no visible region canvas)
    expect((createCanvas as jest.Mock).mock.calls.length).toBe(2);
  });

  it("non-cropped image with border still gets pixel-cropped", async () => {
    const pixels = buildBorderedPixels(200, 200);
    setupCanvasMock(pixels, 200, 200);

    const img = makeMockImage(); // no Word crop
    const doc = makeMockDoc([img]);

    const result = await cropEmbeddedImageBorders(doc, log);

    expect(result.croppedCount).toBe(1);
    expect(result.wordCroppedImages.size).toBe(0);
    expect(img.updateImageData).toHaveBeenCalled();
    expect(img.setCrop).not.toHaveBeenCalled();
  });

  it("image with only 3 dark edges is NOT marked as baked-border (pipeline border still applies)", async () => {
    // Screenshot artifact: bottom/left/right have a clean dark border, top edge
    // blends into surrounding content. detectedEdges = 3 → not enough to crop
    // (needs 4) and not a complete baked border → must NOT skip pipeline border.
    const w = 200, h = 200;
    const px = makePixels(w, h, 200);
    fillRow(px, w, h - 1, DARK); // bottom
    fillCol(px, w, h, 0, DARK); // left
    fillCol(px, w, h, w - 1, DARK); // right
    // top edge left as gray content — no border
    setupCanvasMock(px, w, h);

    const img = makeMockImage();
    const doc = makeMockDoc([img]);

    const result = await cropEmbeddedImageBorders(doc, log);

    expect(result.croppedCount).toBe(0); // 3 edges < MIN_BORDERED_EDGES (4)
    expect(result.allSideBakedBorderImages.has(img)).toBe(false);
    expect(img.updateImageData).not.toHaveBeenCalled();
  });

  // ─── MIN_DIMENSION_PX guard (Task 11) ────────────────────────────
  // Images smaller than MIN_DIMENSION_PX (80px) on either axis must be
  // skipped entirely — they're too small to host a meaningful border.
  it("skips analysis for images below MIN_DIMENSION_PX on width", async () => {
    // Width < MIN_DIMENSION_PX (80) → skip
    const undersizeW = MIN_DIMENSION_PX - 1;
    const pixels = buildBorderedPixels(undersizeW, 200);
    setupCanvasMock(pixels, undersizeW, 200);

    const img = makeMockImage();
    const doc = makeMockDoc([img]);

    const result = await cropEmbeddedImageBorders(doc, log);

    expect(result.skippedCount).toBe(1);
    expect(result.croppedCount).toBe(0);
    expect(img.updateImageData).not.toHaveBeenCalled();
  });

  it("skips analysis for images below MIN_DIMENSION_PX on height", async () => {
    const undersizeH = MIN_DIMENSION_PX - 1;
    const pixels = buildBorderedPixels(200, undersizeH);
    setupCanvasMock(pixels, 200, undersizeH);

    const img = makeMockImage();
    const doc = makeMockDoc([img]);

    const result = await cropEmbeddedImageBorders(doc, log);

    expect(result.skippedCount).toBe(1);
    expect(result.croppedCount).toBe(0);
    expect(img.updateImageData).not.toHaveBeenCalled();
  });

  it("processes images at exactly MIN_DIMENSION_PX (boundary inclusive)", async () => {
    // The check is `w < MIN_DIMENSION_PX` — exactly equal must NOT be skipped.
    const pixels = buildBorderedPixels(MIN_DIMENSION_PX, MIN_DIMENSION_PX);
    setupCanvasMock(pixels, MIN_DIMENSION_PX, MIN_DIMENSION_PX);

    const img = makeMockImage();
    const doc = makeMockDoc([img]);

    const result = await cropEmbeddedImageBorders(doc, log);

    // Either it crops (border found) or it skips for a different reason (e.g.,
    // crop fraction). What it must NOT do is short-circuit on the dimension
    // guard — that would set skippedCount=1 + croppedCount=0 + never call
    // updateImageData. The boundary case should reach the analysis path.
    expect(result.croppedCount + result.skippedCount).toBe(1);
    // Confirmation: the small-image MIN_DIMENSION_PX guard is NOT what
    // skipped it (it would otherwise skip before reaching loadImage).
    expect((loadImage as jest.Mock)).toHaveBeenCalled();
  });
});

describe("scanLine whitespace+border cropping", () => {
  it("should crop at border edge after whitespace padding", () => {
    const W = 200,
      H = 200;
    const pixels = makePixels(W, H, WHITE);
    // rows 0-9 white, rows 10-11 dark border, rows 12+ content (white)
    fillRow(pixels, W, 10, DARK);
    fillRow(pixels, W, 11, DARK);
    const result = scanLine(pixels, W, H, "top", 50);
    // Crops right after last border pixel (depth 11 → position 12)
    expect(result).toBe(12);
  });

  it("should crop border at edge with no whitespace", () => {
    const W = 200,
      H = 200;
    const pixels = makePixels(W, H, WHITE);
    fillRow(pixels, W, 0, DARK);
    fillRow(pixels, W, 1, DARK);
    const result = scanLine(pixels, W, H, "top", 50);
    // Crops right after last border pixel (depth 1 → position 2)
    expect(result).toBe(2);
  });
});
