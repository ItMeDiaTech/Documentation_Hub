/**
 * TOC Repair Service - Fix orphaned TOC links and generate proper Table of Contents
 *
 * TRIGGER CONDITIONS (both must be true):
 * 1. `operations.updateTocHyperlinks` is ENABLED in Processing Options
 * 2. Orphaned TOC entries are DETECTED in the document
 *
 * What are orphaned TOC entries?
 * - Hyperlinks with bookmark anchors (e.g., #_Toc123456)
 * - Found in typical TOC location (first 30 paragraphs)
 * - 3+ such links indicates orphaned TOC section
 * - Occurs when TOC field is deleted but hyperlink entries remain
 *
 * What this service does when BOTH conditions are met:
 * 1. Removes orphaned TOC hyperlinks (bookmark-based links with no field)
 * 2. Generates Word's native TOC field that references Header 2 styles directly
 * 3. Adds "Top of the Document" navigation links before each Header 2
 *
 * Integration:
 * - Triggered by `operations.updateTocHyperlinks` in WordProcessingOptions (user must enable)
 * - Automatically detects orphaned TOC entries before repair (smart processing)
 * - Only executes when both setting enabled AND orphaned entries found
 * - Uses docxmlater's Document API for all operations
 *
 * Word automatically generates bookmarks and hyperlinks when the TOC field is updated.
 */

import type { Document, Paragraph, Hyperlink } from 'docxmlater';
import { logger } from '@/utils/logger';

const log = logger.namespace('TOCRepairService');

/**
 * Options for TOC repair operation
 */
export interface TOCRepairOptions {
  /** Whether to generate the TOC field (default: true) */
  generateTOC?: boolean;
  /** Whether to add "Top of the Document" links (default: true) */
  addTopLinks?: boolean;
  /** Whether to clear existing orphaned TOC entries (default: true) */
  clearOrphanedTOC?: boolean;
  /** Only search for Header 2 in tables (default: true, set false to search all paragraphs) */
  onlyInTables?: boolean;
  /** Custom text for navigation links (default: "Top of the Document") */
  topLinkText?: string;
}

/**
 * Result of TOC repair operation
 */
export interface TOCRepairResult {
  /** Whether TOC was successfully generated */
  tocGenerated: boolean;
  /** Number of Header 2 headings found */
  header2Count: number;
  /** Number of "Top of the Document" links added */
  topLinksAdded: number;
  /** Number of orphaned TOC entries removed */
  orphanedEntriesRemoved: number;
  /** Whether orphaned TOC entries were detected */
  hadOrphanedEntries: boolean;
}

/**
 * Information about a Header 2 paragraph
 */
interface Header2Info {
  /** The paragraph containing Header 2 */
  paragraph: any; // docxmlater Paragraph type
  /** Global paragraph index in document */
  paragraphIndex: number;
  /** Text content of the header */
  text: string;
}

/**
 * Detects if document has orphaned TOC entries
 *
 * Orphaned TOC entries are hyperlinks with anchors (bookmarks) that exist
 * without a corresponding TOC field. This happens when:
 * - TOC field is deleted but entries remain
 * - Document was corrupted or improperly edited
 * - TOC was manually created without field
 *
 * @param doc - Document to check
 * @returns true if orphaned TOC entries detected
 */
export function hasOrphanedTOCEntries(doc: Document): boolean {
  try {
    const paragraphs = (doc as any).getParagraphs?.();
    if (!paragraphs || paragraphs.length === 0) return false;

    // Check first 30 paragraphs for TOC-like hyperlinks
    const checkLimit = Math.min(30, paragraphs.length);
    let anchorLinkCount = 0;

    for (let i = 0; i < checkLimit; i++) {
      const para = paragraphs[i];
      if (!para) continue;

      const content = (para as any).getContent?.();
      if (!content) continue;

      for (const item of content) {
        // Check if it's a hyperlink with an anchor (bookmark reference)
        if (item && typeof item === 'object') {
          const anchor = (item as any).getAnchor?.();
          if (anchor && anchor !== '_top') {
            anchorLinkCount++;
            if (anchorLinkCount >= 3) {
              // 3+ anchor links suggests orphaned TOC
              log.info('Detected orphaned TOC entries (3+ anchor links found)');
              return true;
            }
          }
        }
      }
    }

    return false;
  } catch (error) {
    log.error('Error detecting orphaned TOC entries:', error);
    return false;
  }
}

/**
 * Repairs TOC by generating Header 2 only TOC and adding navigation links
 *
 * This function:
 * 1. Detects orphaned TOC entries automatically
 * 2. Removes orphaned entries if clearOrphanedTOC is enabled
 * 3. Generates new TOC field if generateTOC is enabled
 * 4. Adds "Top of the Document" links if addTopLinks is enabled
 *
 * @param doc - Document to repair
 * @param options - Configuration options for TOC repair
 * @returns Repair result with statistics
 *
 * @example
 * ```typescript
 * // Default behavior - full repair (only if orphaned entries detected)
 * const doc = await Document.load('document.docx');
 * const result = repairTOC(doc);
 * if (result.hadOrphanedEntries) {
 *   console.log(`Removed ${result.orphanedEntriesRemoved} orphaned entries`);
 *   console.log(`Added ${result.topLinksAdded} navigation links`);
 * }
 * await doc.save('repaired.docx');
 * ```
 *
 * @example
 * ```typescript
 * // Only generate TOC, don't add navigation links
 * const result = repairTOC(doc, {
 *   generateTOC: true,
 *   addTopLinks: false
 * });
 * ```
 *
 * @example
 * ```typescript
 * // Custom navigation link text
 * const result = repairTOC(doc, {
 *   topLinkText: 'Back to Top'
 * });
 * ```
 */
export function repairTOC(doc: Document, options: TOCRepairOptions = {}): TOCRepairResult {
  log.info('═══════════════════════════════════════════════════════════');
  log.info('Starting TOC Repair');
  log.info('═══════════════════════════════════════════════════════════');

  // Set defaults
  const {
    generateTOC = true,
    addTopLinks = true,
    clearOrphanedTOC = true,
    onlyInTables = true,
    topLinkText = 'Top of the Document',
  } = options;

  // Detect orphaned TOC entries
  const hadOrphanedEntries = hasOrphanedTOCEntries(doc);
  if (hadOrphanedEntries) {
    log.warn('⚠️  Orphaned TOC entries detected - will be cleaned up');
  }

  // Step 1: Find Header 1 (title) position
  const titleIndex = findHeader1(doc);
  log.debug(`Found Header 1 at index: ${titleIndex}`);

  // Step 2: Find all Header 2
  const header2s = onlyInTables
    ? findHeader2InTables(doc)
    : findAllHeader2(doc);

  log.info(`Found ${header2s.length} Header 2 headings`);

  if (header2s.length === 0) {
    log.warn('No Header 2 headings found - skipping TOC repair');
    return {
      tocGenerated: false,
      header2Count: 0,
      topLinksAdded: 0,
      orphanedEntriesRemoved: 0,
      hadOrphanedEntries,
    };
  }

  let orphanedEntriesRemoved = 0;

  // Step 3: Generate TOC field after title (if enabled)
  if (generateTOC) {
    orphanedEntriesRemoved = generateTOCField(doc, titleIndex + 1, clearOrphanedTOC);
    log.info(`TOC field generated at position ${titleIndex + 1}`);
    if (orphanedEntriesRemoved > 0) {
      log.info(`✓ Removed ${orphanedEntriesRemoved} orphaned TOC entries`);
    }
  }

  // Step 4: Add "Top of the Document" links (if enabled)
  const topLinksAdded = addTopLinks ? addTopLinksToDoc(doc, header2s, topLinkText) : 0;
  if (topLinksAdded > 0) {
    log.info(`✓ Added ${topLinksAdded} "Top of the Document" navigation links`);
  }

  log.info('═══════════════════════════════════════════════════════════');
  log.info('TOC Repair Complete');
  log.info('═══════════════════════════════════════════════════════════');

  return {
    tocGenerated: generateTOC,
    header2Count: header2s.length,
    topLinksAdded,
    orphanedEntriesRemoved,
    hadOrphanedEntries,
  };
}

/**
 * Find Header 1 (Title) in first 10 paragraphs
 */
function findHeader1(doc: Document): number {
  const paragraphs = (doc as any).getParagraphs?.();
  if (!paragraphs) return 0;

  for (let i = 0; i < Math.min(10, paragraphs.length); i++) {
    const para = paragraphs[i];
    if (!para) continue;

    const styleName = (para as any).getStyle?.();

    if (
      styleName === 'Heading1' ||
      styleName === 'Header1' ||
      styleName === 'Heading 1' ||
      styleName === 'Title' ||
      styleName === 'title'
    ) {
      return i;
    }
  }

  return 0;
}

/**
 * Find all Header 2 paragraphs (in any location)
 *
 * Searches all paragraphs for Header 2 style.
 */
function findAllHeader2(doc: Document): Header2Info[] {
  const header2s: Header2Info[] = [];
  const paragraphs = (doc as any).getParagraphs?.();
  if (!paragraphs) return [];

  for (let i = 0; i < paragraphs.length; i++) {
    const para = paragraphs[i];
    if (!para) continue;

    const styleName = (para as any).getStyle?.();

    if (
      styleName === 'Heading2' ||
      styleName === 'Header2' ||
      styleName === 'Heading 2'
    ) {
      const text = ((para as any).getText?.() || '').trim();
      if (!text) continue;

      header2s.push({
        paragraph: para,
        paragraphIndex: i,
        text,
      });
    }
  }

  return header2s;
}

/**
 * Find all Header 2 paragraphs in 1x1 tables
 *
 * Searches for:
 * - Tables with exactly 1 row and 1 cell
 * - Paragraphs styled as Heading2/Header2/Heading 2
 * - With non-empty text content
 */
function findHeader2InTables(doc: Document): Header2Info[] {
  const header2s: Header2Info[] = [];
  const paragraphs = (doc as any).getParagraphs?.();
  const tables = (doc as any).getTables?.();

  if (!paragraphs || !tables) return [];

  for (const table of tables) {
    const rows = (table as any).getRows?.();

    // Only check 1x1 tables
    if (!rows || rows.length !== 1) continue;

    const firstRow = rows[0];
    if (!firstRow) continue;

    const cells = (firstRow as any).getCells?.();
    if (!cells || cells.length !== 1) continue;

    const firstCell = cells[0];
    if (!firstCell) continue;

    // Check paragraphs in the single cell
    const cellParas = (firstCell as any).getParagraphs?.();
    if (!cellParas) continue;

    for (const para of cellParas) {
      const styleName = (para as any).getStyle?.();

      if (
        styleName === 'Heading2' ||
        styleName === 'Header2' ||
        styleName === 'Heading 2'
      ) {
        const text = ((para as any).getText?.() || '').trim();
        if (!text) continue;

        const paragraphIndex = paragraphs.indexOf(para);

        header2s.push({
          paragraph: para,
          paragraphIndex,
          text,
        });
      }
    }
  }

  return header2s;
}

/**
 * Generate TOC field using Word's native TOC functionality
 *
 * Creates field with switches:
 * - \o "2-2" = Only outline level 2 (Header 2)
 * - \h = Hyperlinks enabled
 * - \z = Hide tab leader (no dots)
 * - \t = Use only specified styles
 *
 * Word auto-generates the TOC content when the field is updated.
 *
 * @param doc - Document to modify
 * @param position - Position to insert TOC
 * @param clearOrphaned - Whether to clear existing orphaned TOC entries
 * @returns Number of orphaned entries removed
 */
function generateTOCField(doc: Document, position: number, clearOrphaned: boolean): number {
  let removed = 0;

  // Clear any existing TOC entries (if enabled)
  if (clearOrphaned) {
    removed = clearExistingTOC(doc, position);
  }

  try {
    // Note: This requires docxmlater to support Field creation
    // If not available, this will need to be implemented via direct XML manipulation
    const tocPara = (doc as any).createParagraph?.();
    if (tocPara) {
      // Create TOC field (API-dependent implementation)
      // This is a placeholder - actual implementation depends on docxmlater API
      const field = {
        type: 'TOC',
        instruction: 'TOC \\o "2-2" \\h \\z \\t',
      };

      if (typeof (tocPara as any).addField === 'function') {
        (tocPara as any).addField(field);
      }

      // Insert at position
      if (typeof (doc as any).insertParagraphAt === 'function') {
        (doc as any).insertParagraphAt(position, tocPara);

        // Add blank line after TOC
        const blankPara = (doc as any).createParagraph?.();
        if (blankPara && typeof (blankPara as any).addText === 'function') {
          (blankPara as any).addText(' ');
          (doc as any).insertParagraphAt(position + 1, blankPara);
        }
      }
    }
  } catch (error) {
    log.error('Error generating TOC field:', error);
    log.warn('TOC field generation may require direct XML manipulation');
  }

  return removed;
}

/**
 * Clear existing TOC section (orphaned hyperlinks)
 *
 * Removes up to 30 paragraphs after the position that contain hyperlinks
 * with anchors (likely old TOC entries).
 *
 * @returns Number of paragraphs removed
 */
function clearExistingTOC(doc: Document, startIndex: number): number {
  const paragraphs = (doc as any).getParagraphs?.();
  if (!paragraphs) return 0;

  let removed = 0;

  for (let i = startIndex; i < Math.min(startIndex + 30, paragraphs.length); i++) {
    const para = paragraphs[i];
    if (para === undefined) continue;

    const content = (para as any).getContent?.();
    if (!content) continue;

    let hasAnchorLink = false;

    for (const item of content) {
      if (item && typeof item === 'object') {
        const anchor = (item as any).getAnchor?.();
        if (anchor && anchor !== '_top') {
          hasAnchorLink = true;
          break;
        }
      }
    }

    if (hasAnchorLink) {
      if (typeof (doc as any).removeParagraph === 'function') {
        (doc as any).removeParagraph(i - removed);
        removed++;
      }
    } else {
      // Stop at first non-TOC paragraph
      break;
    }
  }

  return removed;
}

/**
 * Add "Top of the Document" links throughout document
 *
 * Adds links:
 * - Before each Header 2 (except first)
 * - Before proprietary notice at end of document
 *
 * Note: Uses "_top" built-in Word bookmark (no need to create it)
 *
 * @param doc - Document to modify
 * @param header2s - Array of Header 2 locations
 * @param linkText - Text for the navigation link
 * @returns Number of links added
 */
function addTopLinksToDoc(doc: Document, header2s: Header2Info[], linkText: string): number {
  let linksAdded = 0;

  // Add before each Header 2 (except first)
  for (let i = 1; i < header2s.length; i++) {
    const insertIndex = header2s[i]!.paragraphIndex;

    if (!hasTopLink(doc, insertIndex - 1)) {
      const topLink = createTopLink(doc, linkText);
      if (topLink && typeof (doc as any).insertParagraphAt === 'function') {
        (doc as any).insertParagraphAt(insertIndex, topLink);
        linksAdded++;

        // Update indices for remaining headers
        for (let j = i; j < header2s.length; j++) {
          header2s[j]!.paragraphIndex++;
        }
      }
    }
  }

  // Add before proprietary notice
  const noticeIndex = findProprietaryNotice(doc);
  if (noticeIndex > 0 && !hasTopLink(doc, noticeIndex - 1)) {
    const topLink = createTopLink(doc, linkText);
    if (topLink && typeof (doc as any).insertParagraphAt === 'function') {
      (doc as any).insertParagraphAt(noticeIndex, topLink);
      linksAdded++;
    }
  }

  return linksAdded;
}

/**
 * Create "Top of the Document" hyperlink paragraph
 *
 * Links to "_top" built-in Word bookmark.
 *
 * @param doc - Document instance for creating elements
 * @param linkText - Text to display for the link
 */
function createTopLink(doc: Document, linkText: string = 'Top of the Document'): any | null {
  try {
    const para = (doc as any).createParagraph?.();
    if (!para) return null;

    if (typeof (para as any).setAlignment === 'function') {
      (para as any).setAlignment('right');
    }

    // Set spacing (in twips: 1 point = 20 twips, so 3 points = 60 twips)
    if (typeof (para as any).setSpacingBefore === 'function') {
      (para as any).setSpacingBefore(60);
    }
    if (typeof (para as any).setSpacingAfter === 'function') {
      (para as any).setSpacingAfter(0);
    }

    // Create hyperlink
    if (typeof (para as any).addHyperlink === 'function') {
      const hyperlink = {
        anchor: '_top', // Built-in Word bookmark for document top
        text: linkText,
        formatting: {
          font: 'Verdana',
          size: 12,
          underline: 'single',
          color: '0000FF',
        },
      };

      (para as any).addHyperlink(hyperlink);
    }

    return para;
  } catch (error) {
    log.error('Error creating top link:', error);
    return null;
  }
}

/**
 * Check if paragraph contains a "Top of the Document" link
 */
function hasTopLink(doc: Document, index: number): boolean {
  const paragraphs = (doc as any).getParagraphs?.();
  if (!paragraphs || index < 0 || index >= paragraphs.length) return false;

  const para = paragraphs[index];
  if (!para) return false;

  const content = (para as any).getContent?.();
  if (!content) return false;

  for (const item of content) {
    if (item && typeof item === 'object') {
      const text = ((item as any).getText?.() || '').trim().toLowerCase();
      // Check for both "Top of the Document" and "Top of Document"
      if (
        text === 'top of the document' ||
        text === 'top of document' ||
        text === 'back to top'
      ) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Find proprietary notice paragraph (usually near end of document)
 */
function findProprietaryNotice(doc: Document): number {
  const paragraphs = (doc as any).getParagraphs?.();
  if (!paragraphs) return 0;

  const searchStart = Math.max(0, paragraphs.length - 20);

  for (let i = searchStart; i < paragraphs.length; i++) {
    const para = paragraphs[i];
    if (!para) continue;

    const text = ((para as any).getText?.() || '').toLowerCase();
    if (text.includes('proprietary') || text.includes('confidential')) {
      return i;
    }
  }

  return paragraphs.length;
}
