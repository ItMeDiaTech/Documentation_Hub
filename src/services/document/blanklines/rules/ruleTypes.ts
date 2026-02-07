/**
 * Rule Engine Type Definitions for the blank line management system.
 *
 * Rules are evaluated in priority order:
 * 1. Removal rules (checked first - absolute constraints)
 * 2. Addition rules (checked second - absolute requirements)
 * 3. Preservation fallback (no rule matched - keep original if existed)
 */

import type { Document, Paragraph, Table, TableCell } from "docxmlater";

/**
 * Context provided to each rule for evaluation.
 */
export interface RuleContext {
  doc: Document;
  /** Index of the position being evaluated (body element index or cell para index) */
  currentIndex: number;
  /** The element at the current position */
  currentElement: Paragraph | Table;
  /** Element before the current position */
  prevElement?: Paragraph | Table;
  /** Element after the current position */
  nextElement?: Paragraph | Table;
  /** Whether this is a body-level or cell-level evaluation */
  scope: "body" | "cell";
  /** The cell if scope is 'cell' */
  cell?: TableCell;
  /** All paragraphs in the cell (if scope is 'cell') */
  cellParagraphs?: Paragraph[];
  /** Index within the cell's paragraphs (if scope is 'cell') */
  cellParaIndex?: number;
  /** The table containing the cell (if scope is 'cell') */
  parentTable?: Table;
}

/**
 * A blank line rule definition.
 */
export interface BlankLineRule {
  /** Unique identifier for the rule */
  id: string;
  /** Whether this rule removes or adds blank lines */
  action: "remove" | "add";
  /** Whether the rule applies to body, cell, or both contexts */
  scope: "body" | "cell" | "both";
  /**
   * Returns true if this rule matches the given context.
   *
   * For 'remove' rules: returns true if a blank at this position should be removed.
   * For 'add' rules: returns true if a blank should exist at this position.
   */
  matches(context: RuleContext): boolean;
}

/**
 * Options passed to the rule-based blank line processing engine.
 */
export interface BlankLineProcessingOptions {
  /** List bullet settings for indentation rules */
  listBulletSettings?: {
    indentationLevels: Array<{
      level: number;
      symbolIndent: number;
      textIndent: number;
    }>;
  };
  /** Stop bold+colon blank lines after this heading text is found in a 1x1 table */
  stopBoldColonAfterHeading?: string;
}

/**
 * Result from the rule-based blank line processing.
 */
export interface RuleEngineResult {
  /** Number of blank lines removed by removal rules */
  removed: number;
  /** Number of blank lines added by addition rules */
  added: number;
  /** Number of blank lines preserved because no rule matched but original had one */
  preserved: number;
  /** Number of indentation adjustments made */
  indentationFixed: number;
}
