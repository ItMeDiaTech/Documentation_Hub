/**
 * @jest-environment node
 *
 * restampMixedListBulletFonts must restore the correct Word-native font on a
 * bullet sub-level whose font was clobbered (e.g. by standardizeNumberedListPrefixes
 * forcing Verdana onto every level). Covers the filled disc, open circle, and —
 * the H1 case — the Wingdings filled square.
 */

import { Document, WORD_NATIVE_BULLETS } from "docxmlater";
import { restampMixedListBulletFonts } from "../ListNormalizer";

function makeBulletSubLevel(
  bullet: { char: string; font: string }
): { doc: Document; absId: number; getFont: () => string | undefined } {
  const doc = Document.create();
  const mgr = doc.getNumberingManager();
  const numId = mgr.createNumberedList();
  const inst = mgr.getInstance(numId)!;
  const abs = mgr.getAbstractNumbering(inst.getAbstractNumId())!;
  const lvl2 = abs.getLevel(2)!;
  lvl2.setFormat("bullet");
  lvl2.setText(bullet.char);
  lvl2.setFont("Verdana"); // simulate the clobber
  mgr.addAbstractNumbering(abs);
  return {
    doc,
    absId: abs.getAbstractNumId(),
    getFont: () => abs.getLevel(2)!.getProperties().font,
  };
}

describe("restampMixedListBulletFonts", () => {
  it("restores the Wingdings font on a clobbered square bullet sub-level (H1)", () => {
    const { doc, absId, getFont } = makeBulletSubLevel(WORD_NATIVE_BULLETS.FILLED_SQUARE);
    expect(getFont()).toBe("Verdana");

    const restored = restampMixedListBulletFonts(doc, new Set([absId]));

    expect(restored).toBe(1);
    expect(getFont()).toBe(WORD_NATIVE_BULLETS.FILLED_SQUARE.font); // "Wingdings"
    doc.dispose();
  });

  it("restores the Symbol font on a clobbered filled-disc bullet sub-level", () => {
    const { doc, absId, getFont } = makeBulletSubLevel(WORD_NATIVE_BULLETS.FILLED_BULLET);
    const restored = restampMixedListBulletFonts(doc, new Set([absId]));
    expect(restored).toBe(1);
    expect(getFont()).toBe(WORD_NATIVE_BULLETS.FILLED_BULLET.font); // "Symbol"
    doc.dispose();
  });

  it("leaves numbered levels untouched", () => {
    const doc = Document.create();
    const mgr = doc.getNumberingManager();
    const numId = mgr.createNumberedList();
    const inst = mgr.getInstance(numId)!;
    const abs = mgr.getAbstractNumbering(inst.getAbstractNumId())!;
    abs.getLevel(0)!.setFont("Verdana");
    mgr.addAbstractNumbering(abs);

    restampMixedListBulletFonts(doc, new Set([abs.getAbstractNumId()]));

    // Level 0 is decimal (not bullet) — its font is not changed by the restamp.
    expect(abs.getLevel(0)!.getProperties().font).toBe("Verdana");
    doc.dispose();
  });
});
