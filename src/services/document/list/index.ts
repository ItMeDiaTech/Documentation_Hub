/**
 * List normalization module
 *
 * Moved from docxmlater to Template_UI for processing-level customization.
 * Provides typed list prefix detection and normalization to proper Word formatting.
 */

// Types
export type {
  ListCategory,
  NumberFormat,
  BulletFormat,
  ListDetectionResult,
  ListAnalysis,
  IndentationLevel,
  ListNormalizationOptions,
  ListNormalizationReport,
} from "./list-types";

// Detection utilities
export {
  TYPED_LIST_PATTERNS,
  PATTERN_TO_CATEGORY,
  FORMAT_TO_LEVEL,
  getLevelFromFormat,
  inferLevelFromIndentation,
  inferLevelFromRelativeIndentation,
  detectTypedPrefix,
  getParagraphIndentation,
  detectListType,
  validateListSequence,
  getListCategoryFromFormat,
} from "./list-detection";

// Normalization
export {
  ListNormalizer,
  analyzeCellLists,
  analyzeTableLists,
  normalizeListsInCell,
  normalizeListsInTable,
  normalizeOrphanListLevelsInCell,
  normalizeOrphanListLevelsInTable,
  stripTypedPrefix,
} from "./ListNormalizer";
