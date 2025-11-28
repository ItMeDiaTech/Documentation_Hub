/**
 * Diff Utilities - Word-level text comparison for document comparison views
 *
 * Uses the 'diff' library (already installed) for generating word-level
 * differences between pre-processing and post-processing document content.
 */

import { diffWords, diffLines, Change } from 'diff';
import type { DiffSegment, ParagraphDiff, DocumentDiff } from '@/types/editor';

/**
 * Generate word-level diff between two strings
 *
 * @param original - Original text (before processing)
 * @param modified - Modified text (after processing)
 * @returns Arrays of diff segments for each side
 */
export function generateWordDiff(
  original: string,
  modified: string
): { originalSegments: DiffSegment[]; modifiedSegments: DiffSegment[] } {
  const changes = diffWords(original, modified);

  const originalSegments: DiffSegment[] = [];
  const modifiedSegments: DiffSegment[] = [];

  for (const change of changes) {
    if (change.added) {
      // Text was added (only in modified)
      modifiedSegments.push({
        text: change.value,
        type: 'added',
      });
    } else if (change.removed) {
      // Text was removed (only in original)
      originalSegments.push({
        text: change.value,
        type: 'removed',
      });
    } else {
      // Text is unchanged (in both)
      originalSegments.push({
        text: change.value,
        type: 'unchanged',
      });
      modifiedSegments.push({
        text: change.value,
        type: 'unchanged',
      });
    }
  }

  return { originalSegments, modifiedSegments };
}

/**
 * Generate a complete document diff from paragraph arrays
 *
 * @param original - Array of original paragraph texts
 * @param modified - Array of modified paragraph texts
 * @returns Complete document diff with per-paragraph analysis
 */
export function generateDocumentDiff(
  original: string[],
  modified: string[]
): DocumentDiff {
  const paragraphDiffs: ParagraphDiff[] = [];

  let wordsAdded = 0;
  let wordsRemoved = 0;
  let wordsModified = 0;
  let changedParagraphs = 0;
  let addedParagraphs = 0;
  let removedParagraphs = 0;

  // Use line-level diff first to align paragraphs
  const lineDiffs = diffLines(original.join('\n'), modified.join('\n'));

  let originalIndex = 0;
  let modifiedIndex = 0;
  let paragraphIndex = 0;

  for (const lineDiff of lineDiffs) {
    const lines = lineDiff.value.split('\n').filter((line) => line !== '');

    if (lineDiff.added) {
      // Paragraphs were added
      for (const line of lines) {
        paragraphDiffs.push({
          index: paragraphIndex++,
          original: '',
          modified: line,
          originalSegments: [],
          modifiedSegments: [{ text: line, type: 'added' }],
          hasChanges: true,
        });
        addedParagraphs++;
        wordsAdded += countWords(line);
        modifiedIndex++;
      }
    } else if (lineDiff.removed) {
      // Paragraphs were removed
      for (const line of lines) {
        paragraphDiffs.push({
          index: paragraphIndex++,
          original: line,
          modified: '',
          originalSegments: [{ text: line, type: 'removed' }],
          modifiedSegments: [],
          hasChanges: true,
        });
        removedParagraphs++;
        wordsRemoved += countWords(line);
        originalIndex++;
      }
    } else {
      // Paragraphs match - but content might differ
      for (const line of lines) {
        const origText = original[originalIndex] || '';
        const modText = modified[modifiedIndex] || '';

        if (origText === modText) {
          // Exact match
          paragraphDiffs.push({
            index: paragraphIndex++,
            original: origText,
            modified: modText,
            originalSegments: [{ text: origText, type: 'unchanged' }],
            modifiedSegments: [{ text: modText, type: 'unchanged' }],
            hasChanges: false,
          });
        } else {
          // Content changed within paragraph
          const { originalSegments, modifiedSegments } = generateWordDiff(
            origText,
            modText
          );

          paragraphDiffs.push({
            index: paragraphIndex++,
            original: origText,
            modified: modText,
            originalSegments,
            modifiedSegments,
            hasChanges: true,
          });
          changedParagraphs++;

          // Count word changes
          const origWords = countWords(origText);
          const modWords = countWords(modText);
          wordsModified += Math.abs(modWords - origWords);
        }

        originalIndex++;
        modifiedIndex++;
      }
    }
  }

  // Handle any remaining paragraphs
  while (originalIndex < original.length) {
    const origText = original[originalIndex];
    paragraphDiffs.push({
      index: paragraphIndex++,
      original: origText,
      modified: '',
      originalSegments: [{ text: origText, type: 'removed' }],
      modifiedSegments: [],
      hasChanges: true,
    });
    removedParagraphs++;
    wordsRemoved += countWords(origText);
    originalIndex++;
  }

  while (modifiedIndex < modified.length) {
    const modText = modified[modifiedIndex];
    paragraphDiffs.push({
      index: paragraphIndex++,
      original: '',
      modified: modText,
      originalSegments: [],
      modifiedSegments: [{ text: modText, type: 'added' }],
      hasChanges: true,
    });
    addedParagraphs++;
    wordsAdded += countWords(modText);
    modifiedIndex++;
  }

  return {
    original,
    modified,
    paragraphDiffs,
    stats: {
      totalParagraphs: paragraphDiffs.length,
      changedParagraphs,
      addedParagraphs,
      removedParagraphs,
      wordsAdded,
      wordsRemoved,
      wordsModified,
    },
  };
}

/**
 * Count words in a string
 */
function countWords(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0).length;
}

/**
 * Simplify diff result by merging consecutive segments of the same type
 *
 * @param segments - Array of diff segments
 * @returns Merged segments
 */
export function mergeConsecutiveSegments(segments: DiffSegment[]): DiffSegment[] {
  if (segments.length === 0) return segments;

  const merged: DiffSegment[] = [];
  let current = { ...segments[0] };

  for (let i = 1; i < segments.length; i++) {
    const segment = segments[i];
    if (segment.type === current.type) {
      current.text += segment.text;
    } else {
      merged.push(current);
      current = { ...segment };
    }
  }

  merged.push(current);
  return merged;
}

/**
 * Calculate similarity percentage between two texts
 *
 * @param original - Original text
 * @param modified - Modified text
 * @returns Percentage similarity (0-100)
 */
export function calculateSimilarity(original: string, modified: string): number {
  if (original === modified) return 100;
  if (original.length === 0 && modified.length === 0) return 100;
  if (original.length === 0 || modified.length === 0) return 0;

  const changes = diffWords(original, modified);
  let unchangedLength = 0;
  let totalLength = 0;

  for (const change of changes) {
    totalLength += change.value.length;
    if (!change.added && !change.removed) {
      unchangedLength += change.value.length;
    }
  }

  return totalLength > 0 ? Math.round((unchangedLength / totalLength) * 100) : 0;
}

/**
 * Get a summary of changes between two paragraph arrays
 *
 * @param original - Original paragraphs
 * @param modified - Modified paragraphs
 * @returns Human-readable summary
 */
export function getDiffSummary(original: string[], modified: string[]): string {
  const diff = generateDocumentDiff(original, modified);
  const { stats } = diff;

  const parts: string[] = [];

  if (stats.changedParagraphs > 0) {
    parts.push(`${stats.changedParagraphs} modified`);
  }
  if (stats.addedParagraphs > 0) {
    parts.push(`${stats.addedParagraphs} added`);
  }
  if (stats.removedParagraphs > 0) {
    parts.push(`${stats.removedParagraphs} removed`);
  }

  if (parts.length === 0) {
    return 'No changes';
  }

  return `${parts.join(', ')} paragraphs`;
}

/**
 * Filter paragraph diffs to only show changed paragraphs
 *
 * @param diffs - All paragraph diffs
 * @param includeContext - Number of unchanged paragraphs to include around changes
 * @returns Filtered diffs with context markers
 */
export function filterChangedParagraphs(
  diffs: ParagraphDiff[],
  includeContext: number = 2
): ParagraphDiff[] {
  if (includeContext === 0) {
    return diffs.filter((d) => d.hasChanges);
  }

  const result: ParagraphDiff[] = [];
  const showIndices = new Set<number>();

  // Mark all changed paragraphs and their context
  diffs.forEach((diff, index) => {
    if (diff.hasChanges) {
      for (
        let i = Math.max(0, index - includeContext);
        i <= Math.min(diffs.length - 1, index + includeContext);
        i++
      ) {
        showIndices.add(i);
      }
    }
  });

  // Build result with indices in order
  const sortedIndices = Array.from(showIndices).sort((a, b) => a - b);
  for (const index of sortedIndices) {
    result.push(diffs[index]);
  }

  return result;
}

export default {
  generateWordDiff,
  generateDocumentDiff,
  mergeConsecutiveSegments,
  calculateSimilarity,
  getDiffSummary,
  filterChangedParagraphs,
};
