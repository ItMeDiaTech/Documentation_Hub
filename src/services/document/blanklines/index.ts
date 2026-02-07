/**
 * BlankLineManager module - Rule-based blank line management for DOCX documents.
 *
 * This module manages blank line operations using a rule-based engine that
 * applies explicit removal/addition rules first, then preserves original
 * blank lines where no rule matched.
 */

// Main orchestrator
export { BlankLineManager, blankLineManager } from "./BlankLineManager";

// Types
export type { BlankLineOptions } from "./types";
export { DEFAULT_BLANK_LINE_OPTIONS } from "./types";

// Rule engine types
export type {
  RuleContext,
  BlankLineRule,
  BlankLineProcessingOptions,
  RuleEngineResult,
} from "./rules/ruleTypes";

// Snapshot system
export type { BlankLineSnapshot } from "./helpers/blankLineSnapshot";
export {
  captureBlankLineSnapshot,
  wasOriginallyBlankAtBody,
  wasOriginallyBlankInCell,
} from "./helpers/blankLineSnapshot";

// Rules
export { removalRules } from "./rules/removalRules";
export { additionRules } from "./rules/additionRules";
export { applyIndentationRules, removeSmallIndents } from "./rules/indentationRules";

// Helper functions
export {
  isParagraphBlank,
  startsWithBoldColon,
  isCenteredBoldText,
  isTextOnlyParagraph,
  isTocParagraph,
} from "./helpers/paragraphChecks";

export {
  isImageSmall,
  isSmallImageParagraph,
  getImageRunFromParagraph,
} from "./helpers/imageChecks";

export {
  isWithinListContext,
  isWithinListContextInCell,
} from "./helpers/contextChecks";

export {
  createBlankParagraph,
  insertOrMarkBlankAfter,
  insertOrMarkBlankBefore,
} from "./helpers/blankLineInsertion";

export { clearCustom } from "./helpers/clearCustom";

export { removeTrailingBlanksInTableCells } from "./helpers/removeTrailingBlanks";

export { removeBlanksBetweenListItems } from "./helpers/removeBlanksBetweenListItems";
