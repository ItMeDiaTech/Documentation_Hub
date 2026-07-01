/**
 * List normalization module
 *
 * Moved from docxmlater to dochub-app for processing-level customization.
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
  parseTypedMarkerValue,
  disambiguateRomanMarker,
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
  createMixedListNumId,
  restampMixedListBulletFonts,
} from "./ListNormalizer";

// Body-level orphan-level computation (pure)
export type { OrphanLevelEvent } from "./orphanLevels";
export { computeOrphanBodyListShifts } from "./orphanLevels";
