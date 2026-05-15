/**
 * @jest-environment node
 *
 * Tests for src/services/document/helpers/vmlImageNormalizer.ts
 *
 * Uses `node` env (not jsdom) because AdmZip binary buffer round-trips
 * are sensitive to jsdom's Buffer polyfill.
 *
 * Covers:
 *   - Conversion of <w:pict><v:shape type="#_x0000_t75"> to <w:drawing>
 *   - Preservation of r:id as r:embed
 *   - CSS dimension parsing (pt, in, px, cm, mm)
 *   - Non-picture VML shapes (lines, rectangles) left alone
 *   - VML without <v:imagedata> left alone
 *   - VML without style left alone (can't determine size)
 *   - Buffer-level normalization through AdmZip
 */
import AdmZip from "adm-zip";
import {
  convertVmlPictures,
  normalizeVmlImagesInBuffer,
  parseCssDimensions,
} from "../vmlImageNormalizer";

describe("parseCssDimensions", () => {
  it("parses pt units", () => {
    const { cx, cy } = parseCssDimensions("width:496.5pt;height:245pt");
    expect(cx).toBe(Math.round(496.5 * 12700));
    expect(cy).toBe(Math.round(245 * 12700));
  });

  it("parses in units", () => {
    const { cx, cy } = parseCssDimensions("width:6in;height:4in");
    expect(cx).toBe(6 * 914400);
    expect(cy).toBe(4 * 914400);
  });

  it("parses px units (96 DPI)", () => {
    const { cx, cy } = parseCssDimensions("width:96px;height:48px");
    expect(cx).toBe(96 * 9525);
    expect(cy).toBe(48 * 9525);
  });

  it("parses cm and mm units", () => {
    expect(parseCssDimensions("width:2cm").cx).toBe(720000);
    expect(parseCssDimensions("height:10mm").cy).toBe(360000);
  });

  it("defaults to pt when unit is missing", () => {
    const { cx } = parseCssDimensions("width:100");
    expect(cx).toBe(100 * 12700);
  });

  it("returns undefined for unparseable input", () => {
    expect(parseCssDimensions("").cx).toBeUndefined();
    expect(parseCssDimensions("color:red").cx).toBeUndefined();
  });
});

describe("convertVmlPictures", () => {
  const baseVml = (rId: string, style: string, title?: string) =>
    `<w:pict><v:shape id="_x0000_i1096" type="#_x0000_t75" style="${style}"><v:imagedata r:id="${rId}"${title ? ` o:title="${title}"` : ""}/></v:shape></w:pict>`;

  it("converts a single VML picture to DrawingML", () => {
    const input = baseVml("rId19", "width:496.5pt;height:245pt");
    const { xml, converted, nextDocPrId } = convertVmlPictures(input, 1000);
    expect(converted).toBe(1);
    expect(nextDocPrId).toBe(1001);
    expect(xml).toContain("<w:drawing>");
    expect(xml).toContain('r:embed="rId19"');
    expect(xml).toContain(`cx="${Math.round(496.5 * 12700)}"`);
    expect(xml).toContain(`cy="${Math.round(245 * 12700)}"`);
    expect(xml).not.toContain("<w:pict");
    expect(xml).not.toContain("<v:imagedata");
  });

  it("propagates alt text from o:title into descr", () => {
    const input = baseVml("rId19", "width:100pt;height:50pt", "queues");
    const { xml } = convertVmlPictures(input, 1000);
    expect(xml).toContain('descr="queues"');
  });

  it("escapes special characters in alt text", () => {
    // Title chars that are legal inside an XML attribute value but need
    // re-escaping when they reach our generated descr=".." attribute.
    const input = baseVml("rId19", "width:100pt;height:50pt", "a&amp;b&lt;c");
    const { xml } = convertVmlPictures(input, 1000);
    // & in the captured title is re-escaped, even if it was already an entity.
    expect(xml).toContain('descr="a&amp;amp;b&amp;lt;c"');
  });

  it("converts multiple pictures and assigns unique docPr ids", () => {
    const input =
      baseVml("rId10", "width:100pt;height:50pt") +
      baseVml("rId20", "width:200pt;height:100pt");
    const { xml, converted, nextDocPrId } = convertVmlPictures(input, 5000);
    expect(converted).toBe(2);
    expect(nextDocPrId).toBe(5002);
    expect(xml).toContain('id="5000"');
    expect(xml).toContain('id="5001"');
  });

  it("leaves <v:shape> with a non-picture type alone", () => {
    const input = `<w:pict><v:shape type="#_x0000_t202" style="width:100pt;height:50pt"><v:textbox/></v:shape></w:pict>`;
    const { xml, converted } = convertVmlPictures(input, 1000);
    expect(converted).toBe(0);
    expect(xml).toBe(input);
  });

  it("leaves VML without <v:imagedata> alone", () => {
    const input = `<w:pict><v:shape type="#_x0000_t75" style="width:100pt;height:50pt"><v:fill color="red"/></v:shape></w:pict>`;
    const { xml, converted } = convertVmlPictures(input, 1000);
    expect(converted).toBe(0);
    expect(xml).toBe(input);
  });

  it("leaves VML with unparseable style alone", () => {
    const input = `<w:pict><v:shape type="#_x0000_t75" style="position:absolute"><v:imagedata r:id="rId1"/></v:shape></w:pict>`;
    const { xml, converted } = convertVmlPictures(input, 1000);
    expect(converted).toBe(0);
    expect(xml).toBe(input);
  });

  it("handles attribute orderings on <v:imagedata>", () => {
    const input = `<w:pict><v:shape type="#_x0000_t75" style="width:100pt;height:50pt"><v:imagedata o:title="x" r:id="rId7"/></v:shape></w:pict>`;
    const { xml, converted } = convertVmlPictures(input, 1000);
    expect(converted).toBe(1);
    expect(xml).toContain('r:embed="rId7"');
    expect(xml).toContain('descr="x"');
  });

  it("declares wp: and r: namespaces locally on <wp:inline>", () => {
    const input = baseVml("rId19", "width:100pt;height:50pt");
    const { xml } = convertVmlPictures(input, 1000);
    expect(xml).toMatch(
      /<wp:inline\s+xmlns:wp="http:\/\/schemas\.openxmlformats\.org\/drawingml\/2006\/wordprocessingDrawing"\s+xmlns:r="http:\/\/schemas\.openxmlformats\.org\/officeDocument\/2006\/relationships"/
    );
  });

  it("does not touch existing <w:drawing> elements", () => {
    const drawing = `<w:drawing><wp:inline><a:blip r:embed="rId99"/></wp:inline></w:drawing>`;
    const input = drawing + baseVml("rId19", "width:100pt;height:50pt");
    const { xml, converted } = convertVmlPictures(input, 1000);
    expect(converted).toBe(1);
    expect(xml).toContain(drawing); // original drawing untouched
    expect(xml).toContain('r:embed="rId19"'); // VML converted
  });
});

describe("normalizeVmlImagesInBuffer", () => {
  function buildMinimalDocx(documentXml: string, extraParts: Record<string, string> = {}): Buffer {
    const zip = new AdmZip();
    zip.addFile(
      "[Content_Types].xml",
      Buffer.from(
        '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
        "utf8"
      )
    );
    zip.addFile("word/document.xml", Buffer.from(documentXml, "utf8"));
    for (const [name, content] of Object.entries(extraParts)) {
      zip.addFile(name, Buffer.from(content, "utf8"));
    }
    return zip.toBuffer();
  }

  it("returns the same buffer reference when no VML images are present", () => {
    const docXml = `<w:document><w:body><w:p/></w:body></w:document>`;
    const src = buildMinimalDocx(docXml);
    const result = normalizeVmlImagesInBuffer(src);
    expect(result.converted).toBe(0);
    expect(result.modifiedParts).toEqual([]);
    expect(result.buffer).toBe(src);
  });

  it("converts VML inside word/document.xml", () => {
    const vml = `<w:pict><v:shape type="#_x0000_t75" style="width:496.5pt;height:245pt"><v:imagedata r:id="rId19"/></v:shape></w:pict>`;
    const docXml = `<w:document><w:body><w:p><w:r>${vml}</w:r></w:p></w:body></w:document>`;
    const src = buildMinimalDocx(docXml);
    const result = normalizeVmlImagesInBuffer(src);
    expect(result.converted).toBe(1);
    expect(result.modifiedParts).toEqual(["word/document.xml"]);
    const newZip = new AdmZip(result.buffer);
    const newDoc = newZip.getEntry("word/document.xml")!.getData().toString("utf8");
    expect(newDoc).toContain("<w:drawing>");
    expect(newDoc).not.toContain("<w:pict");
  });

  it("converts VML inside header and footer parts", () => {
    const vml = `<w:pict><v:shape type="#_x0000_t75" style="width:100pt;height:50pt"><v:imagedata r:id="rId1"/></v:shape></w:pict>`;
    const docXml = `<w:document><w:body><w:p/></w:body></w:document>`;
    const headerXml = `<w:hdr><w:p><w:r>${vml}</w:r></w:p></w:hdr>`;
    const src = buildMinimalDocx(docXml, { "word/header1.xml": headerXml });
    const result = normalizeVmlImagesInBuffer(src);
    expect(result.converted).toBe(1);
    expect(result.modifiedParts).toEqual(["word/header1.xml"]);
  });

  it("skips _rels parts", () => {
    const vmlLikeRels = `<Relationships><Relationship Target="<w:pict><v:imagedata r:id='rId1'/></w:pict>"/></Relationships>`;
    const docXml = `<w:document><w:body><w:p/></w:body></w:document>`;
    const src = buildMinimalDocx(docXml, { "word/_rels/document.xml.rels": vmlLikeRels });
    const result = normalizeVmlImagesInBuffer(src);
    expect(result.converted).toBe(0);
  });
});
