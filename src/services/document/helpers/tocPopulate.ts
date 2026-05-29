/**
 * Populate a Table of Contents with hyperlink entries *in the in-memory model*.
 *
 * WHY THIS EXISTS
 * ---------------
 * `Document.rebuildTOCs()` populates a TOC by writing directly to the raw
 * `word/document.xml` in the zip handler. But on save, `prepareSave()` calls
 * `updateDocumentXml()`, which regenerates `document.xml` from the in-memory
 * `bodyElements` array — discarding any zip-only edits. For an SDT-wrapped TOC
 * that is doubly fatal: the parser stores it as a `TableOfContentsElement`
 * whose `toXML()` always emits ONLY a placeholder run ("Right-click to update
 * field.") between the field's `separate` and `end` chars. The result: every
 * saved document had a TOC field with zero entries.
 *
 * THE FIX (Option B — keep the live, Word-updatable field)
 * --------------------------------------------------------
 * Rather than rely on the SDT element (which cannot hold entry paragraphs in
 * the model), we replace it with a field-based TOC built entirely from model
 * paragraphs, mirroring exactly the structure Word itself produces:
 *
 *   ┌ paragraph (style TOC{minLevel}) ────────────────────────────┐
 *   │  <w:r><w:fldChar w:fldCharType="begin"/></w:r>              │
 *   │  <w:r><w:instrText> TOC \o "1-9" \h \z \u </w:instrText></w:r>│
 *   │  <w:r><w:fldChar w:fldCharType="separate"/></w:r>          │
 *   │  <w:hyperlink w:anchor="_Toc…">…first entry…</w:hyperlink> │
 *   └────────────────────────────────────────────────────────────┘
 *   ┌ paragraph (style TOC{n}) … one per remaining heading ───────┐
 *   │  <w:hyperlink w:anchor="_Toc…">…entry…</w:hyperlink>       │
 *   └────────────────────────────────────────────────────────────┘
 *   ┌ paragraph ──────────────────────────────────────────────────┐
 *   │  <w:r><w:fldChar w:fldCharType="end"/></w:r>               │
 *   └────────────────────────────────────────────────────────────┘
 *
 * Because these are real `Paragraph` objects in `bodyElements`, they survive
 * `updateDocumentXml()` regeneration AND the `begin … separate … end` field
 * keeps Word's "Update Field" right-click working. The entries persist through
 * save+reload while remaining a live updatable field.
 */
import { Bookmark, Document, Hyperlink, Paragraph, Run, type RunFormatting } from "docxmlater";

/** A heading destined for the TOC, with the bookmark its entry links to. */
export interface TocHeading {
  level: number;
  text: string;
  /** Bookmark name (the `w:anchor` target) on the heading paragraph. */
  anchor: string;
}

export interface TocPopulateResult {
  /** Number of hyperlink entry paragraphs inserted. */
  entries: number;
  /** Body index at which the field-based TOC was inserted. */
  insertIndex: number;
  /** The field instruction used for the live TOC field. */
  instruction: string;
}

const HEADING_STYLE_RE = /^Heading\s*(\d+)$/i;

/** Default switches for a clickable, page-number-free TOC. */
const DEFAULT_TOC_INSTRUCTION = 'TOC \\o "1-9" \\h \\z \\u';

/**
 * Collect headings (with their bookmark anchors) in document order.
 *
 * Assumes `ensureHeadingBookmarks()` has already run so every heading carries a
 * bookmark; a heading without one is skipped (it cannot be linked).
 */
export function collectTocHeadings(doc: Document, excludeHeading1: boolean): TocHeading[] {
  const headings: TocHeading[] = [];

  for (const para of doc.getAllParagraphs()) {
    const style = para.getStyle();
    const match = style?.match(HEADING_STYLE_RE);
    if (!match || !match[1]) continue;

    const level = parseInt(match[1], 10);
    if (excludeHeading1 && level === 1) continue;

    const text = para.getText().trim();
    if (!text) continue;

    const anchor = firstBookmarkName(para);
    if (!anchor) continue;

    headings.push({ level, text, anchor });
  }

  return headings;
}

/** Returns the name of the first bookmark on a paragraph, or undefined. */
function firstBookmarkName(para: Paragraph): string | undefined {
  const starts: Bookmark[] = para.getBookmarksStart();
  if (starts && starts.length > 0) return starts[0]!.getName();
  return undefined;
}

/**
 * Build a clickable internal-hyperlink for one TOC entry.
 *
 * Formatting matches docxmlater's own rebuildTOCs() output (Verdana 12pt blue
 * underlined); `formatTOCStyles()` re-applies style-level formatting afterward,
 * but seeding it here keeps the entry correct even before that pass runs.
 */
function buildEntryHyperlink(heading: TocHeading, formatting: RunFormatting): Hyperlink {
  return Hyperlink.createInternal(heading.anchor, heading.text, formatting);
}

/** A run carrying a single `w:fldChar` of the given type. */
function fldCharRun(type: "begin" | "separate" | "end"): Run {
  return Run.createFromContent([{ type: "fieldChar", fieldCharType: type }]);
}

/** A run carrying the field instruction text (e.g. ` TOC \o "1-9" \h \z \u `). */
function instrTextRun(instruction: string): Run {
  // Pad with spaces exactly as Word does, so re-parsing keeps the switches.
  return Run.createFromContent([{ type: "instructionText", value: ` ${instruction.trim()} ` }]);
}

/**
 * Replace the document's existing TOC with a field-based TOC populated with
 * hyperlink entries in the in-memory model.
 *
 * Removes the first existing SDT-wrapped TOC element (if any) and inserts the
 * field-based TOC paragraphs at its body position. If no TOC element exists the
 * caller is expected to have handled placement; in that case nothing is
 * inserted and `entries` is 0.
 *
 * @param doc - Document whose TOC should be populated
 * @param headings - Headings (with bookmark anchors) to list, in order
 * @param entryFormatting - Run formatting applied to each entry hyperlink
 * @returns Summary of what was inserted
 */
export function populateTocInModel(
  doc: Document,
  headings: TocHeading[],
  entryFormatting: RunFormatting
): TocPopulateResult {
  const empty: TocPopulateResult = { entries: 0, insertIndex: -1, instruction: "" };
  if (headings.length === 0) return empty;

  // Locate the existing SDT-wrapped TOC element and capture its title/switches
  // so the rebuilt field keeps the same instruction (e.g. \o "2-9" after the
  // exclude-Heading-1 modification) and Word's "Update Field" stays meaningful.
  const tocElements = doc.getTableOfContentsElements();
  const bodyElements = doc.getBodyElements();

  let insertIndex = -1;
  let instruction = DEFAULT_TOC_INSTRUCTION;

  if (tocElements.length > 0) {
    const tocElement = tocElements[0]!;
    const tocIndex = bodyElements.indexOf(tocElement);
    if (tocIndex !== -1) {
      const toc = tocElement.getTableOfContents();
      instruction = toc.getOriginalFieldInstruction() || toc.getFieldInstruction() || instruction;
      doc.removeTocAt(tocIndex);
      insertIndex = tocIndex;
    }
  }

  if (insertIndex === -1) return { ...empty, instruction };

  // First entry paragraph carries the field opener (begin/instr/separate).
  const paragraphs: Paragraph[] = [];
  const first = headings[0]!;
  const firstPara = new Paragraph();
  firstPara.setStyle(`TOC${first.level}`);
  firstPara.addRun(fldCharRun("begin"));
  firstPara.addRun(instrTextRun(instruction));
  firstPara.addRun(fldCharRun("separate"));
  firstPara.addHyperlink(buildEntryHyperlink(first, entryFormatting));
  paragraphs.push(firstPara);

  // Remaining entries are plain TOC{n}-styled hyperlink paragraphs.
  for (let i = 1; i < headings.length; i++) {
    const heading = headings[i]!;
    const para = new Paragraph();
    para.setStyle(`TOC${heading.level}`);
    para.addHyperlink(buildEntryHyperlink(heading, entryFormatting));
    paragraphs.push(para);
  }

  // Closing paragraph carries the field terminator (end). Word keeps the field
  // result spanning every paragraph between separate and end. It is left
  // UN-styled (no TOC{n}) on purpose so the leader/entry-cleaning passes and
  // single-level-flatten detection don't treat this terminator as an entry.
  const endPara = new Paragraph();
  endPara.addRun(fldCharRun("end"));
  paragraphs.push(endPara);

  for (let i = 0; i < paragraphs.length; i++) {
    doc.insertParagraphAt(insertIndex + i, paragraphs[i]!);
  }

  return { entries: headings.length, insertIndex, instruction };
}
