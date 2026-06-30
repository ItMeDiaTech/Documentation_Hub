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
 * A real Word list item — one that carries an active numbering definition
 * (numId other than 0). Continuation alignment keys off these, so the small
 * indent preserved below is only meaningful when the predecessor is one.
 */
function isRealWordListItem(para: Paragraph): boolean {
  const numbering = para.getNumbering();
  return !!(numbering && numbering.numId !== undefined && numbering.numId !== 0);
}

/**
 * Nearest non-blank body paragraph before `index`. Stops (returns undefined)
 * at a Table or any non-Paragraph element — continuation does not bridge those.
 * Blank paragraphs are skipped so a removed/blank line between a list item and
 * its continuation text does not break the association.
 */
function prevNonBlankBodyParagraph(doc: Document, index: number): Paragraph | undefined {
  for (let j = index - 1; j >= 0; j--) {
    const el = doc.getBodyElementAt(j);
    if (!(el instanceof Paragraph)) return undefined;
    if (isParagraphBlank(el)) continue;
    return el;
  }
  return undefined;
}

/**
 * Nearest non-blank paragraph before `index` within a single cell's paragraph
 * array. Blanks are skipped; there is no Table boundary inside a cell.
 */
function prevNonBlankCellParagraph(paras: Paragraph[], index: number): Paragraph | undefined {
  for (let j = index - 1; j >= 0; j--) {
    const p = paras[j];
    if (!p) continue;
    if (isParagraphBlank(p)) continue;
    return p;
  }
  return undefined;
}

/**
 * Check whether a paragraph is a list element (Word list or typed prefix).
 */
function isListElement(para: Paragraph): boolean {
  // Real Word list item
  if (isRealWordListItem(para)) {
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

    // Skip continuation paragraphs: a small indent directly after a list item
    // (across blanks) is the signal that the text belongs to that list. Zeroing
    // it here would erase that signal before the alignment passes can lift the
    // text to the list's text-indent column.
    const prevBody = prevNonBlankBodyParagraph(doc, i);
    if (prevBody && isRealWordListItem(prevBody)) continue;

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

          // Skip continuation paragraphs after a list item (see body loop).
          const prevCell = prevNonBlankCellParagraph(paras, ci);
          if (prevCell && isRealWordListItem(prevCell)) continue;

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
 *   Case A: nearest non-blank prev is a real list item → match list level's text indent
 *   Case B: immediate prev is indented non-list        → match prev's left indent
 *   Case C: otherwise (blank, non-indented, Table, …)  → snap to level-0 text indent
 *                                                        (fallback 0.5" if not configured)
 *
 * Blank lines are bridged ONLY for Case A (so a removed blank between a list
 * item and its continuation still aligns to the list); Cases B and C still look
 * at the immediate previous element. Forward iteration ensures Case B observes
 * Case C's normalization from earlier iterations — three consecutive indented
 * paragraphs all settle on the same value via C → B → B.
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

    // Only bridge blank lines when the nearest non-blank predecessor is a real
    // list item (Case A): a removed/blank line between a list item and its
    // continuation text must not demote it to Case C (level-0). For every other
    // shape keep immediate-prev semantics so the Case B / Case C cascade for
    // non-list indented paragraphs is unchanged.
    const lookback = prevNonBlankBodyParagraph(doc, i);
    const immediatePrev = i > 0 ? doc.getBodyElementAt(i - 1) : undefined;
    const prev =
      lookback && isRealWordListItem(lookback)
        ? lookback
        : immediatePrev instanceof Paragraph
          ? immediatePrev
          : undefined;
    const target = decideTarget(prev, options, level0);

    // Continuation paragraphs must be a flat block at `target` — no hanging
    // or first-line offset. Otherwise an inherited negative first-line indent
    // makes line 1 stick out leftward to the bullet-symbol column, even when
    // leftIndent itself is the correct bullet-text position.
    const fmt = element.getFormatting();
    const firstLine = fmt?.indentation?.firstLine;
    const hanging = fmt?.indentation?.hanging;
    const needsFlatten = (firstLine && firstLine !== 0) || (hanging && hanging !== 0);

    if (target !== indent || needsFlatten) {
      element.setLeftIndent(target);
      if (needsFlatten) {
        element.setFirstLineIndent(0);
        element.setHangingIndent(0);
      }
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

          // Bridge blanks only for a real-list predecessor (see body loop).
          const lookback = prevNonBlankCellParagraph(paras, ci);
          const immediatePrev = ci > 0 ? paras[ci - 1] : undefined;
          const prev = lookback && isRealWordListItem(lookback) ? lookback : immediatePrev;
          const target = decideTarget(prev, options, level0);

          // See body loop for why we also flatten firstLine / hanging here.
          const fmt = para.getFormatting();
          const firstLine = fmt?.indentation?.firstLine;
          const hanging = fmt?.indentation?.hanging;
          const needsFlatten = (firstLine && firstLine !== 0) || (hanging && hanging !== 0);

          if (target !== indent || needsFlatten) {
            para.setLeftIndent(target);
            if (needsFlatten) {
              para.setFirstLineIndent(0);
              para.setHangingIndent(0);
            }
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
