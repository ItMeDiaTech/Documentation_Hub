/**
 * Tests for src/services/document/helpers/applyRunFormattingPreservingHyperlink.ts
 *
 * Locks in the field-level diffing and hyperlink-restoration behavior
 * introduced in Task 8 (and the italic extension in Task 8 follow-up).
 */

import type { Run } from "docxmlater";
import { applyRunFmtPreservingHyperlink } from "../applyRunFormattingPreservingHyperlink";

type Fmt = {
  font?: string;
  size?: number;
  bold?: boolean;
  italic?: boolean;
  color?: string;
  underline?: string;
  characterStyle?: string;
};

function makeRun(fmt: Fmt): jest.Mocked<Run> {
  return {
    getFormatting: jest.fn().mockReturnValue(fmt),
    setFont: jest.fn(),
    setSize: jest.fn(),
    setBold: jest.fn(),
    setItalic: jest.fn(),
    setColor: jest.fn(),
    setUnderline: jest.fn(),
  } as unknown as jest.Mocked<Run>;
}

describe("applyRunFmtPreservingHyperlink", () => {
  it("no-op when font/size already match and not a hyperlink", () => {
    const run = makeRun({
      font: "Verdana",
      size: 12,
      characterStyle: "Normal",
      color: "000000",
    });
    applyRunFmtPreservingHyperlink(run, "Verdana", 12);
    expect(run.setFont).not.toHaveBeenCalled();
    expect(run.setSize).not.toHaveBeenCalled();
    expect(run.setBold).not.toHaveBeenCalled();
    expect(run.setItalic).not.toHaveBeenCalled();
    expect(run.setColor).not.toHaveBeenCalled();
    expect(run.setUnderline).not.toHaveBeenCalled();
  });

  it("writes font and size when they differ", () => {
    const run = makeRun({ font: "Arial", size: 14, characterStyle: "Normal" });
    applyRunFmtPreservingHyperlink(run, "Verdana", 12);
    expect(run.setFont).toHaveBeenCalledWith("Verdana");
    expect(run.setSize).toHaveBeenCalledWith(12);
  });

  it("skips font/size when already matching", () => {
    const run = makeRun({ font: "Verdana", size: 12, characterStyle: "Normal" });
    applyRunFmtPreservingHyperlink(run, "Verdana", 12);
    expect(run.setFont).not.toHaveBeenCalled();
    expect(run.setSize).not.toHaveBeenCalled();
  });

  it("writes bold when opts.bold differs from current", () => {
    const run = makeRun({ font: "Verdana", size: 12, bold: false });
    applyRunFmtPreservingHyperlink(run, "Verdana", 12, { bold: true });
    expect(run.setBold).toHaveBeenCalledWith(true);
  });

  it("skips bold when opts.bold matches current", () => {
    const run = makeRun({ font: "Verdana", size: 12, bold: true });
    applyRunFmtPreservingHyperlink(run, "Verdana", 12, { bold: true });
    expect(run.setBold).not.toHaveBeenCalled();
  });

  it("restores hyperlink color and underline when characterStyle is Hyperlink and values differ", () => {
    const run = makeRun({
      font: "Arial",
      size: 14,
      characterStyle: "Hyperlink",
      color: "000000",
      underline: "none",
    });
    applyRunFmtPreservingHyperlink(run, "Verdana", 12);
    expect(run.setColor).toHaveBeenCalledWith("0000FF");
    expect(run.setUnderline).toHaveBeenCalledWith("single");
  });

  it("does not rewrite hyperlink color/underline when already correct", () => {
    const run = makeRun({
      font: "Verdana",
      size: 12,
      characterStyle: "Hyperlink",
      color: "0000FF",
      underline: "single",
    });
    applyRunFmtPreservingHyperlink(run, "Verdana", 12);
    expect(run.setColor).not.toHaveBeenCalled();
    expect(run.setUnderline).not.toHaveBeenCalled();
  });

  it("detects hyperlink via canonical color 0563C1 when characterStyle is missing", () => {
    const run = makeRun({ font: "Arial", size: 14, color: "0563C1" });
    applyRunFmtPreservingHyperlink(run, "Verdana", 12);
    expect(run.setColor).toHaveBeenCalledWith("0000FF");
    expect(run.setUnderline).toHaveBeenCalledWith("single");
  });

  it("detects hyperlink via lower-case canonical color (case-insensitive)", () => {
    const run = makeRun({ font: "Arial", size: 14, color: "0000ff" });
    applyRunFmtPreservingHyperlink(run, "Verdana", 12);
    expect(run.setColor).not.toHaveBeenCalledWith("0000FF"); // already correct after uppercase comparison
    // already 0000ff → uppercased to 0000FF → matches target, no setColor
    // (defensive: assert specifically that setUnderline still runs when current isn't 'single')
    expect(run.setUnderline).toHaveBeenCalledWith("single");
  });

  it("applies italic when opts.italic is set and current value differs", () => {
    const run = makeRun({
      font: "Verdana",
      size: 12,
      italic: true,
      characterStyle: "Normal",
    });
    applyRunFmtPreservingHyperlink(run, "Verdana", 12, { italic: false });
    expect(run.setItalic).toHaveBeenCalledWith(false);
  });

  it("skips italic when opts.italic matches current", () => {
    const run = makeRun({ font: "Verdana", size: 12, italic: false });
    applyRunFmtPreservingHyperlink(run, "Verdana", 12, { italic: false });
    expect(run.setItalic).not.toHaveBeenCalled();
  });

  it("italic-only change still triggers hyperlink restoration", () => {
    // Per Task 8 follow-up: setItalic can also drop <w:color>/<w:u>, so the
    // restoration branch must fire on every Hyperlink-styled run we touched.
    const run = makeRun({
      font: "Verdana",
      size: 12,
      italic: true,
      characterStyle: "Hyperlink",
      color: "000000",
      underline: "none",
    });
    applyRunFmtPreservingHyperlink(run, "Verdana", 12, { italic: false });
    expect(run.setItalic).toHaveBeenCalledWith(false);
    expect(run.setColor).toHaveBeenCalledWith("0000FF");
    expect(run.setUnderline).toHaveBeenCalledWith("single");
  });
});
