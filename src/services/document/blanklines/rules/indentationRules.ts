/**
 * Indentation Rules - Fix indentation on lines after list items.
 *
 * These rules adjust paragraph indentation for continuation text
 * that follows list items, ensuring visual alignment.
 *
 * Also includes removeSmallIndents which strips indentation < 0.25"
 * from non-list paragraphs before blank line and indentation rules run.
 */

import { Document, Paragraph, Table, TableCell } from "docxmlater";
import { isParagraphBlank } from "../helpers/paragraphChecks";
import { detectTypedPrefix } from "@/services/document/list";
import type { BlankLineProcessingOptions } from "./ruleTypes";
import { logger } from "@/utils/logger";

const log = logger.namespace("IndentationRules");

/** Conversion: 1 inch = 1440 twips */
const TWIPS_PER_INCH = 1440;

/** Threshold below which indentation is removed for non-list paragraphs (0.25 inch) */
const SMALL_INDENT_THRESHOLD_TWIPS = 360; // 0.25 * 1440

function inchesToTwips(inches: number): number {
  return Math.round(inches * TWIPS_PER_INCH);
}

/**
 * Check whether a paragraph is a list element (Word list or typed prefix).
 */
function isListElement(para: Paragraph): boolean {
  // Real Word list item
  const numbering = para.getNumbering();
  if (numbering && numbering.numId !== undefined && numbering.numId !== 0) {
    return true;
  }

  // Typed list prefix in text (e.g. "1. ", "a) ", "• ")
  const text = para.getText()?.trim() || "";
  if (text.length > 0) {
    const typed = detectTypedPrefix(text);
    if (typed.prefix) {
      return true;
    }
  }

  return false;
}

/**
 * Remove small indentation (< 0.25") from non-list paragraphs.
 *
 * This runs BEFORE blank line rules and indentation rules to ensure
 * that trivially-indented body text and table cell text is normalized
 * to zero indent. This prevents downstream rules from misinterpreting
 * small indents as intentional formatting and incorrectly adding or
 * removing blank lines.
 *
 * Handles both body-level paragraphs and paragraphs inside table cells
 * (including multi-column rows).
 */
export function removeSmallIndents(doc: Document): number {
  let fixed = 0;

  // Process body-level paragraphs
  for (let i = 0; i < doc.getBodyElementCount(); i++) {
    const element = doc.getBodyElementAt(i);
    if (!(element instanceof Paragraph)) continue;
    if (isParagraphBlank(element)) continue;

    const indent = element.getFormatting()?.indentation?.left;
    if (!indent || indent <= 0) continue;
    if (indent >= SMALL_INDENT_THRESHOLD_TWIPS) continue;

    // Skip list elements - their indentation is intentional
    if (isListElement(element)) continue;

    log.debug(
      `Removing small indent (${indent} twips / ${(indent / TWIPS_PER_INCH).toFixed(2)}") ` +
      `from body paragraph: "${element.getText()?.substring(0, 40)}..."`
    );
    element.setLeftIndent(0);
    fixed++;
  }

  // Process table cell paragraphs (all columns in all rows)
  for (const table of doc.getAllTables()) {
    for (const row of table.getRows()) {
      for (const cell of row.getCells()) {
        const paras = cell.getParagraphs();

        for (let ci = 0; ci < paras.length; ci++) {
          const para = paras[ci];
          if (!para) continue;
          if (isParagraphBlank(para)) continue;

          const indent = para.getFormatting()?.indentation?.left;
          if (!indent || indent <= 0) continue;
          if (indent >= SMALL_INDENT_THRESHOLD_TWIPS) continue;

          // Skip list elements
          if (isListElement(para)) continue;

          log.debug(
            `Removing small indent (${indent} twips / ${(indent / TWIPS_PER_INCH).toFixed(2)}") ` +
            `from table cell paragraph: "${para.getText()?.substring(0, 40)}..."`
          );
          para.setLeftIndent(0);
          fixed++;
        }
      }
    }
  }

  if (fixed > 0) {
    log.info(`Removed small indentation (< 0.25") from ${fixed} non-list paragraphs`);
  }

  return fixed;
}

/**
 * Find the nearest preceding list item and return its level.
 * Scans backwards from the given index in the body.
 */
function findPrecedingListItem(
  doc: Document,
  bodyIndex: number
): { level: number; paragraph: Paragraph } | null {
  for (let i = bodyIndex - 1; i >= 0; i--) {
    const el = doc.getBodyElementAt(i);
    if (el instanceof Table) return null; // Stop at table boundaries
    if (!(el instanceof Paragraph)) continue;
    if (isParagraphBlank(el)) continue;

    const numbering = el.getNumbering();
    if (numbering) {
      return { level: numbering.level ?? 0, paragraph: el };
    }

    // If we hit non-indented, non-list text, stop looking
    const indent = el.getFormatting()?.indentation?.left;
    if (!indent || indent <= 0) return null;
  }
  return null;
}

/**
 * Find the nearest preceding list item in a cell.
 */
function findPrecedingListItemInCell(
  paragraphs: Paragraph[],
  paraIndex: number
): { level: number; paragraph: Paragraph } | null {
  for (let i = paraIndex - 1; i >= 0; i--) {
    const para = paragraphs[i];
    if (!para) continue;
    if (isParagraphBlank(para)) continue;

    const numbering = para.getNumbering();
    if (numbering) {
      return { level: numbering.level ?? 0, paragraph: para };
    }

    // If we hit non-indented text, stop
    const indent = para.getFormatting()?.indentation?.left;
    if (!indent || indent <= 0) return null;
  }
  return null;
}

/**
 * Get the text indentation in twips for a given list level.
 */
function getTextIndentForLevel(
  options: BlankLineProcessingOptions,
  level: number
): number | null {
  if (!options.listBulletSettings?.indentationLevels) return null;

  const levels = options.listBulletSettings.indentationLevels;
  const levelConfig = levels.find((l) => l.level === level);

  if (levelConfig) {
    return inchesToTwips(levelConfig.textIndent);
  }

  // If no exact level match, use the last configured level
  if (levels.length > 0) {
    const lastLevel = levels[levels.length - 1];
    return inchesToTwips(lastLevel.textIndent);
  }

  return null;
}

/**
 * Get the level-0 text indentation in twips.
 */
function getLevel0TextIndent(options: BlankLineProcessingOptions): number | null {
  return getTextIndentForLevel(options, 0);
}

/**
 * Applies indentation rules to the document body.
 *
 * Rule 1: Indented text after a list item should match the text indentation
 *         of the list item's level.
 *
 * Rule 2: If consecutive indented lines exist and the line above is a list item,
 *         match the list item's text indentation. If not a list item, match
 *         the level-0 bullet text indentation.
 */
export function applyIndentationRules(
  doc: Document,
  options: BlankLineProcessingOptions
): number {
  if (!options.listBulletSettings?.indentationLevels) {
    return 0;
  }

  let fixed = 0;

  // Process body-level paragraphs
  for (let i = 0; i < doc.getBodyElementCount(); i++) {
    const element = doc.getBodyElementAt(i);
    if (!(element instanceof Paragraph)) continue;
    if (isParagraphBlank(element)) continue;
    if (element.getNumbering()) continue; // Skip list items themselves

    const indent = element.getFormatting()?.indentation?.left;
    if (!indent || indent <= 0) continue; // Only process indented paragraphs

    // Find preceding list item
    const listItem = findPrecedingListItem(doc, i);

    if (listItem) {
      // Rule 1: Match the list item's text indentation level
      const targetIndent = getTextIndentForLevel(options, listItem.level);
      if (targetIndent !== null && indent !== targetIndent) {
        element.setLeftIndent(targetIndent);
        fixed++;
      }
    } else {
      // Rule 2: No preceding list item - check if previous line is indented
      const prevElement = doc.getBodyElementAt(i - 1);
      if (
        prevElement instanceof Paragraph &&
        !isParagraphBlank(prevElement) &&
        !prevElement.getNumbering()
      ) {
        const prevIndent = prevElement.getFormatting()?.indentation?.left;
        if (prevIndent && prevIndent > 0) {
          // Consecutive indented lines - match level-0 text indent
          const level0Indent = getLevel0TextIndent(options);
          if (level0Indent !== null && indent !== level0Indent) {
            element.setLeftIndent(level0Indent);
            fixed++;
          }
        }
      }
    }
  }

  // Process table cell paragraphs
  for (const table of doc.getAllTables()) {
    for (const row of table.getRows()) {
      for (const cell of row.getCells()) {
        const paras = cell.getParagraphs();

        for (let ci = 0; ci < paras.length; ci++) {
          const para = paras[ci];
          if (!para) continue;
          if (isParagraphBlank(para)) continue;
          if (para.getNumbering()) continue;

          const indent = para.getFormatting()?.indentation?.left;
          if (!indent || indent <= 0) continue;

          const listItem = findPrecedingListItemInCell(paras, ci);

          if (listItem) {
            const targetIndent = getTextIndentForLevel(options, listItem.level);
            if (targetIndent !== null && indent !== targetIndent) {
              para.setLeftIndent(targetIndent);
              fixed++;
            }
          } else {
            // Consecutive indented lines without a list item
            const prevPara = paras[ci - 1];
            if (
              prevPara &&
              !isParagraphBlank(prevPara) &&
              !prevPara.getNumbering()
            ) {
              const prevIndent = prevPara.getFormatting()?.indentation?.left;
              if (prevIndent && prevIndent > 0) {
                const level0Indent = getLevel0TextIndent(options);
                if (level0Indent !== null && indent !== level0Indent) {
                  para.setLeftIndent(level0Indent);
                  fixed++;
                }
              }
            }
          }
        }
      }
    }
  }

  if (fixed > 0) {
    log.info(`Fixed indentation on ${fixed} paragraphs`);
  }

  return fixed;
}
