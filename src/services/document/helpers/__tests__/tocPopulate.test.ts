/**
 * @jest-environment node
 */

/**
 * Tests for src/services/document/helpers/tocPopulate.ts.
 *
 * Uses the REAL docxmlater library (not mocked) to prove the core fix:
 * TOC entries injected into the in-memory model SURVIVE a save+reload, while
 * the live, Word-updatable field (begin / separate / end) is preserved.
 *
 * Regression target: previously the TOC was populated only in the raw zip XML
 * (via rebuildTOCs), which save's updateDocumentXml() discarded — so a reloaded
 * document had a TOC field with ZERO entries (only the placeholder run).
 */

import { Bookmark, Document, Paragraph, TableOfContentsElement } from "docxmlater";
import AdmZip from "adm-zip";

import { collectTocHeadings, populateTocInModel } from "../tocPopulate";

/** Read word/document.xml out of a saved DOCX buffer. */
function readDocumentXml(buffer: Buffer): string {
  const zip = new AdmZip(buffer);
  const entry = zip.getEntry("word/document.xml");
  if (!entry) throw new Error("word/document.xml not found in buffer");
  return entry.getData().toString("utf8");
}

/** Add a heading paragraph carrying a registered bookmark, return its anchor. */
function addHeading(doc: Document, level: number, text: string): string {
  const para = new Paragraph();
  para.setStyle(`Heading${level}`);
  para.addText(text);
  const anchor = `_Toc_${level}_${text.replace(/\s+/g, "_")}`;
  const bookmark = doc.getBookmarkManager().register(new Bookmark({ name: anchor }));
  para.addBookmark(bookmark);
  doc.addParagraph(para);
  return anchor;
}

/**
 * Build a document whose body contains an SDT-wrapped TOC followed by headings,
 * then round-trip it so the TOC loads back as a TableOfContentsElement — i.e.
 * the exact in-memory shape produced when loading a real Word document.
 */
async function buildLoadedDocWithSdtToc(headings: { level: number; text: string }[]): Promise<{
  doc: Document;
  anchors: Map<string, string>;
}> {
  const seed = Document.create();
  // An SDT-wrapped TOC field at the top (placeholder-only, like a fresh insert).
  seed.addBodyElement(TableOfContentsElement.createStandard("Table of Contents"));
  for (const h of headings) addHeading(seed, h.level, h.text);

  const buffer = await seed.toBuffer();
  seed.dispose();

  const doc = await Document.loadFromBuffer(buffer);

  // Map heading text -> its bookmark anchor (as it survived the round-trip).
  const anchors = new Map<string, string>();
  for (const para of doc.getAllParagraphs()) {
    const starts = para.getBookmarksStart();
    if (starts && starts.length > 0) {
      anchors.set(para.getText().trim(), starts[0]!.getName());
    }
  }
  return { doc, anchors };
}

describe("collectTocHeadings", () => {
  it("collects headings with their bookmark anchors in document order", async () => {
    const { doc } = await buildLoadedDocWithSdtToc([
      { level: 1, text: "Intro" },
      { level: 2, text: "Background" },
      { level: 2, text: "Scope" },
    ]);

    const headings = collectTocHeadings(doc, /* excludeHeading1 */ false);
    expect(headings.map((h) => h.text)).toEqual(["Intro", "Background", "Scope"]);
    expect(headings.map((h) => h.level)).toEqual([1, 2, 2]);
    for (const h of headings) expect(h.anchor).toBeTruthy();

    doc.dispose();
  });

  it("excludes Heading 1 when requested", async () => {
    const { doc } = await buildLoadedDocWithSdtToc([
      { level: 1, text: "Title" },
      { level: 2, text: "Section A" },
      { level: 3, text: "Sub A1" },
    ]);

    const headings = collectTocHeadings(doc, /* excludeHeading1 */ true);
    expect(headings.map((h) => h.text)).toEqual(["Section A", "Sub A1"]);

    doc.dispose();
  });
});

describe("populateTocInModel — entries survive save + reload", () => {
  it("injects hyperlink entries into the model that persist through round-trip", async () => {
    const { doc, anchors } = await buildLoadedDocWithSdtToc([
      { level: 2, text: "Important Reminders" },
      { level: 2, text: "Contact Information" },
      { level: 2, text: "Appendix" },
    ]);

    const headings = collectTocHeadings(doc, /* excludeHeading1 */ true);
    const result = populateTocInModel(doc, headings, {
      font: "Verdana",
      size: 12,
      color: "0000FF",
      underline: "single",
    });

    expect(result.entries).toBe(3);
    expect(result.insertIndex).toBeGreaterThanOrEqual(0);

    const buffer = await doc.toBuffer();
    doc.dispose();
    const xml = readDocumentXml(buffer);

    // The live, updatable field must be intact: begin / separate / end fldChars.
    expect(xml).toContain('w:fldCharType="begin"');
    expect(xml).toContain('w:fldCharType="separate"');
    expect(xml).toContain('w:fldCharType="end"');
    expect(xml).toMatch(/<w:instrText[^>]*>\s*TOC[\s\S]*?<\/w:instrText>/);

    // Every entry persisted as a clickable internal hyperlink (anchor + text).
    for (const text of ["Important Reminders", "Contact Information", "Appendix"]) {
      const anchor = anchors.get(text);
      expect(anchor).toBeTruthy();
      expect(xml).toContain(`w:anchor="${anchor}"`);
      expect(xml).toContain(text);
    }

    // Reload to confirm the parser still sees the entries (not just placeholder).
    const reloaded = await Document.loadFromBuffer(buffer);
    const entryTexts = reloaded
      .getAllParagraphs()
      .filter((p) => /^TOC\d+$/i.test(p.getStyle() ?? ""))
      .map((p) => p.getText().trim())
      .filter((t) => t.length > 0);
    expect(entryTexts).toEqual(
      expect.arrayContaining(["Important Reminders", "Contact Information", "Appendix"])
    );
    // The placeholder string must NOT be the only content.
    expect(entryTexts).not.toContain("Right-click to update field.");
    reloaded.dispose();
  });

  it("removes the placeholder-only SDT TOC (no orphan placeholder survives)", async () => {
    const { doc } = await buildLoadedDocWithSdtToc([
      { level: 2, text: "Alpha" },
      { level: 2, text: "Beta" },
    ]);

    const headings = collectTocHeadings(doc, true);
    populateTocInModel(doc, headings, { color: "0000FF" });

    const buffer = await doc.toBuffer();
    doc.dispose();
    const xml = readDocumentXml(buffer);

    // The new field-based TOC replaces the SDT placeholder run entirely.
    expect(xml).not.toContain("Right-click to update field.");
    // Both entries present.
    expect(xml).toContain("Alpha");
    expect(xml).toContain("Beta");
  });

  it("is a no-op when there are no headings", async () => {
    const { doc } = await buildLoadedDocWithSdtToc([]);
    const result = populateTocInModel(doc, [], { color: "0000FF" });
    expect(result.entries).toBe(0);
    expect(result.insertIndex).toBe(-1);
    doc.dispose();
  });
});
