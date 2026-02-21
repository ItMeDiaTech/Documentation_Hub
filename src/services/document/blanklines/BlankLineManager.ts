/**
 * BlankLineManager - Rule-based blank line management engine.
 *
 * Replaces the old phase-based "remove all, then add back" approach with
 * a rule-based system that applies explicit rules first, then preserves
 * original blank lines where no rule matched.
 *
 * Processing order:
 * 1. Remove SDT wrappers
 * 2. Apply REMOVAL rules (absolute constraints)
 * 3. Apply ADDITION rules (absolute requirements)
 * 4. Apply PRESERVATION fallback (keep original if no rule matched)
 * 5. Apply INDENTATION rules
 * 6. Dedup (safety net - remove adjacent blanks)
 * 7. Normalize blank line styles to Normal
 */

import { Document, Paragraph, Table, TableCell } from "docxmlater";
import { logger } from "@/utils/logger";
import { clearCustom } from "./helpers/clearCustom";
import { isParagraphBlank } from "./helpers/paragraphChecks";
import { createBlankParagraph } from "./helpers/blankLineInsertion";
import { getImageRunFromParagraph, isImageSmall } from "./helpers/imageChecks";
import { tableHasNestedContent } from "./helpers/tableGuards";
import type { BlankLineSnapshot } from "./helpers/blankLineSnapshot";
import {
  wasOriginallyBlankAtBody,
  wasOriginallyBlankInCell,
} from "./helpers/blankLineSnapshot";
import { removalRules } from "./rules/removalRules";
import { additionRules } from "./rules/additionRules";
import { applyIndentationRules } from "./rules/indentationRules";
import type {
  RuleContext,
  BlankLineProcessingOptions,
  RuleEngineResult,
  BlankLineRule,
} from "./rules/ruleTypes";
import type { BlankLineOptions } from "./types";

const log = logger.namespace("BlankLineManager");

function buildBlankLineOptions(
  normalStyle?: BlankLineProcessingOptions['normalStyleFormatting']
): BlankLineOptions {
  return {
    spacingAfter: normalStyle?.spaceAfter ?? 120,
    spacingBefore: normalStyle?.spaceBefore,
    lineSpacing: normalStyle?.lineSpacing,
    fontSize: normalStyle?.fontSize,
    fontFamily: normalStyle?.fontFamily,
    markAsPreserved: true,
    style: "Normal",
  };
}

export class BlankLineManager {
  /**
   * Primary entry point for rule-based blank line processing.
   * Must be called AFTER list normalization is complete.
   */
  processBlankLines(
    doc: Document,
    snapshot: BlankLineSnapshot,
    options: BlankLineProcessingOptions
  ): RuleEngineResult {
    const result: RuleEngineResult = {
      removed: 0,
      added: 0,
      preserved: 0,
      indentationFixed: 0,
    };

    const blankOpts = buildBlankLineOptions(options.normalStyleFormatting);

    // Step 1: Remove SDT wrappers
    clearCustom(doc);

    // NOTE: Small indent removal (< 0.25") now runs earlier in WordDocumentProcessor,
    // before applyListContinuationIndentation, so that trivially-indented paragraphs
    // are normalized to zero before continuation indentation logic evaluates them.

    // Step 2: Apply removal rules (walk body + cells, remove blanks where rules match)
    result.removed += this.applyRemovalRulesBody(doc);
    result.removed += this.applyRemovalRulesCells(doc);

    // Step 3: Apply addition rules (walk body + cells, add blanks where rules match)
    result.added += this.applyAdditionRulesBody(doc, options, blankOpts);
    result.added += this.applyAdditionRulesCells(doc, options, blankOpts);

    // Step 4: Apply preservation fallback (keep original blanks where no rule matched)
    result.preserved += this.applyPreservationFallbackBody(doc, snapshot, blankOpts);
    result.preserved += this.applyPreservationFallbackCells(doc, snapshot, blankOpts);

    // Step 5: Apply indentation rules
    result.indentationFixed = applyIndentationRules(doc, options);

    // Step 6: Final dedup pass (remove adjacent blank lines)
    const dedupRemoved = this.dedup(doc);
    result.removed += dedupRemoved;

    // Step 7: Normalize all blank line styles to Normal
    this.normalizeBlankLineStyles(doc, blankOpts);

    log.info(
      `Rule engine complete: ${result.removed} removed, ${result.added} added, ` +
        `${result.preserved} preserved, ${result.indentationFixed} indentation fixes`
    );

    return result;
  }

  /**
   * Apply removal rules to body-level blank paragraphs.
   * Iterates backwards to safely remove elements.
   */
  private applyRemovalRulesBody(doc: Document): number {
    let removed = 0;

    for (let i = doc.getBodyElementCount() - 1; i >= 0; i--) {
      const element = doc.getBodyElementAt(i);
      if (!(element instanceof Paragraph)) continue;
      if (!isParagraphBlank(element)) continue;
      if (element.isPreserved()) continue; // Protect field paragraphs (TOC)

      const ctx = this.buildBodyContext(doc, i);
      const matchedRule = this.findMatchingRule(removalRules, ctx, "body");

      if (matchedRule) {
        log.debug(`Removal rule "${matchedRule.id}" matched at body index ${i}`);
        doc.removeBodyElementAt(i);
        removed++;
      }
    }

    return removed;
  }

  /**
   * Apply removal rules to blank paragraphs inside table cells.
   * Iterates backwards within each cell for safe removal.
   */
  private applyRemovalRulesCells(doc: Document): number {
    let removed = 0;

    for (const table of doc.getAllTables()) {
      if (tableHasNestedContent(table)) continue;

      for (const row of table.getRows()) {
        for (const cell of row.getCells()) {
          let paras = cell.getParagraphs();

          for (let ci = paras.length - 1; ci >= 0; ci--) {
            // Keep at least one paragraph per cell (ECMA-376)
            if (paras.length <= 1) break;

            const para = paras[ci];
            if (!para || !isParagraphBlank(para)) continue;
            if (para.isPreserved()) continue;

            const ctx = this.buildCellContext(doc, cell, ci, paras, table);
            const matchedRule = this.findMatchingRule(removalRules, ctx, "cell");

            if (matchedRule) {
              log.debug(`Removal rule "${matchedRule.id}" matched in cell at index ${ci}`);
              cell.removeParagraph(ci);
              removed++;
              paras = cell.getParagraphs();
            }
          }
        }
      }
    }

    return removed;
  }

  /**
   * Apply addition rules to body-level positions.
   * Iterates forward, inserting blanks where addition rules match.
   */
  private applyAdditionRulesBody(
    doc: Document,
    options: BlankLineProcessingOptions,
    blankOpts: BlankLineOptions
  ): number {
    let added = 0;

    for (let i = 0; i < doc.getBodyElementCount(); i++) {
      const element = doc.getBodyElementAt(i);
      const ctx = this.buildBodyContext(doc, i);
      const matchedRule = this.findMatchingRule(additionRules, ctx, "body");

      if (matchedRule) {
        // Clear indentation from navigation hyperlink paragraphs
        if (matchedRule.id === "add-above-top-of-doc-hyperlink") {
          const targetPara = ctx.nextElement;
          if (targetPara instanceof Paragraph) {
            const indent = targetPara.getFormatting()?.indentation?.left;
            if (indent && indent > 0) {
              targetPara.setLeftIndent(0);
            }
          }
        }

        // Determine if this rule wants a blank BEFORE the next element or AFTER the current
        const isBefore =
          matchedRule.id === "add-above-top-of-doc-hyperlink" ||
          matchedRule.id === "add-above-warning" ||
          matchedRule.id === "add-before-first-1x1-table" ||
          matchedRule.id === "add-above-bold-colon-no-indent";

        if (isBefore) {
          // These rules want a blank BEFORE the next element
          // Check if a blank already exists between current and next
          const nextIdx = i + 1;
          if (nextIdx < doc.getBodyElementCount()) {
            const nextEl = doc.getBodyElementAt(nextIdx);
            if (nextEl instanceof Paragraph && isParagraphBlank(nextEl)) {
              continue; // Already a blank
            }
            const blankPara = createBlankParagraph(blankOpts);
            doc.insertBodyElementAt(nextIdx, blankPara);
            added++;
            i++; // Skip past inserted blank
          }
        } else {
          // Standard "after" rules - ensure blank after current element
          const nextIdx = i + 1;
          if (nextIdx < doc.getBodyElementCount()) {
            const nextEl = doc.getBodyElementAt(nextIdx);
            if (nextEl instanceof Paragraph && isParagraphBlank(nextEl)) {
              continue; // Already a blank
            }
          }
          const blankPara = createBlankParagraph(blankOpts);
          doc.insertBodyElementAt(i + 1, blankPara);
          added++;
          i++; // Skip past inserted blank
        }
      }

      // Special: large images need blank ABOVE as well
      if (element instanceof Paragraph && !isParagraphBlank(element)) {
        const imageRun = getImageRunFromParagraph(element);
        if (imageRun) {
          const image = imageRun.getImageElement();
          if (!isImageSmall(image) && i > 0) {
            const prevEl = doc.getBodyElementAt(i - 1);
            if (!(prevEl instanceof Paragraph && isParagraphBlank(prevEl))) {
              // Don't add blank above image if previous is centered text
              const isCenteredText =
                prevEl instanceof Paragraph &&
                prevEl.getAlignment() === "center" &&
                !!prevEl.getText()?.trim();
              if (!isCenteredText) {
                const blankPara = createBlankParagraph(blankOpts);
                doc.insertBodyElementAt(i, blankPara);
                added++;
                i++; // Skip past inserted blank
              }
            }
          }
        }
      }
    }

    return added;
  }

  /**
   * Apply addition rules to table cell positions.
   */
  private applyAdditionRulesCells(
    doc: Document,
    options: BlankLineProcessingOptions,
    blankOpts: BlankLineOptions
  ): number {
    let added = 0;

    for (const table of doc.getAllTables()) {
      if (tableHasNestedContent(table)) continue;

      for (const row of table.getRows()) {
        for (const cell of row.getCells()) {
          let paras = cell.getParagraphs();

          for (let ci = 0; ci < paras.length; ci++) {
            paras = cell.getParagraphs();
            const para = paras[ci];
            if (!para) continue;

            const ctx = this.buildCellContext(doc, cell, ci, paras, table);
            const matchedRule = this.findMatchingRule(additionRules, ctx, "cell");

            if (matchedRule) {
              const isLastInCell = ci === paras.length - 1;
              if (isLastInCell) continue; // Don't add blank at end of cell

              const nextPara = paras[ci + 1];
              if (nextPara && isParagraphBlank(nextPara)) continue; // Already has blank

              const blankPara = createBlankParagraph(blankOpts);
              cell.addParagraphAt(ci + 1, blankPara);
              added++;
              ci++; // Skip past inserted blank
              paras = cell.getParagraphs();
            }
          }
        }
      }
    }

    return added;
  }

  /**
   * Preservation fallback for body-level positions.
   * For positions where no rule matched, if the original document had a blank there,
   * insert one to preserve the original spacing.
   */
  private applyPreservationFallbackBody(
    doc: Document,
    snapshot: BlankLineSnapshot,
    blankOpts: BlankLineOptions
  ): number {
    let preserved = 0;

    for (let i = 0; i < doc.getBodyElementCount() - 1; i++) {
      const next = doc.getBodyElementAt(i + 1);

      // If there's already a blank at the next position, skip
      if (next instanceof Paragraph && isParagraphBlank(next)) continue;

      // Check if a blank existed here originally
      if (wasOriginallyBlankAtBody(snapshot, doc, i + 1)) {
        // Check if any removal rule would explicitly remove a blank here
        const removalMatch = this.findMatchingRemovalForPosition(doc, i, i + 1);
        if (removalMatch) continue;

        // No rule matched and original had a blank - preserve it
        const blankPara = createBlankParagraph(blankOpts);
        doc.insertBodyElementAt(i + 1, blankPara);
        preserved++;
        i++; // Skip past inserted blank
      }
    }

    return preserved;
  }

  /**
   * Preservation fallback for cell-level positions.
   */
  private applyPreservationFallbackCells(
    doc: Document,
    snapshot: BlankLineSnapshot,
    blankOpts: BlankLineOptions
  ): number {
    let preserved = 0;
    let tableIndex = 0;

    for (const table of doc.getAllTables()) {
      if (tableHasNestedContent(table)) {
        tableIndex++;
        continue;
      }

      let firstCellText = "";
      try {
        const firstCell = table.getCell(0, 0);
        if (firstCell) {
          firstCellText = firstCell
            .getParagraphs()
            .map((p) => p.getText())
            .join(" ")
            .substring(0, 20);
        }
      } catch {
        // Skip
      }

      const rows = table.getRows();
      for (let ri = 0; ri < rows.length; ri++) {
        const cells = rows[ri].getCells();
        for (let colIdx = 0; colIdx < cells.length; colIdx++) {
          const cell = cells[colIdx];
          let paras = cell.getParagraphs();
          const cellId = `t${tableIndex}_r${ri}_c${colIdx}_${firstCellText.substring(0, 20)}`;

          for (let ci = 0; ci < paras.length - 1; ci++) {
            const nextPara = paras[ci + 1];
            if (!nextPara || isParagraphBlank(nextPara)) continue;

            if (wasOriginallyBlankInCell(snapshot, cell, ci + 1, cellId)) {
              // Don't preserve blank at very end of cell
              if (ci + 1 >= paras.length - 1) continue;

              // Check if a removal rule would remove this blank
              const removalMatch = this.findMatchingCellRemovalForPosition(
                doc, cell, paras, ci, ci + 1, table
              );
              if (removalMatch) continue;

              const blankPara = createBlankParagraph(blankOpts);
              cell.addParagraphAt(ci + 1, blankPara);
              preserved++;
              ci++;
              paras = cell.getParagraphs();
            }
          }
        }
      }
      tableIndex++;
    }

    return preserved;
  }

  /**
   * Check if any removal rule would match at a hypothetical blank at the given position.
   */
  private findMatchingRemovalForPosition(
    doc: Document,
    prevIndex: number,
    blankIndex: number
  ): BlankLineRule | null {
    const prev = doc.getBodyElementAt(prevIndex);
    const next =
      blankIndex < doc.getBodyElementCount()
        ? doc.getBodyElementAt(blankIndex)
        : undefined;

    const ctx: RuleContext = {
      doc,
      currentIndex: blankIndex,
      currentElement: Paragraph.create(), // Simulate a blank paragraph
      prevElement:
        prev instanceof Paragraph || prev instanceof Table ? prev : undefined,
      nextElement:
        next instanceof Paragraph || next instanceof Table ? next : undefined,
      scope: "body",
    };

    for (const rule of removalRules) {
      if (rule.scope !== "body" && rule.scope !== "both") continue;
      if (rule.matches(ctx)) return rule;
    }
    return null;
  }

  /**
   * Check if any removal rule would match a hypothetical blank at a cell position.
   */
  private findMatchingCellRemovalForPosition(
    doc: Document,
    cell: TableCell,
    paras: Paragraph[],
    prevIndex: number,
    nextIndex: number,
    parentTable: Table
  ): BlankLineRule | null {
    const ctx: RuleContext = {
      doc,
      currentIndex: prevIndex + 1,
      currentElement: Paragraph.create(), // Simulate a blank paragraph
      prevElement: prevIndex >= 0 ? paras[prevIndex] : undefined,
      nextElement: nextIndex < paras.length ? paras[nextIndex] : undefined,
      scope: "cell",
      cell,
      cellParagraphs: paras,
      cellParaIndex: prevIndex + 1,
      parentTable,
    };

    for (const rule of removalRules) {
      if (rule.scope !== "cell" && rule.scope !== "both") continue;
      if (rule.matches(ctx)) return rule;
    }
    return null;
  }

  /**
   * Remove adjacent blank paragraphs (dedup safety net).
   */
  private dedup(doc: Document): number {
    let removed = 0;

    // Body dedup (iterate backwards)
    for (let i = doc.getBodyElementCount() - 1; i > 0; i--) {
      const current = doc.getBodyElementAt(i);
      const prev = doc.getBodyElementAt(i - 1);

      if (
        current instanceof Paragraph &&
        prev instanceof Paragraph &&
        isParagraphBlank(current) &&
        isParagraphBlank(prev)
      ) {
        doc.removeBodyElementAt(i);
        removed++;
      }
    }

    // Cell dedup
    for (const table of doc.getAllTables()) {
      if (tableHasNestedContent(table)) continue;

      for (const row of table.getRows()) {
        for (const cell of row.getCells()) {
          let paras = cell.getParagraphs();

          // Remove adjacent blanks
          for (let ci = paras.length - 1; ci > 0; ci--) {
            if (paras.length <= 1) break;

            const current = paras[ci];
            const prev = paras[ci - 1];

            if (current && prev && isParagraphBlank(current) && isParagraphBlank(prev)) {
              cell.removeParagraph(ci);
              removed++;
              paras = cell.getParagraphs();
            }
          }

          // Remove trailing blanks (no blank between last visual element and cell end)
          while (paras.length > 1 && isParagraphBlank(paras[paras.length - 1])) {
            cell.removeParagraph(paras.length - 1);
            removed++;
            paras = cell.getParagraphs();
          }
        }
      }
    }

    if (removed > 0) {
      log.debug(`Dedup removed ${removed} adjacent blank paragraphs`);
    }

    return removed;
  }

  /**
   * Ensure all blank paragraphs have Normal style with correct formatting.
   */
  private normalizeBlankLineStyles(doc: Document, opts: BlankLineOptions): void {
    const applyFormatting = (para: Paragraph) => {
      para.setStyle(opts.style);
      if (opts.spacingBefore !== undefined) {
        para.setSpaceBefore(opts.spacingBefore);
      }
      para.setSpaceAfter(opts.spacingAfter);
      if (opts.lineSpacing !== undefined) {
        para.setLineSpacing(opts.lineSpacing);
      }
      // Apply font/size to existing runs (paragraph mark formatting)
      if (opts.fontSize || opts.fontFamily) {
        const runs = para.getRuns();
        for (const run of runs) {
          if (opts.fontSize) run.setSize(opts.fontSize);
          if (opts.fontFamily) run.setFont(opts.fontFamily);
        }
      }
    };

    // Body
    for (let i = 0; i < doc.getBodyElementCount(); i++) {
      const element = doc.getBodyElementAt(i);
      if (element instanceof Paragraph && isParagraphBlank(element)) {
        applyFormatting(element);
      }
    }

    // Cells
    for (const table of doc.getAllTables()) {
      for (const row of table.getRows()) {
        for (const cell of row.getCells()) {
          for (const para of cell.getParagraphs()) {
            if (isParagraphBlank(para)) {
              applyFormatting(para);
            }
          }
        }
      }
    }
  }

  /**
   * Build a RuleContext for a body-level element.
   */
  private buildBodyContext(doc: Document, index: number): RuleContext {
    const element = doc.getBodyElementAt(index);
    const prev = index > 0 ? doc.getBodyElementAt(index - 1) : undefined;
    const next =
      index < doc.getBodyElementCount() - 1
        ? doc.getBodyElementAt(index + 1)
        : undefined;

    return {
      doc,
      currentIndex: index,
      currentElement:
        element instanceof Paragraph || element instanceof Table
          ? element
          : (element as any),
      prevElement:
        prev instanceof Paragraph || prev instanceof Table ? prev : undefined,
      nextElement:
        next instanceof Paragraph || next instanceof Table ? next : undefined,
      scope: "body",
    };
  }

  /**
   * Build a RuleContext for a cell-level paragraph.
   */
  private buildCellContext(
    doc: Document,
    cell: TableCell,
    paraIndex: number,
    paragraphs: Paragraph[],
    parentTable: Table
  ): RuleContext {
    return {
      doc,
      currentIndex: paraIndex,
      currentElement: paragraphs[paraIndex],
      prevElement: paraIndex > 0 ? paragraphs[paraIndex - 1] : undefined,
      nextElement:
        paraIndex < paragraphs.length - 1
          ? paragraphs[paraIndex + 1]
          : undefined,
      scope: "cell",
      cell,
      cellParagraphs: paragraphs,
      cellParaIndex: paraIndex,
      parentTable,
    };
  }

  /**
   * Find the first matching rule for the given context and scope.
   */
  private findMatchingRule(
    rules: BlankLineRule[],
    ctx: RuleContext,
    scope: "body" | "cell"
  ): BlankLineRule | null {
    for (const rule of rules) {
      if (rule.scope !== scope && rule.scope !== "both") continue;
      if (rule.matches(ctx)) return rule;
    }
    return null;
  }
}

export const blankLineManager = new BlankLineManager();
