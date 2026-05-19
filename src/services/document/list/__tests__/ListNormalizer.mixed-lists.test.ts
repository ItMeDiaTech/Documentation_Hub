/**
 * ListNormalizer mixed-list preservation tests.
 *
 * These tests guard the post-refactor behavior that each Word-list item keeps
 * its own bullet/numbered category. Cross-type "majority" conversion has been
 * removed: a cell containing both bullets and numbers should round-trip with
 * both categories intact.
 */

import { Document, Paragraph, WORD_NATIVE_BULLETS } from "docxmlater";
import type { NumberFormat } from "docxmlater";
import { ListNormalizer } from "../ListNormalizer";

// Mixed-list patterns use docxmlater's WORD_NATIVE_BULLETS encoding (Symbol
// U+F0B7 for filled, Courier-New U+006F for open). Aliased here so the test
// asserts the exact bytes the implementation writes.
const FILLED_DISC = WORD_NATIVE_BULLETS.FILLED_BULLET.char; // U+F0B7 (Symbol)
const OPEN_DISC = WORD_NATIVE_BULLETS.OPEN_CIRCLE.char; // U+006F (Courier New)

/**
 * Format that the item will RENDER as — i.e., the format of the abstractNum
 * level the item is assigned to. Categories are preserved through levels
 * within a shared mixed-list numId, not through separate per-category numIds.
 */
function renderedFormat(doc: Document, para: Paragraph): NumberFormat | null {
  const numbering = para.getNumbering();
  if (!numbering) return null;
  const mgr = doc.getNumberingManager();
  const inst = mgr.getInstance(numbering.numId);
  if (!inst) return null;
  const abs = mgr.getAbstractNumbering(inst.getAbstractNumId());
  if (!abs) return null;
  return abs.getLevel(numbering.level ?? 0)?.getFormat() ?? null;
}

/** Resolve the abstractNumId for a paragraph's numId, for shared-numId assertions. */
function abstractNumIdOf(doc: Document, para: Paragraph): number | undefined {
  const numbering = para.getNumbering();
  if (!numbering) return undefined;
  return doc.getNumberingManager().getInstance(numbering.numId)?.getAbstractNumId();
}

describe("ListNormalizer mixed-list preservation", () => {
  it("bullet → numbered → bullet renders correct category per item (bullet-lead mixed)", () => {
    const doc = Document.create();
    const mgr = doc.getNumberingManager();
    const bulletNumId = mgr.createBulletList();
    const numberedNumId = mgr.createNumberedList();

    const table = doc.createTable(1, 1);
    const cell = table.getRows()[0]!.getCells()[0]!;

    const p1 = Paragraph.create("First bullet");
    p1.setNumbering(bulletNumId, 0);
    const p2 = Paragraph.create("Middle numbered");
    p2.setNumbering(numberedNumId, 0);
    const p3 = Paragraph.create("Last bullet");
    p3.setNumbering(bulletNumId, 0);
    cell.addParagraph(p1);
    cell.addParagraph(p2);
    cell.addParagraph(p3);

    const normalizer = new ListNormalizer(mgr);
    normalizer.normalizeAllTables([table], { indentationLevels: [] });

    const out = cell.getParagraphs().filter((p) => p.getNumbering() !== undefined);
    const items = out.slice(-3);

    // All three items share ONE bullet-lead mixed numId (lead is the first item).
    const sharedAbsId = abstractNumIdOf(doc, items[0]!);
    expect(sharedAbsId).toBeDefined();
    expect(abstractNumIdOf(doc, items[1]!)).toBe(sharedAbsId);
    expect(abstractNumIdOf(doc, items[2]!)).toBe(sharedAbsId);

    // Categories preserved through LEVELS: bullets render as bullet, number as decimal.
    expect(renderedFormat(doc, items[0]!)).toBe("bullet");
    expect(renderedFormat(doc, items[1]!)).toBe("decimal");
    expect(renderedFormat(doc, items[2]!)).toBe("bullet");

    // Lead at level 0, subordinated at level 1.
    expect(items[0]!.getNumbering()?.level).toBe(0);
    expect(items[1]!.getNumbering()?.level).toBe(1);
    expect(items[2]!.getNumbering()?.level).toBe(0);
  });

  it("numbered → bullet → numbered renders correct category per item (numbered-lead mixed)", () => {
    // Per user spec (bidirectional pattern): when a bullet appears in a
    // numbered-led sub-tree, the pattern SWITCHES at that level to
    // alternating closed/open bullets (●, ○, ●, ○, …). The subordinated
    // bullet renders as a closed bullet at the switch level (1), not a
    // letter cascade.
    const doc = Document.create();
    const mgr = doc.getNumberingManager();
    const bulletNumId = mgr.createBulletList();
    const numberedNumId = mgr.createNumberedList();

    const table = doc.createTable(1, 1);
    const cell = table.getRows()[0]!.getCells()[0]!;

    const p1 = Paragraph.create("First numbered");
    p1.setNumbering(numberedNumId, 0);
    const p2 = Paragraph.create("Middle bullet");
    p2.setNumbering(bulletNumId, 0);
    const p3 = Paragraph.create("Last numbered");
    p3.setNumbering(numberedNumId, 0);
    cell.addParagraph(p1);
    cell.addParagraph(p2);
    cell.addParagraph(p3);

    const normalizer = new ListNormalizer(mgr);
    normalizer.normalizeAllTables([table], { indentationLevels: [] });

    const out = cell.getParagraphs().filter((p) => p.getNumbering() !== undefined);
    const items = out.slice(-3);

    const sharedAbsId = abstractNumIdOf(doc, items[0]!);
    expect(sharedAbsId).toBeDefined();
    expect(abstractNumIdOf(doc, items[1]!)).toBe(sharedAbsId);
    expect(abstractNumIdOf(doc, items[2]!)).toBe(sharedAbsId);

    expect(renderedFormat(doc, items[0]!)).toBe("decimal");
    expect(renderedFormat(doc, items[1]!)).toBe("bullet");
    expect(renderedFormat(doc, items[2]!)).toBe("decimal");

    expect(items[0]!.getNumbering()?.level).toBe(0);
    expect(items[1]!.getNumbering()?.level).toBe(1);
    expect(items[2]!.getNumbering()?.level).toBe(0);
  });

  describe("minority-category subordination", () => {
    it("indents bullets that appear inside a numbered-lead group (image scenario)", () => {
      const doc = Document.create();
      const mgr = doc.getNumberingManager();
      const bulletNumId = mgr.createBulletList();
      const numberedNumId = mgr.createNumberedList();

      const table = doc.createTable(1, 1);
      const cell = table.getRows()[0]!.getCells()[0]!;

      // 1. numbered  /  • bullet  /  2. numbered  /  • bullet  /  • bullet
      const p1 = Paragraph.create("Offer to check CVS retail inventory");
      p1.setNumbering(numberedNumId, 0);
      const p2 = Paragraph.create("Do Not initiate a Mail to Retail Transfer");
      p2.setNumbering(bulletNumId, 0);
      const p3 = Paragraph.create("Advise the caller they can contact their provider");
      p3.setNumbering(numberedNumId, 0);
      const p4 = Paragraph.create("Advise the caller any alternatives");
      p4.setNumbering(bulletNumId, 0);
      const p5 = Paragraph.create("If no alternatives are found");
      p5.setNumbering(bulletNumId, 0);
      cell.addParagraph(p1);
      cell.addParagraph(p2);
      cell.addParagraph(p3);
      cell.addParagraph(p4);
      cell.addParagraph(p5);

      const normalizer = new ListNormalizer(mgr);
      normalizer.normalizeAllTables([table], { indentationLevels: [] });

      const out = cell
        .getParagraphs()
        .filter((p) => p.getNumbering() !== undefined);
      const items = out.slice(-5);

      // Lead category is numbered (first item). Bullets are subordinated to level 1.
      expect(items[0]!.getNumbering()?.level).toBe(0); // numbered
      expect(items[1]!.getNumbering()?.level).toBe(1); // bullet (subordinated)
      expect(items[2]!.getNumbering()?.level).toBe(0); // numbered (back to lead)
      expect(items[3]!.getNumbering()?.level).toBe(1); // bullet (subordinated)
      expect(items[4]!.getNumbering()?.level).toBe(1); // bullet (still subordinated)

      // All 5 items share the same numbered-lead mixed numId.
      const sharedAbsId = abstractNumIdOf(doc, items[0]!);
      for (let i = 1; i < items.length; i++) {
        expect(abstractNumIdOf(doc, items[i]!)).toBe(sharedAbsId);
      }

      // Per user spec (bidirectional pattern): when bullets appear in a
      // numbered-led sub-tree, the pattern switches at the switch level (1)
      // to alternating closed/open bullets. Subordinated bullets render as
      // closed bullets at level 1, NOT as letter cascade.
      expect(renderedFormat(doc, items[0]!)).toBe("decimal");
      expect(renderedFormat(doc, items[1]!)).toBe("bullet");
      expect(renderedFormat(doc, items[2]!)).toBe("decimal");
      expect(renderedFormat(doc, items[3]!)).toBe("bullet");
      expect(renderedFormat(doc, items[4]!)).toBe("bullet");
    });

    it("indents numbered items that appear inside a bullet-lead group", () => {
      const doc = Document.create();
      const mgr = doc.getNumberingManager();
      const bulletNumId = mgr.createBulletList();
      const numberedNumId = mgr.createNumberedList();

      const table = doc.createTable(1, 1);
      const cell = table.getRows()[0]!.getCells()[0]!;

      // • bullet  /  1. numbered  /  • bullet
      const p1 = Paragraph.create("First bullet");
      p1.setNumbering(bulletNumId, 0);
      const p2 = Paragraph.create("Middle numbered");
      p2.setNumbering(numberedNumId, 0);
      const p3 = Paragraph.create("Last bullet");
      p3.setNumbering(bulletNumId, 0);
      cell.addParagraph(p1);
      cell.addParagraph(p2);
      cell.addParagraph(p3);

      const normalizer = new ListNormalizer(mgr);
      normalizer.normalizeAllTables([table], { indentationLevels: [] });

      const out = cell
        .getParagraphs()
        .filter((p) => p.getNumbering() !== undefined);
      const items = out.slice(-3);

      // Lead is bullet, numbered is subordinated
      expect(items[0]!.getNumbering()?.level).toBe(0); // bullet (lead)
      expect(items[1]!.getNumbering()?.level).toBe(1); // numbered (subordinated)
      expect(items[2]!.getNumbering()?.level).toBe(0); // bullet (lead)
    });

    it("can be disabled via subordinateMinorityCategory: false", () => {
      const doc = Document.create();
      const mgr = doc.getNumberingManager();
      const bulletNumId = mgr.createBulletList();
      const numberedNumId = mgr.createNumberedList();

      const table = doc.createTable(1, 1);
      const cell = table.getRows()[0]!.getCells()[0]!;

      const p1 = Paragraph.create("First numbered");
      p1.setNumbering(numberedNumId, 0);
      const p2 = Paragraph.create("Middle bullet");
      p2.setNumbering(bulletNumId, 0);
      cell.addParagraph(p1);
      cell.addParagraph(p2);

      const normalizer = new ListNormalizer(mgr);
      normalizer.normalizeAllTables([table], {
        indentationLevels: [],
        subordinateMinorityCategory: false,
      });

      const out = cell
        .getParagraphs()
        .filter((p) => p.getNumbering() !== undefined);
      const items = out.slice(-2);

      // Both stay at level 0 when feature is disabled
      expect(items[0]!.getNumbering()?.level).toBe(0);
      expect(items[1]!.getNumbering()?.level).toBe(0);
    });

    it("numbered-lead with bullet sub: switch level is a closed bullet (bidirectional pattern)", () => {
      // Per the user's latest spec: when a bullet appears in a numbered-led
      // sub-tree, the pattern SWITCHES to alternating closed/open bullets at
      // and below the switch level. The bullet sub lands at level 1 and
      // renders as the closed (filled) bullet — NOT a letter cascade.
      const doc = Document.create();
      const mgr = doc.getNumberingManager();
      const bulletNumId = mgr.createBulletList();
      const numberedNumId = mgr.createNumberedList();

      const table = doc.createTable(1, 1);
      const cell = table.getRows()[0]!.getCells()[0]!;

      const p1 = Paragraph.create("1. Top numbered");
      p1.setNumbering(numberedNumId, 0);
      // Bullet ALREADY at ilvl=1 in source — typical Word autoformat output.
      const p2 = Paragraph.create("Sub bullet that source set to ilvl=1");
      p2.setNumbering(bulletNumId, 1);
      cell.addParagraph(p1);
      cell.addParagraph(p2);

      const normalizer = new ListNormalizer(mgr);
      normalizer.normalizeAllTables([table], { indentationLevels: [] });

      const sub = cell
        .getParagraphs()
        .find((p) => p.getText().includes("Sub bullet"))!;
      // Must land at level 1 in the mixed numId, NOT level 2.
      expect(sub.getNumbering()?.level).toBe(1);

      const inst = mgr.getInstance(sub.getNumbering()!.numId);
      const abs = mgr.getAbstractNumbering(inst!.getAbstractNumId())!;
      const lvlProps = abs.getLevel(1)!.getProperties();
      expect(lvlProps.format).toBe("bullet");
      expect(lvlProps.text).toBe(FILLED_DISC);
    });

    it("multi-level bullet list with numbered subordinate gets dynamic pattern (decimal placed after deepest bullet)", () => {
      // Regression: list with bullets at ilvl 0 and 1 plus a numbered at
      // ilvl 0. switchLevel = bullet-lead's first cross-cat level not
      // occupied by lead. numberedLevels={0} → candidate=max(1,0)=1.
      // bulletLevels={0,1} contains 1 → bump to 2. switchLevel=2. BOTH
      // bullet levels keep distinct lead slots and the numbered lands at
      // the decimal switch slot (level 2). Source ilvls preserved on lead.
      const doc = Document.create();
      const mgr = doc.getNumberingManager();
      const bulletNumId = mgr.createBulletList();
      const numberedNumId = mgr.createNumberedList();

      const table = doc.createTable(1, 1);
      const cell = table.getRows()[0]!.getCells()[0]!;

      const items: Array<{ text: string; numId: number; level: number }> = [
        { text: "Outer bullet A", numId: bulletNumId, level: 0 },
        { text: "Sub bullet A1", numId: bulletNumId, level: 1 },
        { text: "1. numbered item", numId: numberedNumId, level: 0 },
        { text: "Outer bullet B", numId: bulletNumId, level: 0 },
      ];
      for (const it of items) {
        const p = Paragraph.create(it.text);
        p.setNumbering(it.numId, it.level);
        cell.addParagraph(p);
      }

      const normalizer = new ListNormalizer(mgr);
      normalizer.normalizeAllTables([table], { indentationLevels: [] });

      const paras = cell.getParagraphs().filter((p) => p.getText().trim().length > 0);
      const outerA = paras.find((p) => p.getText().includes("Outer bullet A"))!;
      const subBullet = paras.find((p) => p.getText().includes("Sub bullet A1"))!;
      const numbered = paras.find((p) => p.getText().includes("1. numbered item"))!;
      const outerB = paras.find((p) => p.getText().includes("Outer bullet B"))!;

      // Source ilvls preserved for lead (bullet) items; numbered cross-cat
      // snapped to switchLevel (2).
      expect(outerA.getNumbering()?.level).toBe(0);
      expect(subBullet.getNumbering()?.level).toBe(1);
      expect(numbered.getNumbering()?.level).toBe(2);
      expect(outerB.getNumbering()?.level).toBe(0);

      // All four share the same mixed-list abstract.
      const sharedAbsId = abstractNumIdOf(doc, outerA);
      expect(abstractNumIdOf(doc, subBullet)).toBe(sharedAbsId);
      expect(abstractNumIdOf(doc, numbered)).toBe(sharedAbsId);
      expect(abstractNumIdOf(doc, outerB)).toBe(sharedAbsId);

      // Pattern: ●, ○, decimal, cascade...
      const abs = mgr.getAbstractNumbering(
        mgr.getInstance(outerA.getNumbering()!.numId)!.getAbstractNumId()
      )!;
      expect(abs.getLevel(0)!.getProperties().format).toBe("bullet");
      expect(abs.getLevel(0)!.getProperties().text).toBe(FILLED_DISC);
      expect(abs.getLevel(1)!.getProperties().format).toBe("bullet");
      expect(abs.getLevel(1)!.getProperties().text).toBe(OPEN_DISC);
      expect(abs.getLevel(2)!.getProperties().format).toBe("decimal");
    });

    it("numbered-lead with bullet sub at ilvl=0: 1., ●, ○, ●, ○, ●, ○, ●, ○", () => {
      // Per user spec (bidirectional pattern): bullet appears at ilvl=0
      // (same-level conflict), switchLevel bumps to 1. Level 0 is decimal
      // (the numbered lead), level 1 is the closed bullet (switch slot),
      // and deeper levels alternate open/closed.
      const doc = Document.create();
      const mgr = doc.getNumberingManager();
      const bulletNumId = mgr.createBulletList();
      const numberedNumId = mgr.createNumberedList();

      const table = doc.createTable(1, 1);
      const cell = table.getRows()[0]!.getCells()[0]!;

      const lead = Paragraph.create("Lead numbered");
      lead.setNumbering(numberedNumId, 0);
      const sub = Paragraph.create("Sub bullet");
      sub.setNumbering(bulletNumId, 0);
      cell.addParagraph(lead);
      cell.addParagraph(sub);

      const normalizer = new ListNormalizer(mgr);
      normalizer.normalizeAllTables([table], { indentationLevels: [] });

      const numId = cell
        .getParagraphs()
        .find((p) => p.getText().includes("Lead numbered"))!
        .getNumbering()!.numId;
      const inst = mgr.getInstance(numId);
      const abs = mgr.getAbstractNumbering(inst!.getAbstractNumId())!;

      const expected: Array<{ format: string; text: string }> = [
        { format: "decimal", text: "%1." },
        { format: "bullet", text: FILLED_DISC },
        { format: "bullet", text: OPEN_DISC },
        { format: "bullet", text: FILLED_DISC },
        { format: "bullet", text: OPEN_DISC },
        { format: "bullet", text: FILLED_DISC },
        { format: "bullet", text: OPEN_DISC },
        { format: "bullet", text: FILLED_DISC },
        { format: "bullet", text: OPEN_DISC },
      ];
      for (let i = 0; i < expected.length; i++) {
        expect(abs.getLevel(i)!.getProperties().format).toBe(expected[i]!.format);
        expect(abs.getLevel(i)!.getProperties().text).toBe(expected[i]!.text);
      }
    });

    it("bullet-lead with numbered subordinate at ilvl=0: ●, 1., a., i., A., I., a., i., A.", () => {
      // Per user spec: bullet-led with same-level conflict → numbered cross
      // forced to switchLevel=1; pattern is ●, decimal, then 4-element
      // letter/roman cascade.
      const doc = Document.create();
      const mgr = doc.getNumberingManager();
      const bulletNumId = mgr.createBulletList();
      const numberedNumId = mgr.createNumberedList();

      const table = doc.createTable(1, 1);
      const cell = table.getRows()[0]!.getCells()[0]!;

      const lead = Paragraph.create("Lead bullet");
      lead.setNumbering(bulletNumId, 0);
      const sub = Paragraph.create("Sub numbered");
      sub.setNumbering(numberedNumId, 0);
      cell.addParagraph(lead);
      cell.addParagraph(sub);

      const normalizer = new ListNormalizer(mgr);
      normalizer.normalizeAllTables([table], { indentationLevels: [] });

      const numId = cell
        .getParagraphs()
        .find((p) => p.getText().includes("Lead bullet"))!
        .getNumbering()!.numId;
      const inst = mgr.getInstance(numId);
      const abs = mgr.getAbstractNumbering(inst!.getAbstractNumId())!;

      const expected: Array<{ format: string; text: string }> = [
        { format: "bullet", text: FILLED_DISC },
        { format: "decimal", text: "%2." },
        { format: "lowerLetter", text: "%3." },
        { format: "lowerRoman", text: "%4." },
        { format: "upperLetter", text: "%5." },
        { format: "upperRoman", text: "%6." },
        { format: "lowerLetter", text: "%7." },
        { format: "lowerRoman", text: "%8." },
        { format: "upperLetter", text: "%9." },
      ];
      for (let i = 0; i < expected.length; i++) {
        expect(abs.getLevel(i)!.getProperties().format).toBe(expected[i]!.format);
        expect(abs.getLevel(i)!.getProperties().text).toBe(expected[i]!.text);
      }
    });

    it("bullet-lead with numbered subordinate at ilvl=3: ●, ○, ●, 1., a., i., A., I., a.", () => {
      // Per user spec: when bullets precede the numbered subordinate at
      // deeper levels, levels 0..N-1 alternate filled/open, level N is
      // decimal, then the 4-element letter/roman cascade follows.
      const doc = Document.create();
      const mgr = doc.getNumberingManager();
      const bulletNumId = mgr.createBulletList();
      const numberedNumId = mgr.createNumberedList();

      const table = doc.createTable(1, 1);
      const cell = table.getRows()[0]!.getCells()[0]!;

      const p1 = Paragraph.create("Bullet at 0");
      p1.setNumbering(bulletNumId, 0);
      const p2 = Paragraph.create("Bullet at 1");
      p2.setNumbering(bulletNumId, 1);
      const p3 = Paragraph.create("Bullet at 2");
      p3.setNumbering(bulletNumId, 2);
      const p4 = Paragraph.create("Numbered at 3");
      p4.setNumbering(numberedNumId, 3);
      cell.addParagraph(p1);
      cell.addParagraph(p2);
      cell.addParagraph(p3);
      cell.addParagraph(p4);

      const normalizer = new ListNormalizer(mgr);
      normalizer.normalizeAllTables([table], { indentationLevels: [] });

      const numId = cell
        .getParagraphs()
        .find((p) => p.getText().includes("Bullet at 0"))!
        .getNumbering()!.numId;
      const inst = mgr.getInstance(numId);
      const abs = mgr.getAbstractNumbering(inst!.getAbstractNumId())!;

      const expected: Array<{ format: string; text: string }> = [
        { format: "bullet", text: FILLED_DISC },
        { format: "bullet", text: OPEN_DISC },
        { format: "bullet", text: FILLED_DISC },
        { format: "decimal", text: "%4." },
        { format: "lowerLetter", text: "%5." },
        { format: "lowerRoman", text: "%6." },
        { format: "upperLetter", text: "%7." },
        { format: "upperRoman", text: "%8." },
        { format: "lowerLetter", text: "%9." },
      ];
      for (let i = 0; i < expected.length; i++) {
        expect(abs.getLevel(i)!.getProperties().format).toBe(expected[i]!.format);
        expect(abs.getLevel(i)!.getProperties().text).toBe(expected[i]!.text);
      }
    });

    it("subordinated bullet under numbered-lead uses closed bullet at its level", () => {
      // Per user spec (bidirectional pattern): numbered-led with a bullet
      // subordinate switches to alternating closed/open bullets at the
      // switch level. Subordinated bullet at level 1 renders as the closed
      // (filled) bullet.
      const doc = Document.create();
      const mgr = doc.getNumberingManager();
      const bulletNumId = mgr.createBulletList();
      const numberedNumId = mgr.createNumberedList();

      const table = doc.createTable(1, 1);
      const cell = table.getRows()[0]!.getCells()[0]!;

      const lead = Paragraph.create("Numbered lead");
      lead.setNumbering(numberedNumId, 0);
      const sub = Paragraph.create("Subordinated bullet");
      sub.setNumbering(bulletNumId, 0);
      cell.addParagraph(lead);
      cell.addParagraph(sub);

      const normalizer = new ListNormalizer(mgr);
      normalizer.normalizeAllTables([table], { indentationLevels: [] });

      const subPara = cell
        .getParagraphs()
        .find((p) => p.getText().includes("Subordinated bullet"))!;
      const subNumId = subPara.getNumbering()?.numId;
      const subLevel = subPara.getNumbering()?.level ?? 0;
      expect(subLevel).toBe(1);

      const inst = mgr.getInstance(subNumId!);
      const abs = mgr.getAbstractNumbering(inst!.getAbstractNumId());
      const lvl = abs!.getLevel(subLevel);
      const props = lvl!.getProperties();

      expect(props.format).toBe("bullet");
      expect(props.text).toBe(FILLED_DISC);
    });

    it("subordinated numbered uses decimal format at its level", () => {
      const doc = Document.create();
      const mgr = doc.getNumberingManager();
      const bulletNumId = mgr.createBulletList();
      const numberedNumId = mgr.createNumberedList();

      const table = doc.createTable(1, 1);
      const cell = table.getRows()[0]!.getCells()[0]!;

      const lead = Paragraph.create("Bullet lead");
      lead.setNumbering(bulletNumId, 0);
      const sub = Paragraph.create("Subordinated number");
      sub.setNumbering(numberedNumId, 0);
      cell.addParagraph(lead);
      cell.addParagraph(sub);

      const normalizer = new ListNormalizer(mgr);
      normalizer.normalizeAllTables([table], { indentationLevels: [] });

      const subPara = cell
        .getParagraphs()
        .find((p) => p.getText().includes("Subordinated number"))!;
      const subNumId = subPara.getNumbering()?.numId;
      const subLevel = subPara.getNumbering()?.level ?? 0;
      expect(subLevel).toBe(1);

      const inst = mgr.getInstance(subNumId!);
      const abs = mgr.getAbstractNumbering(inst!.getAbstractNumId());
      const lvl = abs!.getLevel(subLevel);
      const props = lvl!.getProperties();

      // Default level-1 of a numbered list is lowerLetter; subordination forces decimal.
      expect(props.format).toBe("decimal");
      expect(props.text).toBe("%2.");
    });

    it("trackMixedListAbstractNumIds Set passed by caller is populated (regression v5.12.13)", () => {
      // Regression for the bug where resolveOptions stripped the tracking Set.
      // Without this Set being populated, downstream uniformity passes don't
      // skip the mixed abstract and overwrite L1 back to Word's default.
      const doc = Document.create();
      const mgr = doc.getNumberingManager();
      const bulletNumId = mgr.createBulletList();
      const numberedNumId = mgr.createNumberedList();

      const table = doc.createTable(1, 1);
      const cell = table.getRows()[0]!.getCells()[0]!;

      const p1 = Paragraph.create("Numbered lead");
      p1.setNumbering(numberedNumId, 0);
      const p2 = Paragraph.create("Sub bullet");
      p2.setNumbering(bulletNumId, 0);
      cell.addParagraph(p1);
      cell.addParagraph(p2);

      const tracking = new Set<number>();
      const normalizer = new ListNormalizer(mgr);
      normalizer.normalizeAllTables([table], {
        indentationLevels: [],
        trackMixedListAbstractNumIds: tracking,
      });

      // The mixed numId's abstractNumId should be in the caller's Set.
      expect(tracking.size).toBeGreaterThan(0);
      // And it must correspond to the abstract actually assigned to the items.
      const subAbsId = mgr
        .getInstance(
          cell
            .getParagraphs()
            .find((p) => p.getText().includes("Sub bullet"))!
            .getNumbering()!.numId
        )!
        .getAbstractNumId();
      expect(tracking.has(subAbsId)).toBe(true);
    });

    it("non-subordinated level-1 bullet keeps Word's default format (open circle)", () => {
      // Guard: customization MUST apply only to subordinated items. A bullet
      // that's naturally at level 1 (no subordination) must keep the default
      // Word per-level rotation.
      const doc = Document.create();
      const mgr = doc.getNumberingManager();
      const bulletNumId = mgr.createBulletList();

      const table = doc.createTable(1, 1);
      const cell = table.getRows()[0]!.getCells()[0]!;

      const l0 = Paragraph.create("Top-level bullet");
      l0.setNumbering(bulletNumId, 0);
      const l1 = Paragraph.create("Natural level-1 bullet");
      l1.setNumbering(bulletNumId, 1);
      cell.addParagraph(l0);
      cell.addParagraph(l1);

      const normalizer = new ListNormalizer(mgr);
      normalizer.normalizeAllTables([table], { indentationLevels: [] });

      const l1Para = cell
        .getParagraphs()
        .find((p) => p.getText().includes("Natural level-1 bullet"))!;
      const l1NumId = l1Para.getNumbering()?.numId;
      const inst = mgr.getInstance(l1NumId!);
      const abs = mgr.getAbstractNumbering(inst!.getAbstractNumId());
      const lvl = abs!.getLevel(1);
      const props = lvl!.getProperties();

      // Default level-1 character is the open circle, NOT the filled bullet.
      expect(props.text).toBe(OPEN_DISC);
    });

    it("subordinates a cross-category item separated by ≤ 2 non-list paragraphs", () => {
      const doc = Document.create();
      const mgr = doc.getNumberingManager();
      const bulletNumId = mgr.createBulletList();
      const numberedNumId = mgr.createNumberedList();

      const table = doc.createTable(1, 1);
      const cell = table.getRows()[0]!.getCells()[0]!;

      const p1 = Paragraph.create("Numbered lead");
      p1.setNumbering(numberedNumId, 0);
      // Two non-list paragraphs between (still within 2-line proximity)
      const gap1 = Paragraph.create("Some prose between items");
      const gap2 = Paragraph.create("More prose between items");
      const p2 = Paragraph.create("Bullet after 2-line gap");
      p2.setNumbering(bulletNumId, 0);

      cell.addParagraph(p1);
      cell.addParagraph(gap1);
      cell.addParagraph(gap2);
      cell.addParagraph(p2);

      const normalizer = new ListNormalizer(mgr);
      normalizer.normalizeAllTables([table], { indentationLevels: [] });

      const paras = cell.getParagraphs();
      const find = (needle: string) =>
        paras.find((p) => p.getText().includes(needle));

      expect(find("Numbered lead")!.getNumbering()?.level).toBe(0);
      expect(find("Bullet after 2-line gap")!.getNumbering()?.level).toBe(1);
    });

    it("starts a new group when cross-category item is > 2 non-list paragraphs away", () => {
      const doc = Document.create();
      const mgr = doc.getNumberingManager();
      const bulletNumId = mgr.createBulletList();
      const numberedNumId = mgr.createNumberedList();

      const table = doc.createTable(1, 1);
      const cell = table.getRows()[0]!.getCells()[0]!;

      const p1 = Paragraph.create("Numbered lead");
      p1.setNumbering(numberedNumId, 0);
      // Three non-list paragraphs between → exceeds the 2-line proximity threshold
      const gap1 = Paragraph.create("Prose 1");
      const gap2 = Paragraph.create("Prose 2");
      const gap3 = Paragraph.create("Prose 3");
      const p2 = Paragraph.create("Bullet far away");
      p2.setNumbering(bulletNumId, 0);

      cell.addParagraph(p1);
      cell.addParagraph(gap1);
      cell.addParagraph(gap2);
      cell.addParagraph(gap3);
      cell.addParagraph(p2);

      const normalizer = new ListNormalizer(mgr);
      normalizer.normalizeAllTables([table], { indentationLevels: [] });

      const paras = cell.getParagraphs();
      const find = (needle: string) =>
        paras.find((p) => p.getText().includes(needle));

      // Bullet should NOT be subordinated — it's a new group, becomes its own lead at level 0
      expect(find("Numbered lead")!.getNumbering()?.level).toBe(0);
      expect(find("Bullet far away")!.getNumbering()?.level).toBe(0);
    });

    it("resets lead across > 2 non-list paragraphs", () => {
      const doc = Document.create();
      const mgr = doc.getNumberingManager();
      const bulletNumId = mgr.createBulletList();
      const numberedNumId = mgr.createNumberedList();

      const table = doc.createTable(1, 1);
      const cell = table.getRows()[0]!.getCells()[0]!;

      // Group A: numbered lead with bullet minority
      const a1 = Paragraph.create("Group A numbered lead");
      a1.setNumbering(numberedNumId, 0);
      const a2 = Paragraph.create("Group A bullet minority");
      a2.setNumbering(bulletNumId, 0);
      // 3 plain paragraphs — exceeds the 2-line proximity threshold, breaks the group
      const gap1 = Paragraph.create("Plain prose 1");
      const gap2 = Paragraph.create("Plain prose 2");
      const gap3 = Paragraph.create("Plain prose 3");
      // Group B: bullet lead with numbered minority
      const b1 = Paragraph.create("Group B bullet lead");
      b1.setNumbering(bulletNumId, 0);
      const b2 = Paragraph.create("Group B numbered minority");
      b2.setNumbering(numberedNumId, 0);

      cell.addParagraph(a1);
      cell.addParagraph(a2);
      cell.addParagraph(gap1);
      cell.addParagraph(gap2);
      cell.addParagraph(gap3);
      cell.addParagraph(b1);
      cell.addParagraph(b2);

      const normalizer = new ListNormalizer(mgr);
      normalizer.normalizeAllTables([table], { indentationLevels: [] });

      const paras = cell.getParagraphs();
      const findByText = (needle: string) =>
        paras.find((p) => p.getText().includes(needle));

      expect(findByText("Group A numbered lead")!.getNumbering()?.level).toBe(0);
      expect(findByText("Group A bullet minority")!.getNumbering()?.level).toBe(1);
      expect(findByText("Plain prose 1")!.getNumbering()).toBeUndefined();
      expect(findByText("Group B bullet lead")!.getNumbering()?.level).toBe(0);
      expect(findByText("Group B numbered minority")!.getNumbering()?.level).toBe(1);
    });
  });

  it("converts typed '1.' prefix to a numbered Word list (regression guard)", () => {
    const doc = Document.create();
    const mgr = doc.getNumberingManager();
    const table = doc.createTable(1, 1);
    const cell = table.getRows()[0]!.getCells()[0]!;

    const p1 = Paragraph.create("1. First item");
    const p2 = Paragraph.create("2. Second item");
    cell.addParagraph(p1);
    cell.addParagraph(p2);

    const normalizer = new ListNormalizer(mgr);
    const report = normalizer.normalizeAllTables([table], { indentationLevels: [] });

    expect(report.normalized).toBeGreaterThanOrEqual(2);

    const out = cell
      .getParagraphs()
      .filter((p) => p.getNumbering() !== undefined);
    expect(out.length).toBeGreaterThanOrEqual(2);

    const items = out.slice(-2);
    expect(renderedFormat(doc, items[0]!)).toBe("decimal");
    expect(renderedFormat(doc, items[1]!)).toBe("decimal");
  });

  it("keeps a same-numId sub-item at its level when a non-list paragraph splits the list", () => {
    // levelShift regression guard: an interrupting non-list ("Note:") paragraph
    // must not strand the sub-item after it into its own level-shift group,
    // which would flatten it to level 0. Same numId across the gap = same list.
    const doc = Document.create();
    const mgr = doc.getNumberingManager();
    const bulletNumId = mgr.createBulletList();

    const table = doc.createTable(1, 1);
    const cell = table.getRows()[0]!.getCells()[0]!;

    const parent = Paragraph.create("Parent item");
    parent.setNumbering(bulletNumId, 0);
    const subA = Paragraph.create("Sub item A");
    subA.setNumbering(bulletNumId, 1);
    const note = Paragraph.create("Note: an interrupting non-list paragraph");
    const subB = Paragraph.create("Sub item B");
    subB.setNumbering(bulletNumId, 1);

    cell.addParagraph(parent);
    cell.addParagraph(subA);
    cell.addParagraph(note);
    cell.addParagraph(subB);

    const normalizer = new ListNormalizer(mgr);
    normalizer.normalizeAllTables([table], { indentationLevels: [] });

    const byText = (t: string) => cell.getParagraphs().find((p) => p.getText().startsWith(t));

    expect(byText("Parent item")!.getNumbering()?.level).toBe(0);
    expect(byText("Sub item A")!.getNumbering()?.level).toBe(1);
    // Without the fix subB lands in its own group and is flattened to 0.
    expect(byText("Sub item B")!.getNumbering()?.level).toBe(1);
  });
});
