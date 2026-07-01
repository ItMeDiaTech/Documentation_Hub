/**
 * ListNormalizer - Core list normalization for document processing
 *
 * Moved from docxmlater to dochub-app for processing-level customization.
 * Detects typed list prefixes and converts them to proper Word list formatting.
 * Integrates with NumberingManager for numId resolution.
 */

import type {
  Document,
  Paragraph,
  Run,
  Table,
  TableCell,
  NumberingManager,
  NumberFormat as DocxNumberFormat,
} from "docxmlater";
import { isRun, inchesToTwips, WORD_NATIVE_BULLETS } from "docxmlater";
import { logger } from "@/utils/logger";
import type {
  ListCategory,
  ListAnalysis,
  ListNormalizationOptions,
  ListNormalizationReport,
  NumberFormat,
  IndentationLevel,
} from "./list-types";
import {
  detectListType,
  getListCategoryFromFormat,
  inferLevelFromRelativeIndentation,
  parseTypedMarkerValue,
} from "./list-detection";

// =============================================================================
// INDENTATION SETTINGS HELPERS
// =============================================================================

/**
 * Apply user's indentation settings to an abstract numbering definition.
 */
function applyIndentationSettings(
  abstractNum: ReturnType<NumberingManager["getAbstractNumbering"]>,
  indentationLevels: IndentationLevel[],
  isBulletList: boolean,
  extraHangingIndentTwips: number = 0
): void {
  if (!abstractNum || !indentationLevels || indentationLevels.length === 0) return;

  for (const levelConfig of indentationLevels) {
    const level = abstractNum.getLevel(levelConfig.level);
    if (level) {
      // Only apply wider hanging indent to numbered lists, not bullets
      const extra = isBulletList ? 0 : extraHangingIndentTwips;
      const textIndentTwips = inchesToTwips(levelConfig.textIndent) + extra;
      const symbolIndentTwips = inchesToTwips(levelConfig.symbolIndent);
      const hangingTwips = textIndentTwips - symbolIndentTwips;

      level.setLeftIndent(textIndentTwips);
      level.setHangingIndent(hangingTwips);

      if (isBulletList && levelConfig.bulletChar) {
        level.setText(levelConfig.bulletChar);
      }
      if (!isBulletList && levelConfig.numberedFormat) {
        level.setFormat(levelConfig.numberedFormat as NumberFormat);
        level.setText(`%${levelConfig.level + 1}.`);
      }
    }
  }
}

// =============================================================================
// MIXED-LIST DEFINITIONS
// =============================================================================
//
// Two multi-level abstract numbering patterns used when a contiguous list
// group contains both bullets and numbers. Within a mixed group every item
// (lead and subordinated) shares ONE numId, with each item placed at the
// appropriate level. This matches how Word natively represents mixed
// multi-level lists.
//
// NUMBERED_LEAD: top-level is decimal, sub-levels alternate filled/open
// circles (no filled squares — explicitly skipped per the spec).
//
// BULLET_LEAD: top-level is the filled bullet, sub-levels cycle through
// decimal → lowerLetter → lowerRoman → upperLetter → upperRoman, then
// repeat the cycle.

type MixedLevelSpec = {
  format: DocxNumberFormat;
  text: string;
  font?: string;
};

// Bullet character + font use docxmlater's WORD_NATIVE_BULLETS encoding:
// - Filled bullet:  U+F0B7 in Symbol      (matches createBulletLevel(0,3,6))
// - Open circle:    U+006F in Courier New (matches createBulletLevel(1,4,7))
// This is Word's native PUA encoding — what docxmlater stamps when you call
// `manager.createBulletList()`. We use the same so that downstream
// uniformity passes that compare against `WORD_NATIVE_BULLETS.*.char` see
// matches and don't try to "fix" our mixed bullets into something else.
//
// IMPORTANT: docxmlater's `doc.standardizeNumberedListPrefixes` framework
// call overwrites the font of every level of every numbered abstract
// (including mixed numbered-lead abstracts) to Verdana, which has no glyph
// for U+F0B7 (rendered as .notdef rectangle). WordDocumentProcessor MUST
// call `restampMixedListBulletFonts(doc, mixedAbstractNumIds)` immediately
// after that framework call to restore Symbol/Courier-New on bullet levels.
const FILLED = WORD_NATIVE_BULLETS.FILLED_BULLET; // { char: '', font: 'Symbol' }
const OPEN = WORD_NATIVE_BULLETS.OPEN_CIRCLE;     // { char: 'o', font: 'Courier New' }
const SQUARE = WORD_NATIVE_BULLETS.FILLED_SQUARE; // Wingdings filled square

// Mixed-list pattern is DYNAMIC and BIDIRECTIONAL, built per-group from:
//   • lead: the category at level 0 ("bullet" or "numbered")
//   • switchLevel: the source ilvl where the OTHER category first appears
//     (null when no cross-category exists)
//
// Rule:
//   • Levels 0..switchLevel-1: follow the LEAD pattern
//       - lead "bullet"   → alternating closed/open bullets
//       - lead "numbered" → decimal (level 0) + letter/roman cascade
//   • Level switchLevel: the switching format
//       - lead "bullet"   → decimal "1."     (bullet → number transition)
//       - lead "numbered" → closed bullet ●  (number → bullet transition)
//   • Levels switchLevel+1..8: continue in the CROSS-CATEGORY mode
//       - lead "bullet"   → letter/roman cascade (a., i., A., I., …)
//       - lead "numbered" → alternating open/closed bullets (○, ●, ○, ●, …)
//
// Examples:
//   lead=numbered, switchLevel=null: 1., a., i., A., I., a., i., A., I.
//   lead=bullet, switchLevel=null:   ●, ○, ●, ○, ●, ○, ●, ○, ●
//   lead=numbered, switchLevel=2:    1., a., ●, ○, ●, ○, ●, ○, ●   (Image #14)
//   lead=bullet,   switchLevel=2:    ●, ○, 1., a., i., A., I., a., i. (List.docx)
//   lead=numbered, switchLevel=1 (same-level conflict): 1., ●, ○, ●, ○, ●, ○, ●, ○
//   lead=bullet,   switchLevel=1 (same-level conflict): ●, 1., a., i., A., I., a., i., A.
export function buildMixedPattern(
  lead: "bullet" | "numbered",
  switchLevel: number | null
): MixedLevelSpec[] {
  const pattern: MixedLevelSpec[] = [];
  const NUMERIC_CASCADE: DocxNumberFormat[] = [
    "lowerLetter",
    "lowerRoman",
    "upperLetter",
    "upperRoman",
  ];
  // Non-bullet levels MUST explicitly set a font, otherwise they inherit
  // Symbol from the underlying createBulletList() template (mapping "1" → 📁,
  // "a" → α, "b" → β). Pinning Verdana matches DocHub's standard typography.
  const NUMERIC_FONT = "Verdana";

  // Lead-style format at a given offset from level 0.
  const leadFormat = (offset: number): MixedLevelSpec => {
    if (lead === "bullet") {
      return offset % 2 === 0
        ? { format: "bullet", text: FILLED.char, font: FILLED.font }
        : { format: "bullet", text: OPEN.char, font: OPEN.font };
    }
    // numbered lead: level 0 = decimal, then letter/roman cascade
    if (offset === 0) {
      return { format: "decimal", text: "%1.", font: NUMERIC_FONT };
    }
    const fmt = NUMERIC_CASCADE[(offset - 1) % NUMERIC_CASCADE.length]!;
    return { format: fmt, text: `%${offset + 1}.`, font: NUMERIC_FONT };
  };

  // Cross-style format after a switch (offset 0 = at the switch).
  const crossFormat = (offsetFromSwitch: number, absoluteLevel: number): MixedLevelSpec => {
    if (lead === "bullet") {
      // After bullet→number switch: decimal at offset 0, then letter/roman cascade.
      if (offsetFromSwitch === 0) {
        return { format: "decimal", text: `%${absoluteLevel + 1}.`, font: NUMERIC_FONT };
      }
      const fmt = NUMERIC_CASCADE[(offsetFromSwitch - 1) % NUMERIC_CASCADE.length]!;
      return { format: fmt, text: `%${absoluteLevel + 1}.`, font: NUMERIC_FONT };
    }
    // After number→bullet switch: closed at offset 0, open/closed alternating.
    return offsetFromSwitch % 2 === 0
      ? { format: "bullet", text: FILLED.char, font: FILLED.font }
      : { format: "bullet", text: OPEN.char, font: OPEN.font };
  };

  for (let i = 0; i < 9; i++) {
    if (switchLevel === null || i < switchLevel) {
      pattern.push(leadFormat(i));
    } else {
      pattern.push(crossFormat(i - switchLevel, i));
    }
  }
  return pattern;
}

/**
 * Restore bullet-level font on mixed-list abstracts that may have been
 * clobbered by `doc.standardizeNumberedListPrefixes()` (which sets font=Verdana
 * on every level of every non-bullet-lead abstract — including the bullet
 * sub-levels of our numbered-lead mixed abstracts).
 *
 * Detects lead from level-0 format (`bullet` → BULLET_LEAD, else NUMBERED_LEAD)
 * and re-stamps font + text on every bullet level matching that pattern.
 * Re-registers the abstractNum so the manager picks up the changes during save.
 */
export function restampMixedListBulletFonts(
  doc: Document,
  mixedAbstractNumIds: Set<number>
): number {
  if (!mixedAbstractNumIds || mixedAbstractNumIds.size === 0) return 0;
  const manager = doc.getNumberingManager();
  let restored = 0;
  for (const absId of mixedAbstractNumIds) {
    const abstractNum = manager.getAbstractNumbering(absId);
    if (!abstractNum) continue;
    // Pattern-agnostic restamp: for each level currently marked as bullet,
    // re-pin the font based on the level's text char (Symbol for filled disc,
    // Courier New for open). Works for any dynamic pattern shape — including
    // the bidirectional bullet/number switching introduced in v5.12.22.
    let changed = false;
    for (let i = 0; i < 9; i++) {
      const lvl = abstractNum.getLevel(i);
      if (!lvl) continue;
      if (lvl.getFormat() !== "bullet") continue;
      const txt = lvl.getProperties().text ?? "";
      if (txt === FILLED.char) {
        lvl.setFont(FILLED.font);
        changed = true;
      } else if (txt === OPEN.char) {
        lvl.setFont(OPEN.font);
        changed = true;
      } else if (txt === SQUARE.char) {
        lvl.setFont(SQUARE.font);
        changed = true;
      }
    }
    if (changed) {
      manager.addAbstractNumbering(abstractNum);
      restored++;
    }
  }
  return restored;
}

/**
 * Create a multi-level abstract numbering for a mixed (bullet+numbered) group.
 * Returns the numId. The abstractNum has 9 levels formatted per the lead's
 * pattern. User indentation settings (left/hanging indent) are applied if
 * provided; bullet character and number format come exclusively from the
 * pattern so a mixed list looks consistent regardless of user preferences.
 */
export function createMixedListNumId(
  manager: NumberingManager,
  lead: "numbered" | "bullet",
  switchLevel: number | null,
  indentationLevels?: IndentationLevel[],
  extraHangingIndentTwips: number = 0
): number {
  // Clamp switchLevel to [0, 8] or pass null (no cross-category in source).
  // If lead=="numbered" with switchLevel=0, the cross would collide with lead
  // at level 0 — push to 1. Similarly for bullet-lead at switchLevel=0.
  const S =
    switchLevel === null
      ? null
      : Math.min(8, Math.max(1, switchLevel));
  const pattern = buildMixedPattern(lead, S);

  // Use the matching base list so multiLevelType is correct.
  let numId =
    lead === "numbered" ? manager.createNumberedList() : manager.createBulletList();

  const instance = manager.getInstance(numId);
  if (!instance) return numId;
  const abstractNum = manager.getAbstractNumbering(instance.getAbstractNumId());
  if (!abstractNum) return numId;

  // Apply user's indents per level (left + hanging only — not format/char).
  if (indentationLevels?.length) {
    for (const levelConfig of indentationLevels) {
      const lvl = abstractNum.getLevel(levelConfig.level);
      if (!lvl) continue;
      const isBulletAtLevel = pattern[levelConfig.level]?.format === "bullet";
      const extra = isBulletAtLevel ? 0 : extraHangingIndentTwips;
      const textIndentTwips = inchesToTwips(levelConfig.textIndent) + extra;
      const symbolIndentTwips = inchesToTwips(levelConfig.symbolIndent);
      lvl.setLeftIndent(textIndentTwips);
      lvl.setHangingIndent(textIndentTwips - symbolIndentTwips);
    }
  }

  // Stamp the pattern's format/text/font onto every level. This overrides
  // anything applied by createNumberedList/createBulletList defaults and
  // (for numbered-lead) the decimal/letter/roman rotation that Word ships.
  for (let i = 0; i < pattern.length; i++) {
    const lvl = abstractNum.getLevel(i);
    if (!lvl) continue;
    const spec = pattern[i]!;
    lvl.setFormat(spec.format);
    lvl.setText(spec.text);
    if (spec.font) lvl.setFont(spec.font);
  }

  // CRITICAL: re-register so the manager marks this abstractNum as modified.
  // NumberingLevel setters (setFormat / setText / setFont / setLeftIndent /
  // etc.) mutate the in-memory model but do NOT notify the manager, so the
  // changes get dropped during save unless we re-add. Same pattern used by
  // applyBulletUniformity:8660.
  manager.addAbstractNumbering(abstractNum);

  // Restart so a fresh mixed list begins at 1 rather than continuing a
  // previous list's counter.
  numId = manager.restartNumbering(numId);
  return numId;
}

// =============================================================================
// ANALYSIS FUNCTIONS
// =============================================================================

/** Internal type for analyzed paragraph data */
interface AnalyzedParagraph {
  paragraph: Paragraph;
  text: string;
  detection: ReturnType<typeof detectListType>;
}

/**
 * Determine majority category using OVERALL counts.
 * Counts ALL list items equally (Word lists + typed prefixes).
 * NUMBERED wins ties (business document standard).
 */
function determineMajorityCategory(analyzed: AnalyzedParagraph[]): ListCategory {
  let bulletCount = 0;
  let numberedCount = 0;

  for (const item of analyzed) {
    // Count BOTH Word lists AND typed prefixes equally
    if (item.detection.category === "bullet") {
      bulletCount++;
    } else if (item.detection.category === "numbered") {
      numberedCount++;
    }
  }

  // No list items at all
  if (bulletCount === 0 && numberedCount === 0) return "none";

  // NUMBERED wins ties (business document standard)
  // Bullets only win if strictly more bullets than numbers
  return numberedCount >= bulletCount ? "numbered" : "bullet";
}

/**
 * Analyze all paragraphs in a cell for list properties.
 */
export function analyzeCellLists(
  cell: TableCell,
  numberingManager?: NumberingManager
): ListAnalysis {
  const paragraphs = cell.getParagraphs();

  const analyzed: AnalyzedParagraph[] = paragraphs.map((p) => ({
    paragraph: p,
    text: p.getText(),
    detection: detectListType(p),
  }));

  // Refine Word list categories using NumberingManager
  // detectListType() defaults ALL Word lists to "numbered", but we need to
  // look up the actual format to correctly identify bullets vs numbers
  if (numberingManager) {
    for (const item of analyzed) {
      if (item.detection.isWordList && item.detection.numId !== null) {
        // Look up the actual format from numbering.xml
        const instance = numberingManager.getInstance(item.detection.numId);
        if (instance) {
          const abstractNum = numberingManager.getAbstractNumbering(instance.getAbstractNumId());
          if (abstractNum) {
            const level = abstractNum.getLevel(item.detection.ilvl ?? 0);
            if (level) {
              const format = level.getFormat();
              // Refine the category based on actual format
              item.detection.category = getListCategoryFromFormat(format);
            }
          }
        }
      }
    }
  }

  // Count by category
  const counts = { numbered: 0, bullet: 0, none: 0 };
  let hasTypedLists = false;
  let hasWordLists = false;

  for (const item of analyzed) {
    const cat = item.detection.category;
    counts[cat]++;

    if (!item.detection.isWordList && item.detection.typedPrefix) {
      hasTypedLists = true;
    }
    if (item.detection.isWordList) {
      hasWordLists = true;
    }
  }

  // Determine majority using OVERALL counts (Word + typed equally)
  const majorityCategory = determineMajorityCategory(analyzed);

  // Determine if normalization is needed:
  // - Has typed prefixes that need structural conversion to Word lists, OR
  // - Has Word lists (mixed or otherwise) whose numIds may need to be reassigned
  //   to user-configured definitions. Mixed bullet+numbered lists are preserved
  //   in their original categories — no cross-type conversion.
  const hasMixedCategories = counts.numbered > 0 && counts.bullet > 0;
  const needsNormalization = hasTypedLists || hasMixedCategories;

  return {
    paragraphs: analyzed,
    hasTypedLists,
    hasWordLists,
    hasMixedCategories,
    majorityCategory,
    counts,
    recommendedAction: needsNormalization ? "normalize" : "none",
  };
}

/**
 * Analyze lists in an entire table.
 * Returns analysis per cell.
 */
export function analyzeTableLists(table: Table): Map<TableCell, ListAnalysis> {
  const results = new Map<TableCell, ListAnalysis>();

  for (const row of table.getRows()) {
    for (const cell of row.getCells()) {
      results.set(cell, analyzeCellLists(cell));
    }
  }

  return results;
}

// =============================================================================
// NORMALIZATION FUNCTIONS
// =============================================================================

/**
 * Strip typed prefix from paragraph text.
 * Handles prefixes that may be split across multiple runs.
 * Also trims leading whitespace from the remaining content.
 */
export function stripTypedPrefix(paragraph: Paragraph, prefix: string): void {
  const content = paragraph.getContent();
  let remainingPrefix = prefix;
  let prefixFullyStripped = false;
  // Track whether the prefix was stripped mid-run with content remaining.
  // When true, the next run's leading space is an inter-word separator, not
  // leftover prefix whitespace, so it must NOT be trimmed.
  let strippedMidRunWithContent = false;

  for (const item of content) {
    if (isRun(item)) {
      const run = item as Run;
      const text = run.getText();

      if (!prefixFullyStripped && remainingPrefix.length > 0) {
        if (text.length <= remainingPrefix.length) {
          // Entire run is part of prefix
          if (remainingPrefix.startsWith(text)) {
            remainingPrefix = remainingPrefix.substring(text.length);
            run.setText(""); // Clear this run
            if (remainingPrefix.length === 0) {
              prefixFullyStripped = true;
            }
          }
        } else {
          // Partial match - strip prefix portion
          if (text.startsWith(remainingPrefix)) {
            const afterPrefix = text.substring(remainingPrefix.length).trimStart();
            run.setText(afterPrefix);
            prefixFullyStripped = true;
            // If there's actual content left in this run after stripping,
            // the next run's leading space is an inter-word separator
            if (afterPrefix.length > 0) {
              strippedMidRunWithContent = true;
            }
          }
        }
      } else if (prefixFullyStripped && !strippedMidRunWithContent) {
        // Only trim the next run if the prefix was consumed at a run boundary
        // (not mid-run with content remaining). Otherwise the leading space
        // is an inter-word separator (e.g., " spreadsheets" after "All").
        const currentText = run.getText();
        if (currentText.length > 0) {
          const trimmed = currentText.trimStart();
          if (trimmed !== currentText) {
            run.setText(trimmed);
          }
          // Only break if we found actual content (not just whitespace that got trimmed away)
          if (trimmed.length > 0) {
            break;
          }
        }
      } else if (strippedMidRunWithContent) {
        // Prefix was stripped mid-run and content remains — stop processing
        break;
      }
    }
  }
}

/**
 * Normalize all lists in a cell to consistent formatting.
 * KEY BEHAVIORS:
 * - Each Word-list item keeps its own category — mixed bullet+numbered cells are allowed
 * - Format determines level: decimal=0, letter=1, roman=2
 * - Word-list numIds are reassigned to user-configured definitions (same category)
 * - Non-list items are NEVER touched
 * - User indentation settings are applied when provided
 *
 * FIX: Standalone typed decimal lists (1., 2., 3.) are no longer
 * incorrectly assigned to level 2 based on paragraph indentation.
 * Indentation-based nesting only applies when format also suggests nesting.
 */
export function normalizeListsInCell(
  cell: TableCell,
  options: ListNormalizationOptions,
  numberingManager: NumberingManager,
  // Source numId -> ONE shared restarted instance for numbered lists that flow
  // down a column as a single item per cell (computed in normalizeListsInTable).
  // Such lists must CONTINUE (1,2,3) across cells, not restart to 1 per cell.
  sharedRestartMap?: ReadonlyMap<number, number>
): ListNormalizationReport {
  const analysis = analyzeCellLists(cell, numberingManager);
  const majorityCategory = analysis.majorityCategory;
  const report: ListNormalizationReport = {
    normalized: 0,
    skipped: 0,
    errors: [],
    appliedCategory: majorityCategory,
    details: [],
  };

  // Handle cells that don't need category normalization but may need indentation fixes
  if (analysis.recommendedAction === "none") {
    // Even if no normalization needed, still apply user indentation settings to Word lists.
    // Modify existing abstract numbering definitions in-place rather than creating new
    // numIds. This preserves original bullet characters, parent-child list semantics
    // (shared numId across levels), and ilvl assignments.
    if (options?.indentationLevels?.length && analysis.hasWordLists) {
      const updatedAbstractNums = new Set<number>();

      for (const item of analysis.paragraphs) {
        if (item.detection.isWordList && item.detection.numId !== null) {
          const para = item.paragraph as Paragraph;
          const numbering = para.getNumbering();
          if (numbering) {
            const instance = numberingManager.getInstance(numbering.numId);
            if (instance) {
              const abstractNumId = instance.getAbstractNumId();
              if (!updatedAbstractNums.has(abstractNumId)) {
                const abstractNum = numberingManager.getAbstractNumbering(abstractNumId);
                if (abstractNum) {
                  const isBullet = item.detection.category === "bullet";
                  applyIndentationSettings(
                    abstractNum,
                    options.indentationLevels!,
                    isBullet,
                    options.extraHangingIndentTwips ?? 0
                  );
                  updatedAbstractNums.add(abstractNumId);
                }
              }
            }
            report.normalized++;
            report.details.push({
              originalText: item.text.substring(0, 50),
              action: "normalized",
              reason: `Applied indentation settings in-place at level ${numbering.level}`,
            });
          }
        }
      }
    }

    // Restart numbering per original numId so each cell gets independent numbering.
    // restartNumbering() creates a new instance that starts at 1, preventing cross-cell
    // numId sharing that causes continuation (e.g., 5. instead of 1.)
    if (analysis.hasWordLists) {
      const restartedNumIds = new Map<number, number>();

      for (const item of analysis.paragraphs) {
        if (item.detection.isWordList && item.detection.numId !== null) {
          const para = item.paragraph as Paragraph;
          const numbering = para.getNumbering();
          if (numbering) {
            const shared = sharedRestartMap?.get(numbering.numId);
            if (shared !== undefined) {
              // Column-spanning numbered list: reuse the ONE shared restarted
              // instance so it continues 1,2,3 down the column instead of
              // restarting to 1 in every cell.
              para.setNumbering(shared, numbering.level);
            } else {
              if (!restartedNumIds.has(numbering.numId)) {
                restartedNumIds.set(
                  numbering.numId,
                  numberingManager.restartNumbering(numbering.numId)
                );
              }
              const newNumId = restartedNumIds.get(numbering.numId)!;
              para.setNumbering(newNumId, numbering.level);
            }
          }
        }
      }
    } else {
      report.skipped = analysis.paragraphs.length;
    }

    // Always normalize orphan levels even when no other normalization needed
    normalizeOrphanListLevelsInCell(cell);
    return report;
  }

  // Calculate baseline (minimum) indentation for relative level inference
  let baselineIndent = Infinity;
  for (const item of analysis.paragraphs) {
    if (item.detection.category !== "none") {
      baselineIndent = Math.min(baselineIndent, item.detection.indentationTwips);
    }
  }
  if (baselineIndent === Infinity) baselineIndent = 0;

  // Calculate level shifts PER LEVEL-SHIFT GROUP based on ALL list items
  // (majority + minority). Including minority items prevents shifting when
  // low-level minority items exist (e.g., numbered items at ilvl=0 among
  // bullet sub-items at ilvl=1+).
  //
  // NOTE: a "level-shift group" here is a SEPARATE partition from the
  // subordination "group" (`groupInfoByIndex` / `groupRecords`) computed
  // further below — different rules, different purpose. Do not conflate them.
  //
  // A level-shift group is a run of list items. Physically contiguous list
  // items always share a group. A non-list paragraph (e.g. an interjected
  // "Note:" line) only ENDS the group if the list does NOT resume with the
  // same numId afterwards: a same-numId item across the gap is the same Word
  // list and must keep one shared level baseline. Otherwise a sub-item
  // stranded after the gap forms its own group and is wrongly flattened to
  // level 0.
  const levelShiftByIndex = new Map<number, number>();
  let groupIndices: number[] = [];
  let groupMinLevel = Infinity;
  // numIds of the CURRENT contiguous segment (a run of list items with no
  // interleaved non-list paragraph). When the list resumes after a gap the
  // resuming item is matched against ONLY the segment that immediately
  // preceded the gap (`numIdsBeforeGap`), never a cumulative set — so an
  // unrelated list interleaved between two same-numId segments cannot
  // transitively keep them merged.
  let segmentNumIds = new Set<number>();
  let numIdsBeforeGap: Set<number> | null = null;

  const finalizeLevelShiftGroup = () => {
    if (groupIndices.length > 0) {
      const shift = groupMinLevel === Infinity ? 0 : groupMinLevel;
      for (const j of groupIndices) {
        levelShiftByIndex.set(j, shift);
      }
    }
    groupIndices = [];
    groupMinLevel = Infinity;
    segmentNumIds = new Set<number>();
    numIdsBeforeGap = null;
  };

  for (let i = 0; i < analysis.paragraphs.length; i++) {
    const item = analysis.paragraphs[i]!;

    if (item.detection.category === "none") {
      // Non-list paragraph: freeze the just-ended segment's numIds (only the
      // first gap paragraph after a segment freezes) so the resuming item can
      // be matched against it.
      if (groupIndices.length > 0 && numIdsBeforeGap === null) {
        numIdsBeforeGap = segmentNumIds;
      }
      continue;
    }

    const numId = item.detection.numId;
    if (numIdsBeforeGap !== null) {
      // Resuming after a gap: continue the group only when this item shares a
      // numId with the segment immediately before the gap (same Word list).
      const sameList = numId !== null && numIdsBeforeGap.has(numId);
      if (!sameList) finalizeLevelShiftGroup();
      // A new contiguous segment starts here regardless.
      segmentNumIds = new Set<number>();
      numIdsBeforeGap = null;
    }

    groupIndices.push(i);
    groupMinLevel = Math.min(groupMinLevel, item.detection.inferredLevel);
    if (numId !== null) segmentNumIds.add(numId);
  }

  // Handle the trailing group.
  finalizeLevelShiftGroup();

  // Per-item group info for minority subordination.
  // A "group" is a contiguous run of list items. Items keep stay in the same
  // group while same-category or while cross-category within
  // SUBORDINATION_MAX_LINES non-list paragraphs. A cross-category item that
  // appears > SUBORDINATION_MAX_LINES later starts a new group.
  //
  // A group becomes "mixed" the moment a second category appears within
  // proximity. Items in a mixed group all share ONE multi-level "mixed list"
  // numId (lead items at level 0, subordinated items at level 1+). Items in
  // a non-mixed group use the regular per-category numIds.
  type GroupRecord = {
    lead: "numbered" | "bullet";
    isMixed: boolean;
    switchLevel: number | null;
  };
  type GroupInfo = {
    groupId: number;
    lead: "numbered" | "bullet";
    isMixed: boolean;
    switchLevel: number | null;
  };
  const subordinateEnabled = options.subordinateMinorityCategory !== false;
  const SUBORDINATION_MAX_LINES = 2;
  const groupInfoByIndex = new Map<number, GroupInfo>();
  const groupRecords: GroupRecord[] = [];
  // Per-group source levels per category, used to compute switchLevel —
  // the first cross-category source level not occupied by the lead category.
  const bulletLevelsByGroup = new Map<number, Set<number>>();
  const numberedLevelsByGroup = new Map<number, Set<number>>();
  // Per-group category presence (any group with >1 category is mixed).
  const groupCategories = new Map<number, Set<"bullet" | "numbered">>();
  if (subordinateEnabled) {
    let currentGroupId = -1;
    let linesSinceLastListItem = 0;
    for (let i = 0; i < analysis.paragraphs.length; i++) {
      const item = analysis.paragraphs[i]!;
      if (item.detection.category !== "none") {
        const cat = item.detection.category as "numbered" | "bullet";
        const level = item.detection.ilvl ?? item.detection.inferredLevel ?? 0;
        if (currentGroupId === -1) {
          currentGroupId = groupRecords.length;
          groupRecords.push({ lead: cat, isMixed: false, switchLevel: null });
        } else if (
          cat !== groupRecords[currentGroupId]!.lead &&
          linesSinceLastListItem > SUBORDINATION_MAX_LINES
        ) {
          // Cross-category and too far → new group with this item as new lead.
          currentGroupId = groupRecords.length;
          groupRecords.push({ lead: cat, isMixed: false, switchLevel: null });
        }
        // Track categories present in this group.
        let cats = groupCategories.get(currentGroupId);
        if (!cats) {
          cats = new Set();
          groupCategories.set(currentGroupId, cats);
        }
        cats.add(cat);
        // Track source levels per category for switchLevel computation.
        if (cat === "numbered") {
          let lvls = numberedLevelsByGroup.get(currentGroupId);
          if (!lvls) {
            lvls = new Set();
            numberedLevelsByGroup.set(currentGroupId, lvls);
          }
          lvls.add(level);
        } else {
          let lvls = bulletLevelsByGroup.get(currentGroupId);
          if (!lvls) {
            lvls = new Set();
            bulletLevelsByGroup.set(currentGroupId, lvls);
          }
          lvls.add(level);
        }
        // Snapshot the lead now; isMixed + switchLevel patched after loop.
        groupInfoByIndex.set(i, {
          groupId: currentGroupId,
          lead: groupRecords[currentGroupId]!.lead,
          isMixed: false,
          switchLevel: null,
        });
        linesSinceLastListItem = 0;
      } else {
        linesSinceLastListItem++;
      }
    }
    // Finalize per-group state.
    // switchLevel = source ilvl where the dynamic pattern transitions from
    // lead-mode to cross-mode. It's the shallowest cross-category source
    // level that's not occupied by the lead category (a same-level conflict
    // bumps the switch one level deeper).
    for (let gid = 0; gid < groupRecords.length; gid++) {
      const cats = groupCategories.get(gid) ?? new Set();
      const rec = groupRecords[gid]!;
      rec.isMixed = cats.size > 1;
      if (!rec.isMixed) {
        rec.switchLevel = null;
        continue;
      }
      const bulletLevels = bulletLevelsByGroup.get(gid) ?? new Set<number>();
      const numberedLevels = numberedLevelsByGroup.get(gid) ?? new Set<number>();
      let candidate: number;
      let leadLevels: Set<number>;
      if (rec.lead === "numbered") {
        candidate = bulletLevels.size > 0 ? Math.min(...bulletLevels) : 1;
        leadLevels = numberedLevels;
      } else {
        candidate = numberedLevels.size > 0 ? Math.min(...numberedLevels) : 1;
        leadLevels = bulletLevels;
      }
      candidate = Math.max(1, candidate);
      while (leadLevels.has(candidate) && candidate < 8) candidate++;
      rec.switchLevel = candidate;
    }
    for (const info of groupInfoByIndex.values()) {
      const rec = groupRecords[info.groupId]!;
      info.isMixed = rec.isMixed;
      info.switchLevel = rec.switchLevel;
    }
  }

  // Lazy cache of mixed-list numIds, one per mixed group. Created on first
  // access by any item belonging to that group. The abstractNumId is also
  // registered in the optional tracking Set so downstream passes (bullet /
  // numbered uniformity) can skip these definitions and preserve the
  // mixed-list pattern.
  const mixedNumIdByGroupId = new Map<number, number>();
  const getMixedNumIdForGroup = (
    groupId: number,
    lead: "numbered" | "bullet",
    switchLevel: number | null
  ): number => {
    let id = mixedNumIdByGroupId.get(groupId);
    if (id === undefined) {
      id = createMixedListNumId(
        numberingManager,
        lead,
        switchLevel,
        options.indentationLevels,
        options.extraHangingIndentTwips ?? 0
      );
      if (options.trackMixedListAbstractNumIds) {
        const inst = numberingManager.getInstance(id);
        if (inst) options.trackMixedListAbstractNumIds.add(inst.getAbstractNumId());
      }
      mixedNumIdByGroupId.set(groupId, id);
    }
    return id;
  };

  // Track numId per (level, segment) — segment encodes the ORIGINAL list
  // identity so two originally-distinct numbered lists in the same cell stay
  // distinct, while items that originally shared a list continue together.
  // Caching purely per-level (the old behavior) forced unrelated lists into one
  // continuous sequence. Deeper-level entries are still evicted when a shallower
  // level reappears so a re-entered nesting starts a fresh sub-counter.
  const numIdByLevelSegment = new Map<string, number>();
  let lastProcessedLevel = -1;

  // Helper to get/create a numbered (decimal) numId for a level + segment.
  // Always numbered — category is decided per item by the caller. `segment`
  // identifies the source list (original numId for Word lists, a typed-segment
  // token for typed prefixes); a new segment yields a fresh restarted numId.
  const getNumberedNumId = (level: number, segment: string): number => {
    if (level < lastProcessedLevel) {
      for (const existingKey of numIdByLevelSegment.keys()) {
        if (Number(existingKey.split("|", 1)[0]) > level) {
          numIdByLevelSegment.delete(existingKey);
        }
      }
    }
    lastProcessedLevel = level;

    const key = `${level}|${segment}`;
    if (!numIdByLevelSegment.has(key)) {
      let numId = numberingManager.createNumberedList();

      // Apply user's indentation settings if provided
      if (options?.indentationLevels?.length) {
        const instance = numberingManager.getInstance(numId);
        if (instance) {
          const abstractNum = numberingManager.getAbstractNumbering(instance.getAbstractNumId());
          if (abstractNum) {
            applyIndentationSettings(
              abstractNum,
              options.indentationLevels,
              false,
              options.extraHangingIndentTwips ?? 0
            );
          }
        }
      }

      // Restart numbering so converted lists start at 1 instead of continuing
      // from a previous cell's sequence
      numId = numberingManager.restartNumbering(numId);

      numIdByLevelSegment.set(key, numId);
    }
    return numIdByLevelSegment.get(key)!;
  };

  // Separate tracking for bullet numIds (used for trailing bullets in numbered-majority cells)
  const bulletNumIdByLevel = new Map<number, number>();
  let lastBulletProcessedLevel = -1;

  const getBulletNumId = (level: number): number => {
    if (level < lastBulletProcessedLevel) {
      for (const existingLevel of bulletNumIdByLevel.keys()) {
        if (existingLevel > level) {
          bulletNumIdByLevel.delete(existingLevel);
        }
      }
    }
    lastBulletProcessedLevel = level;

    if (!bulletNumIdByLevel.has(level)) {
      const numId = numberingManager.createBulletList();
      bulletNumIdByLevel.set(level, numId);

      // Apply user's indentation settings if provided
      if (options?.indentationLevels?.length) {
        const instance = numberingManager.getInstance(numId);
        if (instance) {
          const abstractNum = numberingManager.getAbstractNumbering(instance.getAbstractNumId());
          if (abstractNum) {
            applyIndentationSettings(
              abstractNum,
              options.indentationLevels,
              true,
              options.extraHangingIndentTwips ?? 0
            );
          }
        }
      }
    }
    return bulletNumIdByLevel.get(level)!;
  };

  // Typed-prefix numbered continuity tracking, per (level, format).
  // For typed numbered lists we mirror the ORIGINAL document: a segment
  // continues while its numbers run sequentially (prev + 1) and restarts only
  // when the first detected number is 1 or the value does not follow the
  // previous one. Bias is toward continuation — any sequential run stays one
  // list. `segmentId` is bumped on each restart so getNumberedNumId hands out a
  // fresh numId; `lastValue` holds the last parsed marker for the (level,format).
  const typedNumberedState = new Map<string, { segmentId: number; lastValue: number | null }>();
  let typedSegmentCounter = 0;

  // Process each paragraph
  for (let index = 0; index < analysis.paragraphs.length; index++) {
    const item = analysis.paragraphs[index]!;
    const { paragraph, text, detection } = item;
    const para = paragraph as Paragraph;

    // Skip non-list items entirely - preserve "Note:", plain text, etc.
    if (detection.category === "none") {
      report.skipped++;
      report.details.push({
        originalText: text.substring(0, 50),
        action: "skipped",
        reason: "Not a list item - preserving original formatting",
      });
      continue;
    }

    try {
      const hasTypedPrefix = !!detection.typedPrefix;
      const isWordList = detection.isWordList;

      // Get the level shift for this paragraph's list group
      const levelShift = levelShiftByIndex.get(index) ?? 0;

      // Calculate target level
      // - For typed prefixes: use format-based level (decimal=0, letter=1, roman=2)
      //   unless BOTH format AND indentation suggest nesting
      // - For sub-items: use parent's normalized level + 1
      // - For Word lists: use format-based level with level shift applied
      let targetLevel: number;
      if (hasTypedPrefix) {
        const relativeIndent = detection.indentationTwips - baselineIndent;
        const indentBasedLevel = inferLevelFromRelativeIndentation(relativeIndent);

        if (indentBasedLevel === 0 && detection.inferredLevel > 0) {
          // No extra indent but format suggests nesting (e.g., "a." at level 1)
          targetLevel = Math.max(0, detection.inferredLevel - levelShift);
        } else if (indentBasedLevel > 0 && detection.inferredLevel === 0) {
          // Typed prefix with extra indentation from cell baseline.
          // For numbered formats (decimal, letter, roman), don't infer nesting from
          // indentation alone — "1.", "2.", "3." are level 0 regardless of indent.
          // For bullet/dash/arrow formats, indentation IS the nesting signal since
          // all bullet chars map to inferredLevel=0.
          if (
            detection.format === "bullet" ||
            detection.format === "dash" ||
            detection.format === "arrow"
          ) {
            targetLevel = indentBasedLevel;
          } else {
            targetLevel = 0;
          }
        } else {
          targetLevel = indentBasedLevel;
        }
      } else {
        targetLevel = Math.max(0, detection.inferredLevel - levelShift);
      }

      // For items in a mixed group, route to the group's shared multi-level
      // numId and SNAP the level to 0 (lead) or 1 (cross-category). The snap
      // matters when the source document already nested the cross-category
      // item — e.g., Word's autoformat puts bullets that follow "1." at
      // ilvl=1 of a multi-level numbered list. Without the snap, my old
      // `targetLevel + 1` logic would push them to ilvl=2, which the
      // numbered-lead pattern renders as the open circle (○) — exactly the
      // bug visible in the screenshot. Lead items snap to 0 likewise so a
      // natural sub-numbered "(a)" inside a numbered-lead group doesn't
      // accidentally land at level 1 and steal the bullet's slot.
      const groupInfo = subordinateEnabled ? groupInfoByIndex.get(index) : undefined;
      const useMixedNumId = !!(groupInfo && groupInfo.isMixed);
      let wasSubordinated = false;
      if (useMixedNumId) {
        // Dynamic-pattern routing using bidirectional switchLevel:
        //   lead-cat items: preserve source ilvl. The pattern format at the
        //     source level matches the lead-mode (or cross-mode if deeper
        //     than switchLevel, which is intended behavior).
        //   cross-cat items: snap to max(switchLevel, sourceIlvl). Items
        //     below the switch land at the switch slot; deeper cross items
        //     keep their source ilvl and render via the cross-mode cascade.
        const S = groupInfo!.switchLevel ?? 8;
        const sourceIlvl = detection.ilvl ?? detection.inferredLevel ?? targetLevel;
        const isLead = detection.category === groupInfo!.lead;
        if (isLead) {
          targetLevel = Math.max(0, Math.min(sourceIlvl, 8));
        } else {
          targetLevel = Math.max(S, Math.min(sourceIlvl, 8));
        }
        wasSubordinated = !isLead;
      }
      // Non-mixed groups CAN contain cross-category items when each category
      // occupies its own distinct level — that's a properly-nested multi-level
      // list. Preserve the source's targetLevel without bumping.

      // Process based on what type of item this is
      if (hasTypedPrefix && detection.typedPrefix) {
        // Typed prefix: strip prefix and apply new formatting
        stripTypedPrefix(para, detection.typedPrefix);

        // Route by the typed prefix's own category. Bullet-like formats
        // (bullet, dash, arrow) go to a bullet numId; numeric formats
        // (decimal, lowerLetter, lowerRoman, etc.) go to a numbered numId.
        const isBulletTypedPrefix =
          detection.category === "bullet" ||
          detection.format === "bullet" ||
          detection.format === "dash" ||
          detection.format === "arrow";

        // For typed NUMBERED prefixes, mirror the original document's
        // continuation: continue the current segment while markers run
        // sequentially (prev + 1) and restart only when the first detected
        // value is 1 or the value does not follow the previous one. The
        // continue-vs-restart decision keys on the parsed marker value, not on
        // physical contiguity, so an interrupting prose paragraph between two
        // sequential numbers keeps them in one list. Format is part of the
        // state key so a decimal → lowerLetter switch at the same level starts
        // a fresh sequence (replacing the old lastTypedFormatByLevel reset).
        let typedSegment = "";
        if (!isBulletTypedPrefix && !useMixedNumId) {
          const stateKey = `${targetLevel}|${detection.format ?? "unknown"}`;
          const value = parseTypedMarkerValue(detection.typedPrefix);
          const prev = typedNumberedState.get(stateKey);
          const restart =
            !prev ||
            value === null ||
            value === 1 ||
            prev.lastValue === null ||
            value !== prev.lastValue + 1;
          const segmentId = restart ? ++typedSegmentCounter : prev!.segmentId;
          typedNumberedState.set(stateKey, { segmentId, lastValue: value });
          typedSegment = `t${stateKey}#${segmentId}`;
        }

        const typedNumId = useMixedNumId
          ? getMixedNumIdForGroup(
              groupInfo!.groupId,
              groupInfo!.lead,
              groupInfo!.switchLevel
            )
          : isBulletTypedPrefix
            ? getBulletNumId(targetLevel)
            : getNumberedNumId(targetLevel, typedSegment);
        para.setNumbering(typedNumId, targetLevel);
        report.normalized++;
        report.details.push({
          originalText: text.substring(0, 50),
          action: "normalized",
          reason: `Typed prefix → level ${targetLevel}${useMixedNumId ? ` (mixed-${groupInfo!.lead})` : wasSubordinated ? " (subordinated)" : ""}`,
        });
      } else if (isWordList) {
        // Preserve the item's existing category. Cross-type conversion to a
        // "majority" is no longer performed — mixed bullet+numbered lists
        // within a single cell are allowed.
        //
        // For numbered Word items, key continuity on the ORIGINAL source numId
        // (list-instance identity) rather than a blanket per-level cache: items
        // that shared a source numId continue as one sequence; items from a
        // distinct source numId stay a separate list. This mirrors the original
        // document's continuation instead of collapsing every numbered item at
        // a level into one run.
        const wordSegment = `w${detection.numId ?? "x"}`;
        const numId = useMixedNumId
          ? getMixedNumIdForGroup(
              groupInfo!.groupId,
              groupInfo!.lead,
              groupInfo!.switchLevel
            )
          : detection.category === "bullet"
            ? getBulletNumId(targetLevel)
            : getNumberedNumId(targetLevel, wordSegment);
        para.setNumbering(numId, targetLevel);
        report.normalized++;
        report.details.push({
          originalText: text.substring(0, 50),
          action: "normalized",
          reason: `Preserved ${detection.category} at level ${targetLevel}${useMixedNumId ? ` (mixed-${groupInfo!.lead})` : wasSubordinated ? " (subordinated)" : ""}`,
        });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      report.errors.push(`Failed on "${text.substring(0, 30)}...": ${message}`);
      report.details.push({
        originalText: text.substring(0, 50),
        action: "error",
        reason: message,
      });
    }
  }

  // Ensure list items don't start at orphan levels (level 1+ without level 0 parent)
  normalizeOrphanListLevelsInCell(cell);

  return report;
}

/**
 * Normalize lists across all cells in a table.
 */
export function normalizeListsInTable(
  table: Table,
  options: ListNormalizationOptions,
  numberingManager: NumberingManager
): ListNormalizationReport {
  const aggregateReport: ListNormalizationReport = {
    normalized: 0,
    skipped: 0,
    errors: [],
    appliedCategory: "none",
    details: [],
  };

  // Pre-scan: find NUMBERED source numIds that flow down the table as ONE list
  // item per cell across multiple cells (a column-spanning numbered list, e.g. a
  // steps column "1. Open", "2. Click", ... one per cell). Those must continue
  // 1,2,3 across cells, so allocate ONE shared restarted instance up front;
  // without it, normalizeListsInCell restarts the numbering in every cell and
  // the column renders 1,1,1 (audit M6). Bullets are excluded (no 1,2,3 to keep).
  const itemsPerCellByNumId = new Map<number, Map<TableCell, number>>();
  for (const row of table.getRows()) {
    for (const cell of row.getCells()) {
      for (const para of cell.getParagraphs()) {
        const numbering = para.getNumbering();
        if (!numbering || numbering.numId === 0) continue;
        let perCell = itemsPerCellByNumId.get(numbering.numId);
        if (!perCell) {
          perCell = new Map<TableCell, number>();
          itemsPerCellByNumId.set(numbering.numId, perCell);
        }
        perCell.set(cell, (perCell.get(cell) ?? 0) + 1);
      }
    }
  }
  const sharedRestartMap = new Map<number, number>();
  for (const [numId, perCell] of itemsPerCellByNumId) {
    if (perCell.size < 2) continue; // must span >= 2 cells
    let everySingle = true;
    for (const count of perCell.values()) {
      if (count !== 1) {
        everySingle = false; // a cell with 2+ items is a per-cell list, not a column
        break;
      }
    }
    if (!everySingle) continue;
    const inst = numberingManager.getInstance(numId);
    const lvl0 = inst
      ? numberingManager.getAbstractNumbering(inst.getAbstractNumId())?.getLevel(0)
      : undefined;
    if (!lvl0 || lvl0.getFormat() === "bullet") continue; // numbered lists only
    sharedRestartMap.set(numId, numberingManager.restartNumbering(numId));
  }

  for (const row of table.getRows()) {
    for (const cell of row.getCells()) {
      const cellReport = normalizeListsInCell(cell, options, numberingManager, sharedRestartMap);

      aggregateReport.normalized += cellReport.normalized;
      aggregateReport.skipped += cellReport.skipped;
      aggregateReport.errors.push(...cellReport.errors);
      aggregateReport.details.push(...cellReport.details);

      if (cellReport.appliedCategory !== "none") {
        aggregateReport.appliedCategory = cellReport.appliedCategory;
      }
    }
  }

  return aggregateReport;
}

/**
 * Normalize orphan Level 1+ list items in a table cell.
 *
 * Detects when a cell's first list item starts at Level 1 or higher
 * without a preceding Level 0 item. Shifts all list items down by the
 * minimum level found, so they start at Level 0.
 */
export function normalizeOrphanListLevelsInCell(cell: TableCell): number {
  const paragraphs = cell.getParagraphs();

  // Find minimum level among all list items in the cell
  let minLevel = Infinity;
  let hasListItems = false;

  for (const para of paragraphs) {
    const numbering = para.getNumbering();
    if (numbering) {
      hasListItems = true;
      minLevel = Math.min(minLevel, numbering.level);
    }
  }

  // If no list items or already at Level 0, nothing to fix
  if (!hasListItems || minLevel === 0 || minLevel === Infinity) {
    return 0;
  }

  // Shift all list items down by minLevel
  let normalizedCount = 0;
  for (const para of paragraphs) {
    const numbering = para.getNumbering();
    if (numbering) {
      const newLevel = numbering.level - minLevel;
      para.setNumbering(numbering.numId, newLevel);
      normalizedCount++;
    }
  }

  return normalizedCount;
}

/**
 * Normalize orphan Level 1+ list items across all cells in a table.
 */
export function normalizeOrphanListLevelsInTable(table: Table): number {
  let totalNormalized = 0;

  for (const row of table.getRows()) {
    for (const cell of row.getCells()) {
      totalNormalized += normalizeOrphanListLevelsInCell(cell);
    }
  }

  return totalNormalized;
}

// =============================================================================
// NUMBERING MANAGER HELPERS
// =============================================================================

/**
 * Get existing or create new numbered list numId.
 */
function getOrCreateNumberedListNumId(numberingManager: NumberingManager): number {
  const instances = numberingManager.getAllInstances();
  for (const instance of instances) {
    const abstractNum = numberingManager.getAbstractNumbering(instance.getAbstractNumId());
    if (abstractNum) {
      const level0 = abstractNum.getLevel(0);
      if (level0) {
        const format = level0.getFormat();
        if (getListCategoryFromFormat(format) === "numbered") {
          return instance.getNumId();
        }
      }
    }
  }

  return numberingManager.createNumberedList();
}

/**
 * Get existing or create new bullet list numId.
 */
function getOrCreateBulletListNumId(numberingManager: NumberingManager): number {
  const instances = numberingManager.getAllInstances();
  for (const instance of instances) {
    const abstractNum = numberingManager.getAbstractNumbering(instance.getAbstractNumId());
    if (abstractNum) {
      const level0 = abstractNum.getLevel(0);
      if (level0) {
        const format = level0.getFormat();
        if (format === "bullet") {
          return instance.getNumId();
        }
      }
    }
  }

  return numberingManager.createBulletList();
}

// =============================================================================
// PUBLIC API CLASS
// =============================================================================

/**
 * Main entry point for list normalization.
 */
export class ListNormalizer {
  private numberingManager: NumberingManager;

  constructor(numberingManager: NumberingManager) {
    this.numberingManager = numberingManager;
  }

  analyzeCell(cell: TableCell): ListAnalysis {
    return analyzeCellLists(cell);
  }

  analyzeTable(table: Table): Map<TableCell, ListAnalysis> {
    return analyzeTableLists(table);
  }

  normalizeCell(
    cell: TableCell,
    options: Partial<ListNormalizationOptions> = {}
  ): ListNormalizationReport {
    const fullOptions = this.resolveOptions(options);
    return normalizeListsInCell(cell, fullOptions, this.numberingManager);
  }

  normalizeTable(
    table: Table,
    options: Partial<ListNormalizationOptions> = {}
  ): ListNormalizationReport {
    const fullOptions = this.resolveOptions(options);
    return normalizeListsInTable(table, fullOptions, this.numberingManager);
  }

  normalizeAllTables(
    tables: Table[],
    options: Partial<ListNormalizationOptions> = {}
  ): ListNormalizationReport {
    const aggregateReport: ListNormalizationReport = {
      normalized: 0,
      skipped: 0,
      errors: [],
      appliedCategory: "none",
      details: [],
    };

    for (const table of tables) {
      const tableReport = this.normalizeTable(table, options);
      aggregateReport.normalized += tableReport.normalized;
      aggregateReport.skipped += tableReport.skipped;
      aggregateReport.errors.push(...tableReport.errors);
      aggregateReport.details.push(...tableReport.details);

      if (tableReport.appliedCategory !== "none") {
        aggregateReport.appliedCategory = tableReport.appliedCategory;
      }
    }

    if (aggregateReport.normalized > 0) {
      logger.info(`List normalization complete: ${aggregateReport.normalized} items normalized`);
    }

    return aggregateReport;
  }

  private resolveOptions(partial: Partial<ListNormalizationOptions>): ListNormalizationOptions {
    return {
      numberedStyleNumId:
        partial.numberedStyleNumId ?? getOrCreateNumberedListNumId(this.numberingManager),
      bulletStyleNumId:
        partial.bulletStyleNumId ?? getOrCreateBulletListNumId(this.numberingManager),
      scope: partial.scope ?? "cell",
      forceMajority: partial.forceMajority ?? false,
      preserveIndentation: partial.preserveIndentation ?? false,
      indentationLevels: partial.indentationLevels,
      extraHangingIndentTwips: partial.extraHangingIndentTwips,
      subordinateMinorityCategory: partial.subordinateMinorityCategory ?? true,
      // Pass-through: the tracking Set is shared with the caller so
      // downstream passes (applyBulletUniformity etc.) can skip mixed-list
      // definitions. Dropping it here is the same bug as omitting any of
      // the fields above — silently breaks the protection contract.
      trackMixedListAbstractNumIds: partial.trackMixedListAbstractNumIds,
    };
  }
}
