/**
 * Tests for src/services/document/helpers/tocCleanEntries.ts.
 *
 * Verifies that dotted tab leaders and page numbers are stripped from
 * field-based TOC entries, leaving clean hyperlink-only entries.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* globals jest, describe, it, expect */

jest.mock("docxmlater", () => {
  return {
    Document: class {},
    Run: class {},
    isRun: (item: any) => item?.__kind === "run",
    isHyperlink: (item: any) => item?.__kind === "hyperlink",
  };
});

import { cleanTocEntries } from "../tocCleanEntries";

interface ContentItem {
  type: string;
  value?: string;
}

function makeRun(content: ContentItem[]) {
  const run: any = {
    __kind: "run",
    _content: content,
    getContent() {
      return run._content;
    },
    setText(text: string) {
      run._content = [{ type: "text", value: text }];
    },
  };
  return run;
}

function makeHyperlink(run: any) {
  return { __kind: "hyperlink", getRun: () => run };
}

function makeParagraph(style: string, content: any[]) {
  const para: any = {
    _tabs: [{ val: "right", leader: "dot", position: 9350 }],
    getStyle: () => style,
    getContent: () => content,
    setTabs(tabs: any[]) {
      para._tabs = tabs;
    },
  };
  return para;
}

function makeDoc(paras: any[]) {
  return { getAllParagraphs: () => paras } as any;
}

/** Content of a field-based TOC entry: text + tab + cached page number "1". */
function fieldEntryContent(heading: string) {
  return [
    { type: "text", value: heading },
    { type: "tab" },
    { type: "text", value: "1" },
  ];
}

describe("cleanTocEntries", () => {
  it("strips tab + page number from a hyperlink entry, keeping heading text", () => {
    const run = makeRun(fieldEntryContent("Important Reminders"));
    const para = makeParagraph("TOC2", [makeHyperlink(run)]);
    const result = cleanTocEntries(makeDoc([para]));

    expect(result.paragraphs).toBe(1);
    expect(result.runsCleaned).toBe(1);
    expect(run.getContent()).toEqual([{ type: "text", value: "Important Reminders" }]);
  });

  it("clears the dotted-leader tab stop on the entry paragraph", () => {
    const para = makeParagraph("TOC2", [makeHyperlink(makeRun(fieldEntryContent("X")))]);
    cleanTocEntries(makeDoc([para]));
    expect(para._tabs).toEqual([]);
  });

  it("leaves a plain-text hyperlink entry untouched", () => {
    const run = makeRun([{ type: "text", value: "No Page Number Here" }]);
    const para = makeParagraph("TOC3", [makeHyperlink(run)]);
    const result = cleanTocEntries(makeDoc([para]));

    expect(result.runsCleaned).toBe(0);
    expect(run.getContent()).toEqual([{ type: "text", value: "No Page Number Here" }]);
  });

  it("does not touch TOC field-instruction runs (begin/instrText/separate)", () => {
    const begin = makeRun([{ type: "fieldChar" }]);
    const instr = makeRun([{ type: "instructionText", value: ' TOC \\o "2-2" \\h \\z \\u ' }]);
    const separate = makeRun([{ type: "fieldChar" }]);
    const entryRun = makeRun(fieldEntryContent("First Heading"));
    const para = makeParagraph("TOC2", [begin, instr, separate, makeHyperlink(entryRun)]);

    const result = cleanTocEntries(makeDoc([para]));

    expect(result.runsCleaned).toBe(1); // only the hyperlink entry run
    expect(instr.getContent()).toEqual([
      { type: "instructionText", value: ' TOC \\o "2-2" \\h \\z \\u ' },
    ]);
    expect(begin.getContent()).toEqual([{ type: "fieldChar" }]);
    expect(entryRun.getContent()).toEqual([{ type: "text", value: "First Heading" }]);
  });

  it("strips a page number carried in a bare run alongside the hyperlink", () => {
    const hyperlinkRun = makeRun([{ type: "text", value: "Heading Text" }]);
    const trailingRun = makeRun([{ type: "tab" }, { type: "text", value: "12" }]);
    const para = makeParagraph("TOC2", [makeHyperlink(hyperlinkRun), trailingRun]);

    const result = cleanTocEntries(makeDoc([para]));

    expect(result.runsCleaned).toBe(1);
    expect(trailingRun.getContent()).toEqual([{ type: "text", value: "" }]);
  });

  it("ignores non-TOC paragraphs", () => {
    const para = makeParagraph("Normal", [makeHyperlink(makeRun(fieldEntryContent("X")))]);
    const result = cleanTocEntries(makeDoc([para]));
    expect(result.paragraphs).toBe(0);
    expect(result.runsCleaned).toBe(0);
  });

  it("handles multiple TOC entries in one document", () => {
    const runs = [
      makeRun(fieldEntryContent("Alpha")),
      makeRun(fieldEntryContent("Beta")),
      makeRun(fieldEntryContent("Gamma")),
    ];
    const paras = runs.map((r) => makeParagraph("TOC2", [makeHyperlink(r)]));
    const result = cleanTocEntries(makeDoc(paras));

    expect(result.paragraphs).toBe(3);
    expect(result.runsCleaned).toBe(3);
    expect(runs.map((r) => r.getText?.() ?? r.getContent()[0].value)).toEqual([
      "Alpha",
      "Beta",
      "Gamma",
    ]);
  });
});
