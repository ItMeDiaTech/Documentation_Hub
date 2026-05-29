/**
 * DocumentProcessingComparison - Compare document before and after processing
 *
 * This service captures the state of a document before processing,
 * tracks all changes made during processing, and generates a comparison
 * showing exactly what was modified.
 *
 * Used to show users what changes were made to their document during:
 * - Hyperlink processing
 * - Style application
 * - Content ID appending
 * - PowerAutomate API updates
 */

import { Document, Paragraph, Hyperlink } from "docxmlater";
import { Change } from "diff";
import { sanitizeHyperlinkText, isTextCorrupted } from "../../utils/textSanitizer";
import { logger } from "../../utils/logger";

// Create namespaced logger for this module
const log = logger.namespace("DocumentProcessingComparison");

export interface ProcessingChange {
  id: string;
  type:
    | "hyperlink_url"
    | "hyperlink_text"
    | "style"
    | "content_added"
    | "content_removed"
    | "formatting";
  location: string; // e.g., "Paragraph 5, Hyperlink 2"
  before: any;
  after: any;
  timestamp: Date;
  operation: string; // e.g., "PowerAutomate API Update", "Content ID Append"
}

export interface ProcessingComparison {
  documentPath: string;
  processingStartTime: Date;
  processingEndTime?: Date;
  originalBuffer: Buffer;
  processedBuffer?: Buffer;
  changes: ProcessingChange[];
  statistics: ProcessingStatistics;
  hyperlinkChanges: HyperlinkChange[];
  styleChanges: StyleChange[];
  contentChanges: ContentChange[];
}

export interface ProcessingStatistics {
  totalChanges: number;
  hyperlinksModified: number;
  urlsChanged: number;
  displayTextsChanged: number;
  stylesApplied: number;
  contentIdsAppended: number;
  processingDurationMs: number;
}

export interface HyperlinkChange {
  paragraphIndex: number;
  hyperlinkIndex: number;
  originalUrl: string;
  modifiedUrl: string;
  originalText: string;
  modifiedText: string;
  changeReason: string; // e.g., "Content ID appended", "URL updated by API"
  /** Status of the hyperlink source - 'not_found' for theSource links that couldn't be resolved */
  status?: "updated" | "not_found" | "expired";
  /** Content ID associated with this hyperlink change (for theSource links) */
  contentId?: string;
}

export interface StyleChange {
  paragraphIndex: number;
  styleId: string;
  styleName: string;
  properties: Record<string, any>;
}

export interface ContentChange {
  paragraphIndex: number;
  type: "added" | "removed" | "modified";
  originalContent?: string;
  modifiedContent?: string;
  diff?: Change[];
}

/**
 * Service for tracking and comparing document changes during processing
 */
export class DocumentProcessingComparison {
  private comparison: ProcessingComparison | null = null;
  private originalHyperlinks: Map<string, HyperlinkSnapshot> = new Map();
  private originalStyles: Map<number, any> = new Map();
  private changeIdCounter = 0;

  /**
   * Start tracking a document for comparison
   */
  async startTracking(documentPath: string, document: Document): Promise<void> {
    const startTime = new Date();

    // Capture original state
    const originalBuffer = await document.toBuffer();

    // Capture hyperlink snapshots
    this.captureHyperlinks(document);

    // Capture style snapshots
    this.captureStyles(document);

    // Initialize comparison
    this.comparison = {
      documentPath,
      processingStartTime: startTime,
      originalBuffer,
      changes: [],
      statistics: {
        totalChanges: 0,
        hyperlinksModified: 0,
        urlsChanged: 0,
        displayTextsChanged: 0,
        stylesApplied: 0,
        contentIdsAppended: 0,
        processingDurationMs: 0,
      },
      hyperlinkChanges: [],
      styleChanges: [],
      contentChanges: [],
    };
  }

  /**
   * Capture current hyperlink state
   */
  private captureHyperlinks(document: Document): void {
    this.originalHyperlinks.clear();
    const paragraphs = document.getAllParagraphs();

    paragraphs.forEach((para, paraIndex) => {
      const content = para.getContent();
      let hyperlinkIndex = 0;

      for (const item of content) {
        if (item instanceof Hyperlink) {
          const key = `${paraIndex}-${hyperlinkIndex}`;
          const rawText = item.getText();

          // Log if XML corruption detected
          if (isTextCorrupted(rawText)) {
            log.warn(
              `XML corruption detected in hyperlink text at paragraph ${paraIndex}, hyperlink ${hyperlinkIndex}:`,
              rawText
            );
          }

          this.originalHyperlinks.set(key, {
            paragraphIndex: paraIndex,
            hyperlinkIndex,
            url: item.getFullUrl() || "",
            text: sanitizeHyperlinkText(rawText),
          });
          hyperlinkIndex++;
        }
      }
    });
  }

  /**
   * Capture current style state
   */
  private captureStyles(document: Document): void {
    this.originalStyles.clear();
    const paragraphs = document.getAllParagraphs();

    paragraphs.forEach((para, index) => {
      const formatting = para.getFormatting?.() || {};
      this.originalStyles.set(index, formatting);
    });
  }

  /**
   * Record a hyperlink URL change
   */
  recordHyperlinkUrlChange(
    paragraphIndex: number,
    hyperlinkIndex: number,
    originalUrl: string,
    newUrl: string,
    reason: string
  ): void {
    if (!this.comparison) return;

    const changeId = `change-${++this.changeIdCounter}`;
    const location = `Paragraph ${paragraphIndex + 1}, Hyperlink ${hyperlinkIndex + 1}`;

    // Add to general changes
    this.comparison.changes.push({
      id: changeId,
      type: "hyperlink_url",
      location,
      before: originalUrl,
      after: newUrl,
      timestamp: new Date(),
      operation: reason,
    });

    // Find if there's an existing hyperlink change for this position
    const existingChange = this.comparison.hyperlinkChanges.find(
      (c) => c.paragraphIndex === paragraphIndex && c.hyperlinkIndex === hyperlinkIndex
    );

    if (existingChange) {
      existingChange.modifiedUrl = newUrl;
      existingChange.changeReason += `, ${reason}`;
    } else {
      // Get original state
      const key = `${paragraphIndex}-${hyperlinkIndex}`;
      const original = this.originalHyperlinks.get(key);

      this.comparison.hyperlinkChanges.push({
        paragraphIndex,
        hyperlinkIndex,
        originalUrl: original?.url || originalUrl,
        modifiedUrl: newUrl,
        originalText: original?.text || "",
        modifiedText: original?.text || "",
        changeReason: reason,
      });
    }

    // Update statistics
    this.comparison.statistics.urlsChanged++;
    this.comparison.statistics.hyperlinksModified++;

    if (reason.includes("Content ID")) {
      this.comparison.statistics.contentIdsAppended++;
    }
  }

  /**
   * Record a hyperlink text change
   * @param status - Optional status for theSource links ('not_found', 'expired')
   * @param contentId - Optional content ID associated with this hyperlink
   */
  recordHyperlinkTextChange(
    paragraphIndex: number,
    hyperlinkIndex: number,
    originalText: string,
    newText: string,
    reason: string,
    status?: "updated" | "not_found" | "expired",
    contentId?: string
  ): void {
    if (!this.comparison) return;

    const changeId = `change-${++this.changeIdCounter}`;
    const location = `Paragraph ${paragraphIndex + 1}, Hyperlink ${hyperlinkIndex + 1}`;

    // Add to general changes
    this.comparison.changes.push({
      id: changeId,
      type: "hyperlink_text",
      location,
      before: originalText,
      after: newText,
      timestamp: new Date(),
      operation: reason,
    });

    // Update hyperlink changes
    const existingChange = this.comparison.hyperlinkChanges.find(
      (c) => c.paragraphIndex === paragraphIndex && c.hyperlinkIndex === hyperlinkIndex
    );

    if (existingChange) {
      existingChange.modifiedText = newText;
      existingChange.changeReason += `, ${reason}`;
      if (status) existingChange.status = status;
      if (contentId) existingChange.contentId = contentId;
    } else {
      const key = `${paragraphIndex}-${hyperlinkIndex}`;
      const original = this.originalHyperlinks.get(key);

      this.comparison.hyperlinkChanges.push({
        paragraphIndex,
        hyperlinkIndex,
        originalUrl: original?.url || "",
        modifiedUrl: original?.url || "",
        originalText: original?.text || originalText,
        modifiedText: newText,
        changeReason: reason,
        status,
        contentId,
      });
    }

    // Update statistics
    this.comparison.statistics.displayTextsChanged++;
    if (!existingChange) {
      this.comparison.statistics.hyperlinksModified++;
    }
  }

  /**
   * Record a style change
   */
  recordStyleChange(
    paragraphIndex: number,
    styleId: string,
    styleName: string,
    properties: Record<string, any>
  ): void {
    if (!this.comparison) return;

    const changeId = `change-${++this.changeIdCounter}`;
    const location = `Paragraph ${paragraphIndex + 1}`;

    // Add to general changes
    this.comparison.changes.push({
      id: changeId,
      type: "style",
      location,
      before: this.originalStyles.get(paragraphIndex) || {},
      after: { styleId, ...properties },
      timestamp: new Date(),
      operation: `Applied style: ${styleName}`,
    });

    // Add to style changes
    this.comparison.styleChanges.push({
      paragraphIndex,
      styleId,
      styleName,
      properties,
    });

    // Update statistics
    this.comparison.statistics.stylesApplied++;
  }

  /**
   * Complete tracking and generate final comparison
   */
  async completeTracking(processedDocument: Document): Promise<ProcessingComparison | null> {
    if (!this.comparison) return null;

    // Capture processed state
    this.comparison.processedBuffer = await processedDocument.toBuffer();
    this.comparison.processingEndTime = new Date();

    // Calculate processing duration
    this.comparison.statistics.processingDurationMs =
      this.comparison.processingEndTime.getTime() - this.comparison.processingStartTime.getTime();

    // Compare final hyperlink state
    this.compareFinalHyperlinks(processedDocument);

    // Update total changes
    this.comparison.statistics.totalChanges = this.comparison.changes.length;

    return this.comparison;
  }

  /**
   * Compare final hyperlink state with original
   */
  private compareFinalHyperlinks(document: Document): void {
    if (!this.comparison) return;

    const paragraphs = document.getAllParagraphs();

    paragraphs.forEach((para, paraIndex) => {
      const content = para.getContent();
      let hyperlinkIndex = 0;

      for (const item of content) {
        if (item instanceof Hyperlink) {
          const key = `${paraIndex}-${hyperlinkIndex}`;
          const original = this.originalHyperlinks.get(key);

          if (original) {
            const currentUrl = item.getFullUrl() || "";
            const rawCurrentText = item.getText();

            // Log if XML corruption detected
            if (isTextCorrupted(rawCurrentText)) {
              log.warn(
                `XML corruption detected in current hyperlink text at paragraph ${paraIndex}, hyperlink ${hyperlinkIndex}:`,
                rawCurrentText
              );
            }

            const currentText = sanitizeHyperlinkText(rawCurrentText);

            // Check if this change was already recorded
            const recorded = this.comparison!.hyperlinkChanges.find(
              (c) => c.paragraphIndex === paraIndex && c.hyperlinkIndex === hyperlinkIndex
            );

            if (!recorded) {
              // Detect untracked changes
              if (currentUrl !== original.url || currentText !== original.text) {
                this.comparison!.hyperlinkChanges.push({
                  paragraphIndex: paraIndex,
                  hyperlinkIndex,
                  originalUrl: original.url,
                  modifiedUrl: currentUrl,
                  originalText: original.text,
                  modifiedText: currentText,
                  changeReason: "Automatic change detected",
                });

                if (currentUrl !== original.url) {
                  this.comparison!.statistics.urlsChanged++;
                }
                if (currentText !== original.text) {
                  this.comparison!.statistics.displayTextsChanged++;
                }
                this.comparison!.statistics.hyperlinksModified++;
              }
            }
          }

          hyperlinkIndex++;
        }
      }
    });
  }

  /**
   * Reset tracking for new document
   */
  reset(): void {
    this.comparison = null;
    this.originalHyperlinks.clear();
    this.originalStyles.clear();
    this.changeIdCounter = 0;
  }

  /**
   * Get current comparison
   */
  getCurrentComparison(): ProcessingComparison | null {
    return this.comparison;
  }
}

// Export singleton instance
export const documentProcessingComparison = new DocumentProcessingComparison();

// Type for hyperlink snapshot
interface HyperlinkSnapshot {
  paragraphIndex: number;
  hyperlinkIndex: number;
  url: string;
  text: string;
}
