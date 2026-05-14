/**
 * Indentation Rules - Fix indentation on lines after list items.
 *
 * These rules adjust paragraph indentation for continuation text
 * that follows list items, ensuring visual alignment.
 *
 * Also includes removeSmallIndents which strips indentation < 0.25"
 * from non-list paragraphs before blank line and indentation rules run.
 */

import { Document, Paragraph } from "docxmlater";
import { isParagraphBlank } from "../helpers/paragraphChecks";
import { detectTypedPrefix } from "@/services/document/list";
import type { BlankLineProcessingOptions } from "./ruleTypes";
import { logger } from "@/utils/logger";

const log = logger.namespace("IndentationRules");

/** Conversion: 1 inch = 1440 twips */
const TWIPS_PER_INCH = 1440;

/** Threshold below which indentation is removed for non-list paragraphs (0.25 inch) */
const SMALL_INDENT_THRESHOLD_TWIPS = 360; // 0.25 * 1440

/** Fallback indent for Case C when no level-0 textIndent is configured (0.5"). */
const FALLBACK_FIRST_INDENT_TWIPS = Math.round(0.5 * TWIPS_PER_INCH);

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
 * Get the text indentation in twips for a given list level.
 */
function getTextIndentForLevel(options: BlankLineProcessingOptions, level: number): number | null {
  if (!options.listBulletSettings?.indentationLevels) return null;

  const levels = options.listBulletSettings.indentationLevels;
  const levelConfig = levels.find((l) => l.level === level);

  if (levelConfig) {
    return inchesToTwips(levelConfig.textIndent);
  }

  // If no exact level match, extrapolate from the last configured level
  // Each additional level adds 0.25 inches, matching WordDocumentProcessor.getTextIndentForLevel
  if (levels.length > 0) {
    const lastLevel = levels[levels.length - 1];
    const extraLevels = level - lastLevel.level;
    if (extraLevels > 0) {
      return inchesToTwips(lastLevel.textIndent + extraLevels * 0.25);
    }
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
 * Apply the three-case decision tree once for a single candidate paragraph
 * and return the target left-indent it should snap to.
 *
 *   Case A: prev is a non-blank list-item paragraph             → list level's text indent
 *   Case B: prev is a non-blank, non-list, indented paragraph    → prev's current left indent
 *   Case C: anything else (blank prev, non-indented prev, Table,
 *           absent prev, list-item prev with unconfigured level) → level0
 *
 * Case A falls through to Case C when getTextIndentForLevel returns null,
 * so the return value is always a concrete twip count.
 */
function decideTarget(
  prev: Paragraph | undefined,
  options: BlankLineProcessingOptions,
  level0: number
): number {
  if (!(prev instanceof Paragraph)) return level0;
  if (isParagraphBlank(prev)) return level0;

  const prevNumbering = prev.getNumbering();
  if (prevNumbering) {
    // Case A
    const levelTarget = getTextIndentForLevel(options, prevNumbering.level ?? 0);
    if (levelTarget !== null) return levelTarget;
    return level0; // Case A fall-through to Case C
  }

  const prevIndent = prev.getFormatting()?.indentation?.left;
  if (prevIndent && prevIndent > 0) {
    // Case B
    return prevIndent;
  }

  // Case C
  return level0;
}

/**
 * Apply the indentation decision tree to every non-list, non-blank
 * indented paragraph in the document body and inside each table cell.
 *
 * For each such paragraph N (indent > 0):
 *   Case A: immediate prev is a list item              → match list level's text indent
 *   Case B: immediate prev is indented non-list        → match prev's left indent
 *   Case C: otherwise (blank, non-indented, Table, …)  → snap to level-0 text indent
 *                                                        (fallback 0.5" if not configured)
 *
 * Forward iteration ensures Case B observes Case C's normalization
 * from earlier iterations — three consecutive indented paragraphs all
 * settle on the same value via C → B → B.
 *
 * Precondition: removeSmallIndents (also in this file) must have run
 * earlier in the pipeline so that any surviving indent > 0 is treated
 * as intentional. WordDocumentProcessor calls removeSmallIndents before
 * BlankLineManager, which in turn calls applyIndentationRules — this
 * ordering is required for correct cascade behavior.
 */
export function applyIndentationRules(doc: Document, options: BlankLineProcessingOptions): number {
  let fixed = 0;

  const level0 = getLevel0TextIndent(options) ?? FALLBACK_FIRST_INDENT_TWIPS;

  // Body — forward iteration so Case B sees prev's already-normalized indent.
  for (let i = 0; i < doc.getBodyElementCount(); i++) {
    const element = doc.getBodyElementAt(i);
    if (!(element instanceof Paragraph)) continue;
    if (isParagraphBlank(element)) continue;
    if (element.getNumbering()) continue;

    const indent = element.getFormatting()?.indentation?.left;
    if (!indent || indent <= 0) continue;

    const prev = i > 0 ? doc.getBodyElementAt(i - 1) : undefined;
    const target = decideTarget(prev instanceof Paragraph ? prev : undefined, options, level0);

    if (target !== indent) {
      element.setLeftIndent(target);
      fixed++;
    }
  }

  // Cells — same forward iteration; paras snapshot is safe because setLeftIndent
  // mutates the paragraph in place rather than replacing it in the array.
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

          const prev = ci > 0 ? paras[ci - 1] : undefined;
          const target = decideTarget(prev, options, level0);

          if (target !== indent) {
            para.setLeftIndent(target);
            fixed++;
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
