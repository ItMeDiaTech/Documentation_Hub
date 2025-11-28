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

import { Document, Paragraph, Hyperlink } from 'docxmlater';
import { diffWords, Change } from 'diff';
import { sanitizeHyperlinkText, isTextCorrupted } from '../../utils/textSanitizer';
import { logger } from '../../utils/logger';

// Create namespaced logger for this module
const log = logger.namespace('DocumentProcessingComparison');

export interface ProcessingChange {
  id: string;
  type:
    | 'hyperlink_url'
    | 'hyperlink_text'
    | 'style'
    | 'content_added'
    | 'content_removed'
    | 'formatting';
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
  status?: 'updated' | 'not_found' | 'expired';
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
  type: 'added' | 'removed' | 'modified';
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
            url: item.getUrl() || '',
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
      type: 'hyperlink_url',
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
        originalText: original?.text || '',
        modifiedText: original?.text || '',
        changeReason: reason,
      });
    }

    // Update statistics
    this.comparison.statistics.urlsChanged++;
    this.comparison.statistics.hyperlinksModified++;

    if (reason.includes('Content ID')) {
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
    status?: 'updated' | 'not_found' | 'expired',
    contentId?: string
  ): void {
    if (!this.comparison) return;

    const changeId = `change-${++this.changeIdCounter}`;
    const location = `Paragraph ${paragraphIndex + 1}, Hyperlink ${hyperlinkIndex + 1}`;

    // Add to general changes
    this.comparison.changes.push({
      id: changeId,
      type: 'hyperlink_text',
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
        originalUrl: original?.url || '',
        modifiedUrl: original?.url || '',
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
      type: 'style',
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
            const currentUrl = item.getUrl() || '';
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
                  changeReason: 'Automatic change detected',
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
   * Generate HTML report of changes
   */
  generateHTMLReport(comparison: ProcessingComparison): string {
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Document Processing Changes</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            background: #f8f9fa;
            color: #212529;
          }
          .container { max-width: 1200px; margin: 0 auto; padding: 20px; }

          .header {
            background: white;
            border-radius: 12px;
            padding: 24px;
            margin-bottom: 24px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
          }

          .header h1 {
            font-size: 24px;
            font-weight: 600;
            margin-bottom: 16px;
            color: #0969da;
          }

          .meta-info {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 12px;
            color: #656d76;
            font-size: 14px;
          }

          .statistics {
            background: white;
            border-radius: 12px;
            padding: 20px;
            margin-bottom: 24px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
          }

          .stat-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 16px;
            margin-top: 16px;
          }

          .stat-card {
            background: #f6f8fa;
            padding: 12px 16px;
            border-radius: 8px;
            border-left: 3px solid #0969da;
          }

          .stat-card .value {
            font-size: 24px;
            font-weight: 600;
            color: #0969da;
          }

          .stat-card .label {
            font-size: 12px;
            color: #656d76;
            text-transform: uppercase;
            letter-spacing: 0.5px;
          }

          .changes-section {
            background: white;
            border-radius: 12px;
            padding: 20px;
            margin-bottom: 24px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
          }

          .changes-section h2 {
            font-size: 18px;
            font-weight: 600;
            margin-bottom: 16px;
            color: #24292f;
          }

          .change-item {
            background: #f6f8fa;
            border-radius: 8px;
            padding: 16px;
            margin-bottom: 12px;
            border: 1px solid #d1d9e0;
            transition: all 0.2s;
          }

          .change-item:hover {
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            transform: translateY(-1px);
          }

          .change-location {
            font-size: 12px;
            color: #656d76;
            margin-bottom: 8px;
            font-weight: 500;
          }

          .change-content {
            display: grid;
            gap: 8px;
          }

          .before, .after {
            padding: 8px 12px;
            border-radius: 6px;
            font-family: 'SF Mono', Monaco, monospace;
            font-size: 13px;
            word-break: break-all;
          }

          .before {
            background: #ffebe9;
            color: #cf222e;
            border: 1px solid #ff8182;
          }

          .after {
            background: #dafbe1;
            color: #1a7f37;
            border: 1px solid #7ee787;
          }

          .change-reason {
            font-size: 12px;
            color: #0969da;
            margin-top: 8px;
            font-style: italic;
          }

          .empty-state {
            text-align: center;
            padding: 40px;
            color: #656d76;
          }

          .processing-time {
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: #0969da;
            color: white;
            padding: 8px 16px;
            border-radius: 20px;
            font-size: 12px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.2);
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>📄 Document Processing Changes Report</h1>
            <div class="meta-info">
              <div>📁 <strong>File:</strong> ${comparison.documentPath}</div>
              <div>🕐 <strong>Start:</strong> ${comparison.processingStartTime.toLocaleString()}</div>
              <div>🕑 <strong>End:</strong> ${comparison.processingEndTime?.toLocaleString() || 'In Progress'}</div>
              <div>⚡ <strong>Duration:</strong> ${comparison.statistics.processingDurationMs}ms</div>
            </div>
          </div>

          <div class="statistics">
            <h2>Processing Statistics</h2>
            <div class="stat-grid">
              <div class="stat-card">
                <div class="value">${comparison.statistics.totalChanges}</div>
                <div class="label">Total Changes</div>
              </div>
              <div class="stat-card">
                <div class="value">${comparison.statistics.hyperlinksModified}</div>
                <div class="label">Hyperlinks Modified</div>
              </div>
              <div class="stat-card">
                <div class="value">${comparison.statistics.urlsChanged}</div>
                <div class="label">URLs Changed</div>
              </div>
              <div class="stat-card">
                <div class="value">${comparison.statistics.displayTextsChanged}</div>
                <div class="label">Texts Updated</div>
              </div>
              <div class="stat-card">
                <div class="value">${comparison.statistics.contentIdsAppended}</div>
                <div class="label">Content IDs Added</div>
              </div>
              <div class="stat-card">
                <div class="value">${comparison.statistics.stylesApplied}</div>
                <div class="label">Styles Applied</div>
              </div>
            </div>
          </div>

          ${this.renderHyperlinkChanges(comparison)}
          ${this.renderStyleChanges(comparison)}
          ${this.renderContentChanges(comparison)}
        </div>

        <div class="processing-time">
          Processing took ${comparison.statistics.processingDurationMs}ms
        </div>
      </body>
      </html>
    `;

    return html;
  }

  /**
   * Render hyperlink changes section
   */
  private renderHyperlinkChanges(comparison: ProcessingComparison): string {
    if (comparison.hyperlinkChanges.length === 0) {
      return `
        <div class="changes-section">
          <h2>🔗 Hyperlink Changes</h2>
          <div class="empty-state">No hyperlink changes detected</div>
        </div>
      `;
    }

    const changes = comparison.hyperlinkChanges
      .map(
        (change) => `
      <div class="change-item">
        <div class="change-location">📍 Paragraph ${change.paragraphIndex + 1}, Hyperlink ${change.hyperlinkIndex + 1}</div>
        <div class="change-content">
          ${
            change.originalUrl !== change.modifiedUrl
              ? `
            <div><strong>URL:</strong></div>
            <div class="before">🔴 ${this.escapeHtml(change.originalUrl)}</div>
            <div class="after">🟢 ${this.escapeHtml(change.modifiedUrl)}</div>
          `
              : ''
          }
          ${
            change.originalText !== change.modifiedText
              ? `
            <div><strong>Display Text:</strong></div>
            <div class="before">🔴 ${this.escapeHtml(change.originalText)}</div>
            <div class="after">🟢 ${this.escapeHtml(change.modifiedText)}</div>
          `
              : ''
          }
        </div>
        <div class="change-reason">💡 ${change.changeReason}</div>
      </div>
    `
      )
      .join('');

    return `
      <div class="changes-section">
        <h2>🔗 Hyperlink Changes (${comparison.hyperlinkChanges.length})</h2>
        ${changes}
      </div>
    `;
  }

  /**
   * Render style changes section
   */
  private renderStyleChanges(comparison: ProcessingComparison): string {
    if (comparison.styleChanges.length === 0) {
      return `
        <div class="changes-section">
          <h2>🎨 Style Changes</h2>
          <div class="empty-state">No style changes detected</div>
        </div>
      `;
    }

    const changes = comparison.styleChanges
      .map(
        (change) => `
      <div class="change-item">
        <div class="change-location">📍 Paragraph ${change.paragraphIndex + 1}</div>
        <div class="change-content">
          <div><strong>Applied Style:</strong> ${change.styleName} (${change.styleId})</div>
          ${Object.entries(change.properties)
            .map(([key, value]) => `<div style="margin-left: 20px;">• ${key}: ${value}</div>`)
            .join('')}
        </div>
      </div>
    `
      )
      .join('');

    return `
      <div class="changes-section">
        <h2>🎨 Style Changes (${comparison.styleChanges.length})</h2>
        ${changes}
      </div>
    `;
  }

  /**
   * Render content changes section
   */
  private renderContentChanges(comparison: ProcessingComparison): string {
    if (comparison.contentChanges.length === 0) {
      return `
        <div class="changes-section">
          <h2>📝 Content Changes</h2>
          <div class="empty-state">No content changes detected</div>
        </div>
      `;
    }

    const changes = comparison.contentChanges
      .map(
        (change) => `
      <div class="change-item">
        <div class="change-location">📍 Paragraph ${change.paragraphIndex + 1}</div>
        <div class="change-content">
          ${
            change.type === 'added'
              ? `
            <div class="after">🟢 Added: ${this.escapeHtml(change.modifiedContent || '')}</div>
          `
              : ''
          }
          ${
            change.type === 'removed'
              ? `
            <div class="before">🔴 Removed: ${this.escapeHtml(change.originalContent || '')}</div>
          `
              : ''
          }
          ${change.type === 'modified' && change.diff ? this.renderDiff(change.diff) : ''}
        </div>
      </div>
    `
      )
      .join('');

    return `
      <div class="changes-section">
        <h2>📝 Content Changes (${comparison.contentChanges.length})</h2>
        ${changes}
      </div>
    `;
  }

  /**
   * Render diff with inline changes
   */
  private renderDiff(changes: Change[]): string {
    let html = '<div style="line-height: 1.6;">';

    for (const change of changes) {
      if (change.added) {
        html += `<span style="background: #dafbe1; color: #1a7f37; padding: 2px 4px; border-radius: 3px;">${this.escapeHtml(change.value)}</span>`;
      } else if (change.removed) {
        html += `<span style="background: #ffebe9; color: #cf222e; padding: 2px 4px; text-decoration: line-through; border-radius: 3px;">${this.escapeHtml(change.value)}</span>`;
      } else {
        html += this.escapeHtml(change.value);
      }
    }

    html += '</div>';
    return html;
  }

  /**
   * Escape HTML for safe rendering
   */
  private escapeHtml(text: string): string {
    const div = document?.createElement ? document.createElement('div') : null;
    if (div) {
      div.textContent = text;
      return div.innerHTML;
    }
    // Fallback for Node.js environment
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
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
