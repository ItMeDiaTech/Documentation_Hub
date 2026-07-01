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
import {
  isParagraphBlank,
  isTocParagraph,
  startsWithBoldColon,
  getEffectiveLeftIndent,
  hasNavigationHyperlink,
  isHyperlinkOnlyParagraph,
} from "../helpers/paragraphChecks";
import {
  getImageRunFromParagraph,
  getVisibleImageRunFromParagraph,
  isImageSmall,
  isSmallImageParagraph,
  isSmallImageTextCalloutParagraph,
} from "../helpers/imageChecks";
import { isWithinListContext } from "../helpers/contextChecks";

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
 * Check if a paragraph is a bold-colon non-indented, non-list paragraph.
 */
function isBoldColonNoIndent(para: Paragraph): boolean {
  if (isParagraphBlank(para)) return false;
  if (!startsWithBoldColon(para)) return false;
  if (para.getNumbering()) return false;
  const indent = para.getFormatting()?.indentation?.left;
  if (indent && indent > 0) return false;
  return true;
}

/**
 * Whether a paragraph begins an "Example:" / "Examples:" block. Such a block
 * is a standalone illustration, not inline list commentary like "Note:" — so
 * it keeps its blank line above even when it directly follows a list item.
 */
function startsWithExample(para: Paragraph): boolean {
  return /^examples?\b/i.test(para.getText().trim());
}

/**
 * Check if the upcoming bold-colon paragraph (ctx.nextElement) is a continuation
 * of a list — i.e. it directly follows a list item, or it sits within a list
 * context (a list item before AND after it sharing the same numId).
 *
 * Such a bold-colon paragraph ("Note:", "Result:") belongs to the preceding
 * list item as inline commentary and must NOT get a blank line above it. This
 * is scoped narrowly: a bold-colon paragraph in plain body prose (no list item
 * directly before it) still receives its blank.
 */
function boldColonFollowsListItem(ctx: RuleContext): boolean {
  // Direct predecessor is a list item.
  if (ctx.currentElement instanceof Paragraph && ctx.currentElement.getNumbering()) {
    return true;
  }

  // Predecessor is a blank but the element before that is a list item, or the
  // bold-colon paragraph is sandwiched between two list items of the same list.
  if (ctx.scope === "cell" && ctx.cellParagraphs && ctx.cellParaIndex !== undefined) {
    const nextParaIndex = ctx.cellParaIndex + 1;
    const paras = ctx.cellParagraphs;
    for (let i = nextParaIndex - 1; i >= 0; i--) {
      const p = paras[i];
      if (!p) continue;
      if (isParagraphBlank(p)) continue;
      return !!p.getNumbering();
    }
    return false;
  }

  if (ctx.scope === "body") {
    const nextIndex = ctx.currentIndex + 1;
    for (let i = nextIndex - 1; i >= 0; i--) {
      const el = ctx.doc.getBodyElementAt(i);
      if (el instanceof Table) return false;
      if (!(el instanceof Paragraph)) continue;
      if (isParagraphBlank(el)) continue;
      if (el.getNumbering()) return true;
      // First non-blank, non-list predecessor — also accept within-list-context.
      return isWithinListContext(ctx.doc, nextIndex);
    }
  }

  return false;
}

/**
 * Check if the position is inside a "Related Documents" section — i.e. within
 * 15 body elements below either:
 *   • a 1x1 table whose cell text contains "related document", or
 *   • a Heading-2 styled paragraph whose text is "Related Documents".
 *
 * The "Related Documents" section lists reference links and a parent-document
 * line; those entries are kept tight (no blank lines between them).
 */
function hasRelatedDocumentTableNearby(ctx: RuleContext): boolean {
  if (ctx.scope !== "body") return false;
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
              return true;
            }
          }
        } catch {
          // Skip if cell access fails
        }
      }
    } else if (el instanceof Paragraph) {
      // A Heading-2 "Related Documents" paragraph also opens the section.
      const style = el.getStyle() || "";
      if (style === "Heading2" && el.getText().trim().toLowerCase() === "related documents") {
        return true;
      }
    }
  }
  return false;
}

/**
 * Within the Related Documents section, a paragraph counts as a section "item"
 * (a reference link, the parent-document line, etc.) unless it is the
 * end-of-document disclaimer or a "Top of the Document" navigation hyperlink —
 * those two still get a blank line above them.
 */
function isRelatedDocumentsItem(para: Paragraph): boolean {
  if (isParagraphBlank(para)) return false;
  if (hasNavigationHyperlink(para)) return false;
  const text = para.getText().trim().toLowerCase();
  const isDisclaimer =
    text.includes("not to be reproduced") ||
    text.includes("electronic data") ||
    text.includes("paper copy = informational only");
  return !isDisclaimer;
}

/**
 * Add blank line ABOVE bold+colon non-indented paragraphs.
 * Checks ctx.nextElement to see if the upcoming paragraph starts with bold text + colon.
 * Near a Related Documents table, suppresses blank between consecutive bold-colon entries
 * but allows blank above the first entry.
 */
export const aboveBoldColonNoIndentRule: BlankLineRule = {
  id: "add-above-bold-colon-no-indent",
  action: "add",
  scope: "both",
  matches(ctx: RuleContext): boolean {
    if (!(ctx.nextElement instanceof Paragraph)) return false;
    if (!isBoldColonNoIndent(ctx.nextElement)) return false;

    // A bold-colon paragraph that directly follows a list item (or sits within
    // a list context) is inline commentary belonging to that list item — e.g.
    // a "Note:" after a numbered procedure step. It must stay tight against the
    // list, with no blank above it. Bold-colon paragraphs in plain body prose
    // (no list item before them) still receive their blank for separation.
    // EXCEPTION: an "Example:" block is a standalone illustration, not inline
    // commentary — it keeps its blank line even after a list item.
    if (boldColonFollowsListItem(ctx) && !startsWithExample(ctx.nextElement)) return false;

    // Inside the Related Documents section: suppress the blank above a
    // bold-colon entry (e.g. "Parent Document: ...") when the element above it
    // is another section item (a reference link or another bold-colon line).
    // The disclaimer and the "Top of the Document" hyperlink still get their
    // blanks via aboveWarningRule / aboveTopOfDocHyperlinkRule.
    if (hasRelatedDocumentTableNearby(ctx)) {
      if (ctx.currentElement instanceof Paragraph && isRelatedDocumentsItem(ctx.currentElement)) {
        return false;
      }
      return true;
    }

    return true;
  },
};

/**
 * Bold+colon with no indentation: add blank after.
 * Near a Related Documents table, only add blank after the LAST consecutive
 * bold-colon entry (suppress between entries).
 */
export const boldColonNoIndentAfterRule: BlankLineRule = {
  id: "add-after-bold-colon-no-indent",
  action: "add",
  scope: "both",
  matches(ctx: RuleContext): boolean {
    if (!(ctx.currentElement instanceof Paragraph)) return false;
    if (!isBoldColonNoIndent(ctx.currentElement)) return false;

    // Centered bold-colon + centered next = visually-grouped pair (e.g. a
    // centered "Example:" label above a centered figure). The blank above
    // the centered next is already suppressed by aboveAndBelowLargeImagesRule's
    // centered-prev guard, but this rule would otherwise insert the blank
    // first and steal that suppression.
    if (
      ctx.currentElement.getAlignment() === "center" &&
      ctx.nextElement instanceof Paragraph &&
      ctx.nextElement.getAlignment() === "center"
    ) {
      return false;
    }

    // Next line must NOT be indented and NOT be a list item
    if (ctx.nextElement instanceof Paragraph) {
      if (ctx.nextElement.getNumbering()) return false;
      const nextIndent = getEffectiveLeftIndent(ctx.nextElement, ctx.doc);
      if (nextIndent > 0) return false;
    }

    // Inside the Related Documents section: suppress the blank after a
    // bold-colon entry when the next element is another section item. The
    // disclaimer and "Top of the Document" hyperlink still get their blank
    // above via aboveWarningRule / aboveTopOfDocHyperlinkRule.
    if (hasRelatedDocumentTableNearby(ctx)) {
      if (ctx.nextElement instanceof Paragraph && isRelatedDocumentsItem(ctx.nextElement)) {
        return false;
      }
      return true;
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

      // Bold + colon paragraphs ("Note:", "Result:") that directly follow a
      // list item are inline commentary belonging to that list item. They stay
      // tight against the list — no blank between the list item and the
      // callout. This mirrors the suppression in aboveBoldColonNoIndentRule.
      // An "Example:" block is the exception — a standalone illustration that
      // keeps its blank line.
      if (startsWithBoldColon(ctx.nextElement) && !startsWithExample(ctx.nextElement)) {
        return false;
      }

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

    // Use the deletion-aware lookup: a tracked-DELETED image collapses on accept,
    // so it must not trigger surrounding blank lines (would leave a permanent gap).
    const imageRun = getVisibleImageRunFromParagraph(ctx.currentElement);
    if (!imageRun) return false;

    const image = imageRun.getImageElement();
    if (isImageSmall(image)) return false;

    // Large image - blank needed above and below
    // (The engine will handle checking both directions)
    return true;
  },
};

/**
 * Add blank line ABOVE paragraphs that start with a small image (<100x100)
 * and also contain text. These are typically callout/notice paragraphs
 * with a leading icon that should be visually separated from preceding content.
 */
export const aboveSmallImageTextRule: BlankLineRule = {
  id: "add-above-small-image-text",
  action: "add",
  scope: "both",
  matches(ctx: RuleContext): boolean {
    if (!(ctx.nextElement instanceof Paragraph)) return false;
    if (isParagraphBlank(ctx.nextElement)) return false;
    return isSmallImageTextCalloutParagraph(ctx.nextElement);
  },
};

/**
 * Add blank line BELOW a small-image text callout paragraph when the element
 * directly after it is a list item.
 *
 * Symmetric with aboveSmallImageTextRule. A leading-icon callout paragraph
 * (e.g. a warning icon followed by "Do NOT ..." text) is a standalone notice;
 * it must not sit flush against the list that follows it. The other addition
 * rules do not cover this boundary: afterListItemsRule only fires when the
 * CURRENT element is a list item, and boldColonNoIndentAfterRule explicitly
 * suppresses its blank when the next element is a list item.
 */
export const belowSmallImageTextRule: BlankLineRule = {
  id: "add-below-small-image-text",
  action: "add",
  scope: "both",
  matches(ctx: RuleContext): boolean {
    if (!(ctx.currentElement instanceof Paragraph)) return false;
    if (isParagraphBlank(ctx.currentElement)) return false;
    if (!isSmallImageTextCalloutParagraph(ctx.currentElement)) return false;

    // A callout that ends in a bold colon ("⚠ Important information:") is
    // INTRODUCING the list below it — the list sits tight against it, no
    // blank. Only a standalone callout (e.g. "⚠ Do NOT …") gets a blank.
    if (startsWithBoldColon(ctx.currentElement)) return false;

    // Only insert a blank when the next element is a list item.
    if (!(ctx.nextElement instanceof Paragraph)) return false;
    return !!ctx.nextElement.getNumbering();
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

    const isDisclaimer = (text: string) =>
      text.includes("not to be reproduced") ||
      text.includes("electronic data") ||
      text.includes("paper copy = informational only");

    if (!isDisclaimer(nextText)) return false;

    // Don't insert blank between consecutive disclaimer lines
    if (ctx.currentElement instanceof Paragraph) {
      const currentText = ctx.currentElement.getText().trim().toLowerCase();
      if (currentText && isDisclaimer(currentText)) {
        return false;
      }
    }

    return true;
  },
};

/**
 * Add blank line between consecutive non-blank, non-indented, non-list body paragraphs.
 * These are regular content paragraphs (Normal style) that should have visual separation.
 * Skips paragraphs that are part of special structures (lists, indented sub-items, etc.).
 */
export const betweenBodyParagraphsRule: BlankLineRule = {
  id: "add-between-body-paragraphs",
  action: "add",
  scope: "body",
  matches(ctx: RuleContext): boolean {
    if (ctx.scope !== "body") return false;
    if (!(ctx.currentElement instanceof Paragraph)) return false;
    if (!(ctx.nextElement instanceof Paragraph)) return false;

    const current = ctx.currentElement;
    const next = ctx.nextElement;

    // Both must be non-blank
    if (isParagraphBlank(current)) return false;
    if (isParagraphBlank(next)) return false;

    // Neither should be list items
    if (current.getNumbering()) return false;
    if (next.getNumbering()) return false;

    // Neither should be indented
    const currentIndent = current.getFormatting()?.indentation?.left;
    if (currentIndent && currentIndent > 0) return false;
    const nextIndent = next.getFormatting()?.indentation?.left;
    if (nextIndent && nextIndent > 0) return false;

    // Skip headings — they have their own rules
    const currentStyle = current.getStyle() || "";
    const nextStyle = next.getStyle() || "";
    if (currentStyle.includes("Heading") || nextStyle.includes("Heading")) return false;

    // Skip TOC paragraphs
    if (isTocParagraph(current) || isTocParagraph(next)) return false;

    // Skip navigation hyperlinks (handled by aboveTopOfDocHyperlinkRule)
    if (hasNavigationHyperlink(current) || hasNavigationHyperlink(next)) return false;

    // Keep consecutive hyperlink-only lines tight — don't insert a blank between two
    // standalone link lines (e.g. a vertical nav list of section links).
    if (isHyperlinkOnlyParagraph(current) && isHyperlinkOnlyParagraph(next)) return false;

    // Skip bold+colon paragraphs (handled by their own rules)
    if (startsWithBoldColon(current) || startsWithBoldColon(next)) return false;

    // Skip disclaimer lines (handled by aboveWarningRule)
    const isDisclaimer = (text: string) => {
      const lower = text.toLowerCase();
      return lower.includes("not to be reproduced") ||
        lower.includes("electronic data") ||
        lower.includes("paper copy = informational only");
    };
    if (isDisclaimer(current.getText()) || isDisclaimer(next.getText())) return false;

    // Inside the Related Documents section: reference-link lines are kept tight
    // (no blank between section items). The blank above the "Top of the
    // Document" hyperlink and the disclaimer is handled by their own rules.
    if (
      hasRelatedDocumentTableNearby(ctx) &&
      isRelatedDocumentsItem(current) &&
      isRelatedDocumentsItem(next)
    ) {
      return false;
    }

    return true;
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
  aboveSmallImageTextRule,
  belowSmallImageTextRule,
  boldColonNoIndentAfterRule,
  aboveTopOfDocHyperlinkRule,
  afterListItemsRule,
  aboveAndBelowLargeImagesRule,
  aboveWarningRule,
  betweenBodyParagraphsRule,
];
