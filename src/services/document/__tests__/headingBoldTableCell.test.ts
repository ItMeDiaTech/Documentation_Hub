/**
 * Regression: the standardized Heading 3 style is bold (correct for real
 * headings), but Heading 3 is often reused as BODY text inside table cells
 * (e.g. the first column of an "If.../Then..." table). Those cells must not
 * inherit the heading's bold. applyCustomStylesFromUI emits an explicit
 * non-bold override on Heading 3 runs inside table cells, while leaving real
 * (non-table) headings bold.
 */
import { Document, Paragraph } from "docxmlater";
import { WordDocumentProcessor } from "../WordDocumentProcessor";

jest.mock("../../HyperlinkService");
jest.mock("@/utils/logger", () => ({
  logger: { namespace: () => ({ info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() }) },
  startTimer: () => ({ end: () => 0, elapsed: () => 0 }),
  debugModes: {},
  isDebugEnabled: () => false,
}));

const mk = (id: string, name: string, bold: boolean) => ({
  id, name, fontFamily: "Verdana", fontSize: 12, bold, italic: false, underline: false,
  alignment: "left" as const, color: "#000000", spaceBefore: 0, spaceAfter: 0, lineSpacing: 1,
});
const STYLES = [
  mk("header1", "Heading 1", true),
  mk("header2", "Heading 2", true),
  mk("header3", "Heading 3", true),
  mk("normal", "Normal", false),
  mk("listParagraph", "List Paragraph", false),
];

function runBolds(para: Paragraph): Array<boolean | undefined> {
  return para.getRuns().map((r) => r.getFormatting().bold);
}

describe("Heading 3 bold neutralization in table cells", () => {
  it("keeps real headings bold but forces Heading 3 table-cell text non-bold", async () => {
    const doc = Document.create();

    // A real Heading 3 heading in the body (should stay bold).
    const realHeading = doc.createParagraph("Real Section Heading");
    realHeading.setStyle("Heading3");

    // A table whose cell uses Heading 3 as body text (should NOT be bold).
    const table = doc.createTable(1, 1);
    const cellPara = table.getCell(0, 0)!.createParagraph("Member is a Medicare member");
    cellPara.setStyle("Heading3");

    const proc = new WordDocumentProcessor();
    await (
      proc as unknown as {
        applyCustomStylesFromUI(d: Document, s: typeof STYLES): Promise<unknown>;
      }
    ).applyCustomStylesFromUI(doc, STYLES);

    // The Heading 3 style definition itself remains bold (for real headings).
    expect(doc.getStyle("Heading3")?.getRunFormatting()?.bold).toBe(true);

    // The table-cell Heading 3 run has an explicit non-bold override.
    const cellBolds = runBolds(cellPara);
    expect(cellBolds.length).toBeGreaterThan(0);
    for (const b of cellBolds) expect(b).toBe(false);

    // The real (non-table) heading was NOT neutralized (it inherits the style's
    // bold — its runs must not carry an explicit bold=false).
    for (const b of runBolds(realHeading)) expect(b).not.toBe(false);

    doc.dispose();
  });
});
