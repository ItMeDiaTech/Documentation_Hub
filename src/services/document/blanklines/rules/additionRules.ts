/**
 * Addition Rules - Define when blank lines must be ADDED or preserved.
 *
 * Addition rules are checked after removal rules. If an addition rule matches
 * a position and no blank exists there, one is added.
 *
 * Each rule's matches() checks the context to determine if a blank line
 * should exist at the position AFTER the current element.
 */

import { Paragraph, Table } from "docxmlater";
import type { BlankLineRule, RuleContext } from "./ruleTypes";
import { isParagraphBlank, isTocParagraph, startsWithBoldColon, getEffectiveLeftIndent, hasNavigationHyperlink } from "../helpers/paragraphChecks";
import { getImageRunFromParagraph, isImageSmall, isSmallImageParagraph } from "../helpers/imageChecks";

/**
 * Add blank line after Heading 1 style text.
 */
export const afterHeading1Rule: BlankLineRule = {
  id: "add-after-heading1",
  action: "add",
  scope: "body",
  matches(ctx: RuleContext): boolean {
    if (ctx.scope !== "body") return false;
    if (!(ctx.currentElement instanceof Paragraph)) return false;

    const style = ctx.currentElement.getStyle();
    if (style !== "Heading1") return false;
    if (ctx.currentElement.getText().trim() === "") return false;

    // Want a blank AFTER this heading
    return true;
  },
};

/**
 * Add blank line after the Table of Contents.
 * Detects both TOC elements and TOC-styled paragraphs.
 */
export const afterTocRule: BlankLineRule = {
  id: "add-after-toc",
  action: "add",
  scope: "body",
  matches(ctx: RuleContext): boolean {
    if (ctx.scope !== "body") return false;
    if (!(ctx.currentElement instanceof Paragraph)) return false;

    // Current must be a TOC paragraph
    if (!isTocParagraph(ctx.currentElement)) return false;

    // Next must NOT be a TOC paragraph (this is the last TOC entry)
    if (ctx.nextElement instanceof Paragraph && isTocParagraph(ctx.nextElement)) {
      return false;
    }

    return true;
  },
};

/**
 * Add blank line before the first 1x1 table in the document.
 */
export const beforeFirst1x1TableRule: BlankLineRule = {
  id: "add-before-first-1x1-table",
  action: "add",
  scope: "body",
  matches(ctx: RuleContext): boolean {
    if (ctx.scope !== "body") return false;

    // Current element must be a paragraph (the blank would go before the table,
    // but we check from the perspective of "should there be a blank between prev and next")
    // This rule is handled specially in the engine - it checks if nextElement is the first 1x1 table
    if (!(ctx.currentElement instanceof Paragraph)) return false;

    if (ctx.nextElement instanceof Table) {
      const rowCount = ctx.nextElement.getRowCount();
      const colCount = ctx.nextElement.getColumnCount();
      if (rowCount === 1 && colCount === 1) {
        // Check if this is the first 1x1 table in the document
        const doc = ctx.doc;
        for (let i = 0; i < ctx.currentIndex; i++) {
          const el = doc.getBodyElementAt(i);
          if (el instanceof Table) {
            const r = el.getRowCount();
            const c = el.getColumnCount();
            if (r === 1 && c === 1) {
              return false; // Not the first 1x1 table
            }
          }
        }
        return true; // This is before the first 1x1 table
      }
    }
    return false;
  },
};

/**
 * Add blank line after 1x1 tables.
 */
export const after1x1TablesRule: BlankLineRule = {
  id: "add-after-1x1-tables",
  action: "add",
  scope: "body",
  matches(ctx: RuleContext): boolean {
    if (ctx.scope !== "body") return false;
    if (!(ctx.currentElement instanceof Table)) return false;

    const rowCount = ctx.currentElement.getRowCount();
    const colCount = ctx.currentElement.getColumnCount();

    return rowCount === 1 && colCount === 1;
  },
};

/**
 * Add blank line after tables larger than 1x1.
 */
export const afterLargeTablesRule: BlankLineRule = {
  id: "add-after-large-tables",
  action: "add",
  scope: "body",
  matches(ctx: RuleContext): boolean {
    if (ctx.scope !== "body") return false;
    if (!(ctx.currentElement instanceof Table)) return false;

    const rowCount = ctx.currentElement.getRowCount();
    const colCount = ctx.currentElement.getColumnCount();

    return rowCount > 1 || colCount > 1;
  },
};

/**
 * Add blank line ABOVE bold+colon non-indented paragraphs.
 * Checks ctx.nextElement to see if the upcoming paragraph starts with bold text + colon.
 */
export const aboveBoldColonNoIndentRule: BlankLineRule = {
  id: "add-above-bold-colon-no-indent",
  action: "add",
  scope: "both",
  matches(ctx: RuleContext): boolean {
    if (!(ctx.nextElement instanceof Paragraph)) return false;
    if (isParagraphBlank(ctx.nextElement)) return false;
    if (!startsWithBoldColon(ctx.nextElement)) return false;
    if (ctx.nextElement.getNumbering()) return false;

    const indent = ctx.nextElement.getFormatting()?.indentation?.left;
    if (indent && indent > 0) return false;

    return true;
  },
};

/**
 * Bold+colon with no indentation where next line is NOT indented:
 * add blank after, UNLESS there is a 1x1 table with "Related Document"
 * text within 15 lines above.
 */
export const boldColonNoIndentAfterRule: BlankLineRule = {
  id: "add-after-bold-colon-no-indent",
  action: "add",
  scope: "both",
  matches(ctx: RuleContext): boolean {
    if (!(ctx.currentElement instanceof Paragraph)) return false;
    if (isParagraphBlank(ctx.currentElement)) return false;
    if (!startsWithBoldColon(ctx.currentElement)) return false;

    // Must not be a list item
    if (ctx.currentElement.getNumbering()) return false;

    // Must have no indentation
    const indent = ctx.currentElement.getFormatting()?.indentation?.left;
    if (indent && indent > 0) return false;

    // Next line must NOT be indented and NOT be a list item
    if (ctx.nextElement instanceof Paragraph) {
      if (ctx.nextElement.getNumbering()) return false;
      const nextIndent = ctx.nextElement.getFormatting()?.indentation?.left;
      if (nextIndent && nextIndent > 0) return false;
    }

    // Check for "Related Document" 1x1 table within 15 lines above
    if (ctx.scope === "body") {
      const lookbackLimit = Math.max(0, ctx.currentIndex - 15);
      for (let i = ctx.currentIndex - 1; i >= lookbackLimit; i--) {
        const el = ctx.doc.getBodyElementAt(i);
        if (el instanceof Table) {
          const r = el.getRowCount();
          const c = el.getColumnCount();
          if (r === 1 && c === 1) {
            try {
              const cell = el.getCell(0, 0);
              if (cell) {
                const cellText = cell
                  .getParagraphs()
                  .map((p) => p.getText())
                  .join(" ")
                  .toLowerCase();
                if (cellText.includes("related document")) {
                  return false; // Skip - Related Document table nearby
                }
              }
            } catch {
              // Skip if cell access fails
            }
          }
        }
      }
    }

    return true;
  },
};

/**
 * Add blank line ABOVE navigation hyperlinks (text starts with "Top of" or "Return to").
 */
export const aboveTopOfDocHyperlinkRule: BlankLineRule = {
  id: "add-above-top-of-doc-hyperlink",
  action: "add",
  scope: "body",
  matches(ctx: RuleContext): boolean {
    if (ctx.scope !== "body") return false;
    if (!(ctx.nextElement instanceof Paragraph)) return false;
    return hasNavigationHyperlink(ctx.nextElement);
  },
};

/**
 * Add blank line after list items ONLY when the next line is NOT indented text.
 */
export const afterListItemsRule: BlankLineRule = {
  id: "add-after-list-items",
  action: "add",
  scope: "both",
  matches(ctx: RuleContext): boolean {
    if (!(ctx.currentElement instanceof Paragraph)) return false;
    if (!ctx.currentElement.getNumbering()) return false;

    // This is a list item - check if it's the LAST in its sequence
    if (ctx.nextElement instanceof Paragraph) {
      // If next is also a list item, don't add blank
      if (ctx.nextElement.getNumbering()) return false;

      // If next is a centered image, always add blank
      if (ctx.nextElement.getAlignment() === "center") {
        const imageRun = getImageRunFromParagraph(ctx.nextElement);
        if (imageRun) return true;
      }

      // If next is indented text, don't add blank
      // Use getEffectiveLeftIndent to also check style-inherited indentation
      // (e.g., ListParagraph style defines w:left="720" but paragraph may have no direct w:ind)
      const nextIndent = getEffectiveLeftIndent(ctx.nextElement, ctx.doc);
      if (nextIndent > 0) return false;

      // If next is a small image paragraph with indentation, don't add blank
      if (isSmallImageParagraph(ctx.nextElement)) {
        const imgIndent = getEffectiveLeftIndent(ctx.nextElement, ctx.doc);
        if (imgIndent > 0) return false;
      }
    }

    // Next is not indented text/list, so we need a blank after this list item
    return true;
  },
};

/**
 * Add blank line above and below images larger than 100x100 pixels.
 * In table cells, do not add blank after if image is the last element.
 */
export const aboveAndBelowLargeImagesRule: BlankLineRule = {
  id: "add-around-large-images",
  action: "add",
  scope: "both",
  matches(ctx: RuleContext): boolean {
    if (!(ctx.currentElement instanceof Paragraph)) return false;
    if (isParagraphBlank(ctx.currentElement)) return false;

    const imageRun = getImageRunFromParagraph(ctx.currentElement);
    if (!imageRun) return false;

    const image = imageRun.getImageElement();
    if (isImageSmall(image)) return false;

    // Large image - blank needed above and below
    // (The engine will handle checking both directions)
    return true;
  },
};

/**
 * Add blank line above the end-of-document warning/disclaimer.
 * Matches the specific two-line disclaimer:
 *   "Not to Be Reproduced or Disclosed to Others Without Prior Written Approval"
 *   "ELECTRONIC DATA = OFFICIAL VERSION - PAPER COPY = INFORMATIONAL ONLY"
 */
export const aboveWarningRule: BlankLineRule = {
  id: "add-above-warning",
  action: "add",
  scope: "body",
  matches(ctx: RuleContext): boolean {
    if (ctx.scope !== "body") return false;

    // Check if next element is the document disclaimer
    if (!(ctx.nextElement instanceof Paragraph)) return false;

    const nextText = ctx.nextElement.getText().trim().toLowerCase();
    if (!nextText) return false;

    const isDisclaimer =
      nextText.includes("not to be reproduced") ||
      nextText.includes("electronic data") ||
      nextText.includes("paper copy = informational only");

    return isDisclaimer;
  },
};

/**
 * All addition rules in evaluation order.
 */
export const additionRules: BlankLineRule[] = [
  afterHeading1Rule,
  afterTocRule,
  beforeFirst1x1TableRule,
  after1x1TablesRule,
  afterLargeTablesRule,
  aboveBoldColonNoIndentRule,
  boldColonNoIndentAfterRule,
  aboveTopOfDocHyperlinkRule,
  afterListItemsRule,
  aboveAndBelowLargeImagesRule,
  aboveWarningRule,
];
