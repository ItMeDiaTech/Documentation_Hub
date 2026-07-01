/**
 * @jest-environment node
 *
 * applyNumberedUniformity must NOT flatten a legal/hierarchical multilevel
 * numbering template (e.g. level 1 lvlText "%1.%2." rendering 1.1) down to the
 * UI's flat single-token format. Multi-token "%n" templates are preserved
 * (audit M7).
 */

import { Document } from "docxmlater";
import { WordDocumentProcessor } from "../WordDocumentProcessor";

const SETTINGS = {
  indentationLevels: [
    { level: 0, symbolIndent: 0.25, textIndent: 0.5, numberedFormat: "1." },
    { level: 1, symbolIndent: 0.5, textIndent: 0.75, numberedFormat: "a." },
    { level: 2, symbolIndent: 0.75, textIndent: 1.0, numberedFormat: "i." },
  ],
};

describe("applyNumberedUniformity legal multilevel preservation (M7)", () => {
  it("preserves multi-token legal templates while still converting flat ones", async () => {
    const doc = Document.create();
    const mgr = doc.getNumberingManager();
    const numId = mgr.createNumberedList();
    const abs = mgr.getAbstractNumbering(mgr.getInstance(numId)!.getAbstractNumId())!;

    // Build a legal multilevel list: 1. / 1.1 / 1.1.1 (all decimal).
    abs.getLevel(0)!.setFormat("decimal");
    abs.getLevel(0)!.setText("%1.");
    abs.getLevel(1)!.setFormat("decimal");
    abs.getLevel(1)!.setText("%1.%2.");
    abs.getLevel(2)!.setFormat("decimal");
    abs.getLevel(2)!.setText("%1.%2.%3.");
    mgr.addAbstractNumbering(abs);

    const p = doc.createParagraph("Legal item");
    p.setNumbering(numId, 0);

    const processor = new WordDocumentProcessor();
    await (
      processor as unknown as {
        applyNumberedUniformity(d: Document, s: typeof SETTINGS): Promise<number>;
      }
    ).applyNumberedUniformity(doc, SETTINGS);

    // The hierarchical templates are NOT flattened to "%2." / "%3." and stay decimal.
    const l1 = abs.getLevel(1)!.getProperties();
    const l2 = abs.getLevel(2)!.getProperties();
    expect(l1.text).toBe("%1.%2.");
    expect(l1.format).toBe("decimal");
    expect(l2.text).toBe("%1.%2.%3.");
    expect(l2.format).toBe("decimal");

    doc.dispose();
  });
});
