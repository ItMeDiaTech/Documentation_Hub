/**
 * VML → DrawingML image normalizer.
 *
 * Older Word documents (Word 97-2003, or images pasted from legacy apps)
 * embed pictures as VML inside <w:pict> elements:
 *
 *   <w:pict>
 *     <v:shape type="#_x0000_t75" style="width:496.5pt;height:245pt">
 *       <v:imagedata r:id="rId19"/>
 *     </v:shape>
 *   </w:pict>
 *
 * DocXMLater's paragraph-content API only exposes modern DrawingML pictures
 * (<w:drawing><a:blip r:embed="..."/>) as ImageRun/Image. VML pictures are
 * invisible to it — not even surfaced as PreservedElement — so the border /
 * center / crop pipeline never touches them.
 *
 * This helper rewrites each VML picture to an equivalent DrawingML inline
 * picture before the document is loaded, so the rest of the pipeline behaves
 * as if the image was always modern-format.
 *
 * Only <v:shape type="#_x0000_t75"> (predefined "picture") is converted.
 * VML lines, rectangles, ovals, text boxes, and shapes are left alone.
 */
import AdmZip from "adm-zip";

const EMU_PER_PT = 12700;
const EMU_PER_IN = 914400;
const EMU_PER_PX = 9525; // at 96 DPI
const EMU_PER_CM = 360000;
const EMU_PER_MM = 36000;

// docPr ids must be unique and fit in a 32-bit signed int. Seed high so we
// don't collide with existing ids (which are typically 1..~9-digit values).
const DOCPR_ID_SEED = 1_900_000_000;

export interface VmlNormalizationResult {
  buffer: Buffer;
  converted: number;
  modifiedParts: string[];
}

export function normalizeVmlImagesInBuffer(srcBuffer: Buffer): VmlNormalizationResult {
  const zip = new AdmZip(srcBuffer);
  let totalConverted = 0;
  let nextDocPrId = DOCPR_ID_SEED;
  const modifiedParts: string[] = [];

  for (const entry of zip.getEntries()) {
    const name = entry.entryName;
    if (!name.startsWith("word/")) continue;
    if (!name.toLowerCase().endsWith(".xml")) continue;
    if (name.includes("/_rels/")) continue;

    const original = entry.getData().toString("utf8");
    if (!original.includes("<w:pict") || !original.includes("<v:imagedata")) continue;

    const { xml: rewritten, converted, nextDocPrId: nextId } = convertVmlPictures(
      original,
      nextDocPrId
    );
    if (converted > 0) {
      zip.updateFile(name, Buffer.from(rewritten, "utf8"));
      totalConverted += converted;
      nextDocPrId = nextId;
      modifiedParts.push(name);
    }
  }

  return {
    buffer: totalConverted > 0 ? zip.toBuffer() : srcBuffer,
    converted: totalConverted,
    modifiedParts,
  };
}

interface ConvertResult {
  xml: string;
  converted: number;
  nextDocPrId: number;
}

export function convertVmlPictures(xml: string, startDocPrId: number): ConvertResult {
  let converted = 0;
  let nextId = startDocPrId;

  const rewritten = xml.replace(/<w:pict\b[^>]*>([\s\S]*?)<\/w:pict>/g, (match, inner) => {
    const shapeMatch = (inner as string).match(/<v:shape\b[^>]*>[\s\S]*?<\/v:shape>/);
    if (!shapeMatch) return match;
    const shapeXml = shapeMatch[0];

    // Only convert the predefined picture shape (`#_x0000_t75`).
    if (!/type="#_x0000_t75"/.test(shapeXml)) return match;

    const styleMatch = shapeXml.match(/\bstyle="([^"]*)"/);
    const dims = parseCssDimensions(styleMatch ? styleMatch[1] : "");
    if (!dims.cx || !dims.cy) return match;

    const imageDataMatch = shapeXml.match(/<v:imagedata\b[^>]*\br:id="([^"]+)"[^>]*\/?>/);
    if (!imageDataMatch) return match;
    const rId = imageDataMatch[1];

    const titleMatch = shapeXml.match(/<v:imagedata\b[^>]*\bo:title="([^"]*)"/);
    const altText = titleMatch ? titleMatch[1] : undefined;

    const docPrId = nextId++;
    converted++;
    return buildDrawingXml(rId, dims.cx, dims.cy, docPrId, altText);
  });

  return { xml: rewritten, converted, nextDocPrId: nextId };
}

interface CssDimensions {
  cx?: number;
  cy?: number;
}

export function parseCssDimensions(style: string): CssDimensions {
  const result: CssDimensions = {};
  const widthMatch = style.match(/(?:^|;)\s*width\s*:\s*([\d.]+)\s*(pt|in|px|cm|mm)?/i);
  const heightMatch = style.match(/(?:^|;)\s*height\s*:\s*([\d.]+)\s*(pt|in|px|cm|mm)?/i);
  if (widthMatch) result.cx = toEmu(parseFloat(widthMatch[1]), widthMatch[2] ?? "pt");
  if (heightMatch) result.cy = toEmu(parseFloat(heightMatch[1]), heightMatch[2] ?? "pt");
  return result;
}

function toEmu(value: number, unit: string): number {
  switch (unit.toLowerCase()) {
    case "pt":
      return Math.round(value * EMU_PER_PT);
    case "in":
      return Math.round(value * EMU_PER_IN);
    case "px":
      return Math.round(value * EMU_PER_PX);
    case "cm":
      return Math.round(value * EMU_PER_CM);
    case "mm":
      return Math.round(value * EMU_PER_MM);
    default:
      return Math.round(value * EMU_PER_PT);
  }
}

function buildDrawingXml(
  rId: string,
  cx: number,
  cy: number,
  docPrId: number,
  altText: string | undefined
): string {
  const safeAlt = altText ? escapeXmlAttr(altText) : "";
  const descrAttr = safeAlt ? ` descr="${safeAlt}"` : "";
  const name = `Picture ${docPrId}`;
  return (
    `<w:drawing>` +
    `<wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ` +
    `distT="0" distB="0" distL="0" distR="0">` +
    `<wp:extent cx="${cx}" cy="${cy}"/>` +
    `<wp:effectExtent l="0" t="0" r="0" b="0"/>` +
    `<wp:docPr id="${docPrId}" name="${name}"${descrAttr}/>` +
    `<wp:cNvGraphicFramePr>` +
    `<a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/>` +
    `</wp:cNvGraphicFramePr>` +
    `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">` +
    `<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:nvPicPr>` +
    `<pic:cNvPr id="0" name="${name}"${descrAttr}/>` +
    `<pic:cNvPicPr>` +
    `<a:picLocks noChangeAspect="1" noChangeArrowheads="1"/>` +
    `</pic:cNvPicPr>` +
    `</pic:nvPicPr>` +
    `<pic:blipFill>` +
    `<a:blip r:embed="${rId}"/>` +
    `<a:srcRect/>` +
    `<a:stretch><a:fillRect/></a:stretch>` +
    `</pic:blipFill>` +
    `<pic:spPr bwMode="auto">` +
    `<a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>` +
    `</pic:spPr>` +
    `</pic:pic>` +
    `</a:graphicData>` +
    `</a:graphic>` +
    `</wp:inline>` +
    `</w:drawing>`
  );
}

function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
