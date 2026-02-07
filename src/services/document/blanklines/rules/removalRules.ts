/**
 * Removal Rules - Define when blank lines must be REMOVED.
 *
 * If any removal rule matches a blank paragraph, it is removed regardless
 * of addition rules or preservation fallback.
 */

import { Paragraph, Table, Hyperlink } from "docxmlater";
import type { BlankLineRule, RuleContext } from "./ruleTypes";
import { isParagraphBlank, getEffectiveLeftIndent } from "../helpers/paragraphChecks";
import { isSmallImageParagraph, getImageRunFromParagraph, isImageSmall } from "../helpers/imageChecks";
import { tableHasNestedContent } from "../helpers/tableGuards";

/**
 * Remove blank line above Heading 1 style text.
 */
export const aboveHeading1Rule: BlankLineRule = {
  id: "remove-above-heading1",
  action: "remove",
  scope: "body",
  matches(ctx: RuleContext): boolean {
    if (ctx.scope !== "body") return false;
    if (!(ctx.currentElement instanceof Paragraph)) return false;
    if (!isParagraphBlank(ctx.currentElement)) return false;

    // Check if the element after this blank is Heading 1
    if (ctx.nextElement instanceof Paragraph) {
      const style = ctx.nextElement.getStyle();
      if (style === "Heading1" && ctx.nextElement.getText().trim() !== "") {
        return true;
      }
    }
    return false;
  },
};

/**
 * Remove blank line if it's the first line of a multi-row cell.
 * Only applies if the cell has more than one row in its parent table.
 */
export const firstLineOfMultiRowCellRule: BlankLineRule = {
  id: "remove-first-line-multi-row-cell",
  action: "remove",
  scope: "cell",
  matches(ctx: RuleContext): boolean {
    if (ctx.scope !== "cell") return false;
    if (ctx.cellParaIndex !== 0) return false;
    if (!ctx.cellParagraphs || ctx.cellParagraphs.length === 0) return false;
    if (!(ctx.currentElement instanceof Paragraph)) return false;
    if (!isParagraphBlank(ctx.currentElement)) return false;

    // Only remove if this table has more than one row
    if (ctx.parentTable) {
      const rowCount = ctx.parentTable.getRowCount();
      if (rowCount > 1) {
        return true;
      }
    }
    return false;
  },
};

/**
 * Remove blank line above tables larger than 1x1.
 */
export const aboveLargeTableRule: BlankLineRule = {
  id: "remove-above-large-table",
  action: "remove",
  scope: "body",
  matches(ctx: RuleContext): boolean {
    if (ctx.scope !== "body") return false;
    if (!(ctx.currentElement instanceof Paragraph)) return false;
    if (!isParagraphBlank(ctx.currentElement)) return false;

    if (ctx.nextElement instanceof Table) {
      const rowCount = ctx.nextElement.getRowCount();
      const colCount = ctx.nextElement.getColumnCount();
      if (rowCount > 1 || colCount > 1) {
        return true;
      }
    }
    return false;
  },
};

/**
 * Remove blank line between list items, even if they are different level
 * bullet lists or numbered list items.
 */
export const betweenListItemsRule: BlankLineRule = {
  id: "remove-between-list-items",
  action: "remove",
  scope: "both",
  matches(ctx: RuleContext): boolean {
    if (!(ctx.currentElement instanceof Paragraph)) return false;
    if (!isParagraphBlank(ctx.currentElement)) return false;

    const prevIsListItem =
      ctx.prevElement instanceof Paragraph && !!ctx.prevElement.getNumbering();
    const nextIsListItem =
      ctx.nextElement instanceof Paragraph && !!ctx.nextElement.getNumbering();

    return prevIsListItem && nextIsListItem;
  },
};

/**
 * Remove blank line between a list item and the next line if that next line is:
 * - indented text
 * - a list item
 * - indented text with a small image (<100x100) followed by text
 */
export const listItemToIndentedContentRule: BlankLineRule = {
  id: "remove-list-to-indented",
  action: "remove",
  scope: "both",
  matches(ctx: RuleContext): boolean {
    if (!(ctx.currentElement instanceof Paragraph)) return false;
    if (!isParagraphBlank(ctx.currentElement)) return false;

    const prevIsListItem =
      ctx.prevElement instanceof Paragraph && !!ctx.prevElement.getNumbering();
    if (!prevIsListItem) return false;

    if (ctx.nextElement instanceof Paragraph) {
      // Next is a list item
      if (ctx.nextElement.getNumbering()) return true;

      // Next is indented text (check both direct and style-inherited indentation)
      const nextIndent = getEffectiveLeftIndent(ctx.nextElement, ctx.doc);
      if (nextIndent > 0) return true;

      // Next is a small image followed by text (check if small image with indentation)
      if (isSmallImageParagraph(ctx.nextElement)) {
        const nextIndentImg = getEffectiveLeftIndent(ctx.nextElement, ctx.doc);
        if (nextIndentImg > 0) return true;
      }
    }
    return false;
  },
};

/**
 * Before the very first list item in a sequence, if the preceding line is
 * non-indented text, do not have a blank line between them.
 */
export const beforeFirstListItemRule: BlankLineRule = {
  id: "remove-before-first-list-item",
  action: "remove",
  scope: "both",
  matches(ctx: RuleContext): boolean {
    if (!(ctx.currentElement instanceof Paragraph)) return false;
    if (!isParagraphBlank(ctx.currentElement)) return false;

    // Next element must be a list item
    if (!(ctx.nextElement instanceof Paragraph) || !ctx.nextElement.getNumbering()) {
      return false;
    }

    // Previous element must be non-indented text (not a list item)
    if (!(ctx.prevElement instanceof Paragraph)) return false;
    if (ctx.prevElement.getNumbering()) return false;
    if (isParagraphBlank(ctx.prevElement)) return false;

    const prevIndent = ctx.prevElement.getFormatting()?.indentation?.left;
    if (prevIndent && prevIndent > 0) return false;

    // Check that the next element IS the first list item (prev is not a list item)
    return true;
  },
};

/**
 * If current line has bold text with a colon, no indentation, and the next
 * line is indented or a list item, never have a blank line between them.
 *
 * This rule checks for a blank line between bold+colon and indented/list content.
 */
export const boldColonToIndentedRule: BlankLineRule = {
  id: "remove-bold-colon-to-indented",
  action: "remove",
  scope: "both",
  matches(ctx: RuleContext): boolean {
    if (!(ctx.currentElement instanceof Paragraph)) return false;
    if (!isParagraphBlank(ctx.currentElement)) return false;

    // Previous must be bold+colon with no indentation
    if (!(ctx.prevElement instanceof Paragraph)) return false;

    const prevContent = ctx.prevElement.getContent();
    if (!prevContent || prevContent.length === 0) return false;

    // Check for bold first run with colon
    const { Run } = require("docxmlater");
    const firstRun = prevContent.find((item: any) => item instanceof Run) as any;
    if (!firstRun) return false;
    const formatting = firstRun.getFormatting() as any;
    if (!formatting.bold) return false;
    const fullText = ctx.prevElement.getText();
    if (!fullText || !fullText.substring(0, 55).includes(":")) return false;

    // Must have no indentation
    const prevIndent = ctx.prevElement.getFormatting()?.indentation?.left;
    if (prevIndent && prevIndent > 0) return false;

    // Next must be indented or a list item
    if (!(ctx.nextElement instanceof Paragraph)) return false;

    if (ctx.nextElement.getNumbering()) return true;

    const nextIndent = ctx.nextElement.getFormatting()?.indentation?.left;
    if (nextIndent && nextIndent > 0) return true;

    return false;
  },
};

/**
 * Remove blank line BELOW "Top of Document" / "Top of the Document" hyperlink.
 */
export const afterTopOfDocHyperlinkRule: BlankLineRule = {
  id: "remove-after-top-of-doc-hyperlink",
  action: "remove",
  scope: "body",
  matches(ctx: RuleContext): boolean {
    if (ctx.scope !== "body") return false;
    if (!(ctx.currentElement instanceof Paragraph)) return false;
    if (!isParagraphBlank(ctx.currentElement)) return false;

    // Check if previous element contains a "Top of Document" hyperlink
    if (!(ctx.prevElement instanceof Paragraph)) return false;

    const content = ctx.prevElement.getContent();
    if (!content) return false;

    for (const item of content) {
      if (item instanceof Hyperlink) {
        const text = item.getText().toLowerCase();
        if (text === "top of document" || text === "top of the document") {
          return true;
        }
      }
    }
    return false;
  },
};

/**
 * Never have a blank line between the last line in a cell and the element before it,
 * unless the element before is a nested or floating table.
 */
export const lastLineInCellRule: BlankLineRule = {
  id: "remove-last-line-in-cell",
  action: "remove",
  scope: "cell",
  matches(ctx: RuleContext): boolean {
    if (ctx.scope !== "cell") return false;
    if (!ctx.cellParagraphs || !ctx.cell) return false;
    if (!(ctx.currentElement instanceof Paragraph)) return false;
    if (!isParagraphBlank(ctx.currentElement)) return false;

    const paraIndex = ctx.cellParaIndex ?? -1;
    const isLastBlankBeforeEnd =
      paraIndex >= 0 && paraIndex === ctx.cellParagraphs.length - 1;

    // If this blank is the last paragraph, remove it (unless preceded by nested table)
    if (isLastBlankBeforeEnd && ctx.cellParagraphs.length > 1) {
      // Check if the cell has nested tables that the blank might be separating
      if (ctx.cell.hasNestedTables()) {
        return false; // Don't remove - might be needed for nested table spacing
      }
      return true;
    }

    // Also check for blanks that are second-to-last where last is blank
    // (trailing blanks in cells)
    if (
      paraIndex >= 1 &&
      paraIndex === ctx.cellParagraphs.length - 2 &&
      isParagraphBlank(ctx.cellParagraphs[ctx.cellParagraphs.length - 1])
    ) {
      if (ctx.cell.hasNestedTables()) return false;
      return true;
    }

    return false;
  },
};

/**
 * Remove blank line after images >100x100 if the image is the last element in a table cell.
 */
export const largeImageLastInCellRule: BlankLineRule = {
  id: "remove-large-image-last-in-cell",
  action: "remove",
  scope: "cell",
  matches(ctx: RuleContext): boolean {
    if (ctx.scope !== "cell") return false;
    if (!ctx.cellParagraphs || !ctx.cell) return false;
    if (!(ctx.currentElement instanceof Paragraph)) return false;
    if (!isParagraphBlank(ctx.currentElement)) return false;

    const paraIndex = ctx.cellParaIndex ?? -1;
    if (paraIndex < 1) return false;

    // Check if previous paragraph is a large image
    const prevPara = ctx.cellParagraphs[paraIndex - 1];
    if (!prevPara) return false;

    const imageRun = getImageRunFromParagraph(prevPara);
    if (!imageRun) return false;

    const image = imageRun.getImageElement();
    if (isImageSmall(image)) return false; // Small image, rule doesn't apply

    // Large image - check if it's effectively the last content in the cell
    // (current blank is after the image and is the last or near-last element)
    const isNearEnd = paraIndex >= ctx.cellParagraphs.length - 1;
    if (isNearEnd) return true;

    // Also if all remaining paragraphs after this are blank
    for (let i = paraIndex + 1; i < ctx.cellParagraphs.length; i++) {
      if (!isParagraphBlank(ctx.cellParagraphs[i])) return false;
    }
    return true;
  },
};

/**
 * All removal rules in priority order.
 */
export const removalRules: BlankLineRule[] = [
  aboveHeading1Rule,
  firstLineOfMultiRowCellRule,
  aboveLargeTableRule,
  betweenListItemsRule,
  listItemToIndentedContentRule,
  beforeFirstListItemRule,
  boldColonToIndentedRule,
  afterTopOfDocHyperlinkRule,
  lastLineInCellRule,
  largeImageLastInCellRule,
];
