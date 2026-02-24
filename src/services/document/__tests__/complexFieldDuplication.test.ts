/**
 * @jest-environment node
 */

/**
 * Hyperlink Deduplication — Diagnostic Tests
 *
 * These tests use the REAL docxmlater library (not mocked) to verify that
 * duplicate hyperlink content is correctly detected and removed.
 *
 * BACKGROUND:
 * When a DOCX file uses cross-paragraph ComplexField HYPERLINK chains
 * (fldChar begin in one paragraph, fldChar end at the start of the next),
 * docxmlater's two-pass field assembly can produce duplicate hyperlink
 * content in a single paragraph:
 *
 * 1. assembleMultiParagraphFields() creates a Hyperlink in the target paragraph
 * 2. assembleComplexFields() creates a ComplexField from remaining field runs
 *
 * Result: para.getContent() → [ Hyperlink("text"), ComplexField("text") ]
 *
 * The deduplicateComplexFieldHyperlinks() method is now type-agnostic:
 * it extracts { anchor, text } from ComplexField, Hyperlink, and raw field
 * runs, and removes adjacent duplicates sharing the same anchor AND text.
 */

import { ComplexField, Document, Hyperlink, Paragraph } from 'docxmlater';
import AdmZip from 'adm-zip';

// ---------------------------------------------------------------------------
// Type-agnostic dedup logic (mirrors WordDocumentProcessor implementation)
// ---------------------------------------------------------------------------
type HyperlinkInfo = { item: ComplexField | Hyperlink; anchor: string; text: string };

function extractHyperlinkItems(para: Paragraph): HyperlinkInfo[] {
  const content = para.getContent();
  const items: HyperlinkInfo[] = [];

  for (const item of content) {
    if (item instanceof ComplexField && item.isHyperlinkField()) {
      const parsed = item.getParsedHyperlink();
      items.push({
        item,
        anchor: parsed?.anchor || parsed?.url || item.getInstruction().trim(),
        text: item.getResult() || '',
      });
    } else if (item instanceof Hyperlink) {
      items.push({
        item,
        anchor: item.getAnchor() || item.getUrl() || '',
        text: item.getText() || '',
      });
    }
  }

  return items;
}

function deduplicateParagraph(para: Paragraph): number {
  const hyperlinkItems = extractHyperlinkItems(para);
  if (hyperlinkItems.length < 2) return 0;

  let removed = 0;
  for (let i = 1; i < hyperlinkItems.length; i++) {
    const prev = hyperlinkItems[i - 1];
    const curr = hyperlinkItems[i];
    if (prev.anchor === curr.anchor && prev.text === curr.text) {
      para.replaceContent(curr.item, []);
      removed++;
    }
  }
  return removed;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function addComplexFieldHyperlink(
  para: Paragraph,
  anchor: string,
  displayText: string,
): ComplexField {
  const cf = new ComplexField({
    instruction: `HYPERLINK \\l "${anchor}" \\h`,
    result: displayText,
    hasResult: true,
  });
  para.addComplexField(cf);
  return cf;
}

function addHyperlink(
  para: Paragraph,
  anchor: string,
  displayText: string,
): Hyperlink {
  const hl = Hyperlink.createInternal(anchor, displayText);
  para.addHyperlink(hl);
  return hl;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('Hyperlink Deduplication', () => {
  describe('ComplexField + ComplexField (original case)', () => {
    it('should remove the second of two identical ComplexField hyperlinks', () => {
      const doc = Document.create();
      const para = doc.createParagraph();

      addComplexFieldHyperlink(para, 'OLE_LINK94', 'Mail Order Error');
      addComplexFieldHyperlink(para, 'OLE_LINK94', 'Mail Order Error');

      expect(deduplicateParagraph(para)).toBe(1);

      const afterCf = para.getContent().filter(
        (item) => item instanceof ComplexField,
      );
      expect(afterCf.length).toBe(1);
      expect((afterCf[0] as ComplexField).getResult()).toBe('Mail Order Error');
    });

    it('should handle triple duplication (3 identical fields → 1 remains)', () => {
      const doc = Document.create();
      const para = doc.createParagraph();

      addComplexFieldHyperlink(para, 'OLE_LINK94', 'Mail Order Error');
      addComplexFieldHyperlink(para, 'OLE_LINK94', 'Mail Order Error');
      addComplexFieldHyperlink(para, 'OLE_LINK94', 'Mail Order Error');

      expect(deduplicateParagraph(para)).toBe(2);

      const afterCf = para.getContent().filter(
        (item) => item instanceof ComplexField,
      );
      expect(afterCf.length).toBe(1);
    });

    it('should NOT flag different ComplexField hyperlinks as duplicates', () => {
      const doc = Document.create();
      const para = doc.createParagraph();

      addComplexFieldHyperlink(para, 'OLE_LINK93', 'Clinical Error');
      addComplexFieldHyperlink(para, 'OLE_LINK94', 'Mail Order Error');

      expect(deduplicateParagraph(para)).toBe(0);

      const afterCf = para.getContent().filter(
        (item) => item instanceof ComplexField,
      );
      expect(afterCf.length).toBe(2);
    });
  });

  describe('Hyperlink + ComplexField (mixed-type — the actual bug)', () => {
    it('should remove duplicate when Hyperlink + ComplexField share same anchor and text', () => {
      const doc = Document.create();
      const para = doc.createParagraph();

      // Simulates what docxmlater produces: Hyperlink from assembleMultiParagraphFields,
      // ComplexField from assembleComplexFields
      addHyperlink(para, 'OLE_LINK94', 'Mail Order Error');
      addComplexFieldHyperlink(para, 'OLE_LINK94', 'Mail Order Error');

      const items = extractHyperlinkItems(para);
      expect(items.length).toBe(2);
      expect(items[0].item).toBeInstanceOf(Hyperlink);
      expect(items[1].item).toBeInstanceOf(ComplexField);

      expect(deduplicateParagraph(para)).toBe(1);

      // Only the Hyperlink should remain
      const afterContent = para.getContent();
      const afterHyperlinks = afterContent.filter((item) => item instanceof Hyperlink);
      const afterCf = afterContent.filter((item) => item instanceof ComplexField);
      expect(afterHyperlinks.length).toBe(1);
      expect(afterCf.length).toBe(0);
    });

    it('should NOT remove when Hyperlink and ComplexField have different anchors', () => {
      const doc = Document.create();
      const para = doc.createParagraph();

      addHyperlink(para, 'OLE_LINK93', 'Clinical Error');
      addComplexFieldHyperlink(para, 'OLE_LINK94', 'Mail Order Error');

      expect(deduplicateParagraph(para)).toBe(0);

      const afterContent = para.getContent();
      const afterHyperlinks = afterContent.filter((item) => item instanceof Hyperlink);
      const afterCf = afterContent.filter((item) => item instanceof ComplexField);
      expect(afterHyperlinks.length).toBe(1);
      expect(afterCf.length).toBe(1);
    });

    it('should NOT remove when same anchor but different display text', () => {
      const doc = Document.create();
      const para = doc.createParagraph();

      addHyperlink(para, 'OLE_LINK94', 'Mail Order Error');
      addComplexFieldHyperlink(para, 'OLE_LINK94', 'Mail Order Error (revised)');

      expect(deduplicateParagraph(para)).toBe(0);
    });
  });

  describe('Hyperlink + Hyperlink', () => {
    it('should remove duplicate when two Hyperlinks share same anchor and text', () => {
      const doc = Document.create();
      const para = doc.createParagraph();

      addHyperlink(para, 'OLE_LINK94', 'Mail Order Error');
      addHyperlink(para, 'OLE_LINK94', 'Mail Order Error');

      expect(deduplicateParagraph(para)).toBe(1);

      const afterHyperlinks = para.getContent().filter(
        (item) => item instanceof Hyperlink,
      );
      expect(afterHyperlinks.length).toBe(1);
      expect((afterHyperlinks[0] as Hyperlink).getText()).toBe('Mail Order Error');
    });

    it('should NOT remove different Hyperlinks', () => {
      const doc = Document.create();
      const para = doc.createParagraph();

      addHyperlink(para, 'OLE_LINK93', 'Clinical Error');
      addHyperlink(para, 'OLE_LINK94', 'Mail Order Error');

      expect(deduplicateParagraph(para)).toBe(0);

      const afterHyperlinks = para.getContent().filter(
        (item) => item instanceof Hyperlink,
      );
      expect(afterHyperlinks.length).toBe(2);
    });
  });

  describe('Multi-paragraph dedup', () => {
    it('should preserve non-duplicate hyperlinks across paragraphs', () => {
      const doc = Document.create();

      // Para 1: single hyperlink (chain start — no duplication)
      const para1 = doc.createParagraph();
      addComplexFieldHyperlink(para1, 'OLE_LINK93', 'Clinical Error');

      // Para 2: Hyperlink + ComplexField duplicate (the actual mixed-type bug)
      const para2 = doc.createParagraph();
      addHyperlink(para2, 'OLE_LINK94', 'Mail Order Error');
      addComplexFieldHyperlink(para2, 'OLE_LINK94', 'Mail Order Error');

      // Para 3: ComplexField + ComplexField duplicate (original bug pattern)
      const para3 = doc.createParagraph();
      addComplexFieldHyperlink(para3, 'OLE_LINK95', 'Courtesy Credit Exception Process');
      addComplexFieldHyperlink(para3, 'OLE_LINK95', 'Courtesy Credit Exception Process');

      // Para 4: single hyperlink (chain end — no duplication)
      const para4 = doc.createParagraph();
      addHyperlink(para4, 'OLE_LINK96', 'Other Reasons for Return');

      let totalRemoved = 0;
      for (const para of [para1, para2, para3, para4]) {
        totalRemoved += deduplicateParagraph(para);
      }

      expect(totalRemoved).toBe(2); // para2 and para3 each had one duplicate

      // Verify each paragraph now has exactly one hyperlink-like item
      for (const [para, expectedText] of [
        [para1, 'Clinical Error'],
        [para2, 'Mail Order Error'],
        [para3, 'Courtesy Credit Exception Process'],
        [para4, 'Other Reasons for Return'],
      ] as [Paragraph, string][]) {
        const items = extractHyperlinkItems(para);
        expect(items.length).toBe(1);
        expect(items[0].text).toBe(expectedText);
      }
    });
  });

  describe('XML output verification', () => {
    it('should produce single field sequence per paragraph after dedup and save', async () => {
      const doc = Document.create();

      const para1 = doc.createParagraph();
      addComplexFieldHyperlink(para1, 'OLE_LINK93', 'Clinical Error');

      // Mixed type: Hyperlink + ComplexField
      const para2 = doc.createParagraph();
      addHyperlink(para2, 'OLE_LINK94', 'Mail Order Error');
      addComplexFieldHyperlink(para2, 'OLE_LINK94', 'Mail Order Error');

      // ComplexField + ComplexField
      const para3 = doc.createParagraph();
      addComplexFieldHyperlink(para3, 'OLE_LINK95', 'Courtesy Credit');
      addComplexFieldHyperlink(para3, 'OLE_LINK95', 'Courtesy Credit');

      const para4 = doc.createParagraph();
      addHyperlink(para4, 'OLE_LINK96', 'Other Reasons');

      // Dedup all paragraphs
      for (const para of doc.getAllParagraphs()) {
        deduplicateParagraph(para);
      }

      // Save to buffer and inspect XML
      const buffer = await doc.toBuffer();
      const zip = new AdmZip(buffer);
      const xml = zip.readAsText('word/document.xml');

      // Count occurrences of each hyperlink text — should appear exactly once
      const mailOrderCount = (xml.match(/Mail Order Error/g) || []).length;
      const courtesyCount = (xml.match(/Courtesy Credit/g) || []).length;
      const clinicalCount = (xml.match(/Clinical Error/g) || []).length;
      const otherCount = (xml.match(/Other Reasons/g) || []).length;

      expect(mailOrderCount).toBe(1);
      expect(courtesyCount).toBe(1);
      expect(clinicalCount).toBe(1);
      expect(otherCount).toBe(1);
    });

    it('should show duplicated text WITHOUT dedup (proving the bug scenario)', async () => {
      const doc = Document.create();

      const para = doc.createParagraph();
      addComplexFieldHyperlink(para, 'OLE_LINK94', 'Mail Order Error');
      addComplexFieldHyperlink(para, 'OLE_LINK94', 'Mail Order Error');

      // Save WITHOUT dedup
      const buffer = await doc.toBuffer();
      const zip = new AdmZip(buffer);
      const xml = zip.readAsText('word/document.xml');

      // Without dedup, "Mail Order Error" appears twice
      const count = (xml.match(/Mail Order Error/g) || []).length;
      expect(count).toBe(2);
    });
  });
});
