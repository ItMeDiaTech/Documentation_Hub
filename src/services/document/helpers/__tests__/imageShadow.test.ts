/**
 * Tests for src/services/document/helpers/imageShadow.ts.
 *
 * Both functions operate on DocXMLater Image instances via the
 * "_rawPassthrough" map (the only mechanism the library exposes for
 * shape-level <a:effectLst> data). Tests use fake objects shaped like
 * Image/ImageRun/Revision and confirm the slot is correctly removed.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* globals jest, describe, it, expect */
import { clearAllImageShadows, clearImageShadow } from "../imageShadow";

jest.mock("docxmlater", () => {
  class MockImage {
    public _rawPassthrough = new Map<string, string>();
    constructor(slots: Record<string, string> = {}) {
      for (const [k, v] of Object.entries(slots)) {
        this._rawPassthrough.set(k, v);
      }
    }
  }
  class MockImageRun {
    constructor(private image: MockImage) {}
    getImageElement() {
      return this.image;
    }
  }
  class MockRevision {
    constructor(private content: any[] = []) {}
    getContent() {
      return this.content;
    }
  }
  class MockParagraph {
    constructor(private content: any[] = []) {}
    getContent() {
      return this.content;
    }
  }
  return {
    Image: MockImage,
    ImageRun: MockImageRun,
    Revision: MockRevision,
    Paragraph: MockParagraph,
    // Document is referenced only as a type by the helper.
    Document: class {},
  };
});

import { Image, ImageRun, Paragraph, Revision } from "docxmlater";

function makeDoc(paras: any[]) {
  return {
    getAllParagraphs: () => paras,
  } as any;
}

describe("clearImageShadow", () => {
  it("removes the spPr-effects slot and returns true when present", () => {
    const img = new (Image as any)({ "spPr-effects": "<a:effectLst><a:outerShdw/></a:effectLst>" });
    expect(clearImageShadow(img)).toBe(true);
    expect((img as any)._rawPassthrough.has("spPr-effects")).toBe(false);
  });

  it("returns false (no-op) when the slot is absent", () => {
    const img = new (Image as any)({});
    expect(clearImageShadow(img)).toBe(false);
  });

  it("does NOT touch other raw-passthrough slots (e.g. blip-effects)", () => {
    const img = new (Image as any)({
      "spPr-effects": "<a:effectLst><a:outerShdw/></a:effectLst>",
      "blip-effects": "<a:lum bright='30000'/>",
    });
    clearImageShadow(img);
    expect((img as any)._rawPassthrough.has("blip-effects")).toBe(true);
    expect((img as any)._rawPassthrough.get("blip-effects")).toBe("<a:lum bright='30000'/>");
  });

  it("returns false when the image has no _rawPassthrough map at all", () => {
    const bareImage = { } as any;
    expect(clearImageShadow(bareImage)).toBe(false);
  });
});

describe("clearAllImageShadows", () => {
  it("clears shadow on direct Image content", () => {
    const img1 = new (Image as any)({ "spPr-effects": "<a:effectLst/>" });
    const img2 = new (Image as any)({ "spPr-effects": "<a:effectLst/>" });
    const doc = makeDoc([new Paragraph([img1]), new Paragraph([img2])]);
    expect(clearAllImageShadows(doc)).toBe(2);
    expect((img1 as any)._rawPassthrough.has("spPr-effects")).toBe(false);
    expect((img2 as any)._rawPassthrough.has("spPr-effects")).toBe(false);
  });

  it("clears shadow on Image wrapped in ImageRun", () => {
    const img = new (Image as any)({ "spPr-effects": "<a:effectLst/>" });
    const run = new (ImageRun as any)(img);
    const doc = makeDoc([new Paragraph([run])]);
    expect(clearAllImageShadows(doc)).toBe(1);
    expect((img as any)._rawPassthrough.has("spPr-effects")).toBe(false);
  });

  it("clears shadow on Image inside ImageRun inside Revision", () => {
    const img = new (Image as any)({ "spPr-effects": "<a:effectLst/>" });
    const run = new (ImageRun as any)(img);
    const rev = new (Revision as any)([run]);
    const doc = makeDoc([new Paragraph([rev])]);
    expect(clearAllImageShadows(doc)).toBe(1);
    expect((img as any)._rawPassthrough.has("spPr-effects")).toBe(false);
  });

  it("returns 0 when no images carry shape effects", () => {
    const img = new (Image as any)({});
    const doc = makeDoc([new Paragraph([img])]);
    expect(clearAllImageShadows(doc)).toBe(0);
  });

  it("returns the count of images that actually had a shadow cleared", () => {
    const withShadow = new (Image as any)({ "spPr-effects": "<a:effectLst/>" });
    const withoutShadow = new (Image as any)({});
    const doc = makeDoc([new Paragraph([withShadow, withoutShadow])]);
    expect(clearAllImageShadows(doc)).toBe(1);
  });
});
