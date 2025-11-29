/**
 * HyperlinkProcessor - Hyperlink manipulation and API integration
 *
 * Handles:
 * - Hyperlink formatting standardization
 * - PowerAutomate API integration for URL/text updates
 * - Custom replacement rules
 * - Internal hyperlink repair
 * - URL update batch processing
 */

import {
  Document,
  Hyperlink,
  Revision,
} from "docxmlater";
import type { DetailedHyperlinkInfo, HyperlinkType } from "@/types/hyperlink";
import type { DocumentChange } from "@/types/session";
import { logger } from "@/utils/logger";
import { sanitizeHyperlinkText } from "@/utils/textSanitizer";
import { extractLookupIds } from "@/utils/urlPatterns";
import { hyperlinkService } from "../../HyperlinkService";
import { DocXMLaterProcessor } from "../DocXMLaterProcessor";
import { documentProcessingComparison } from "../DocumentProcessingComparison";

const log = logger.namespace("HyperlinkProcessor");

/**
 * Result of URL update batch operation
 */
export interface UrlUpdateResult {
  updated: number;
  failed: Array<{
    oldUrl: string;
    newUrl: string;
    error: unknown;
    paragraphIndex?: number;
  }>;
}

/**
 * Result of hyperlink processing
 */
export interface HyperlinkProcessingResult {
  updatedUrls: number;
  updatedDisplayTexts: number;
  standardizedCount: number;
  changes: DocumentChange[];
  processedLinks: Array<{
    id: string;
    url: string;
    displayText: string;
    type: HyperlinkType;
    location: string;
    status: "processed" | "skipped" | "error";
    before: string;
    after: string;
    modifications: string[];
  }>;
  errorMessages: string[];
}

/**
 * Options for hyperlink processing
 */
export interface HyperlinkProcessingOptions {
  apiEndpoint?: string;
  operations?: {
    fixContentIds?: boolean;
    updateTitles?: boolean;
    processHyperlinks?: boolean;
    standardizeHyperlinkColor?: boolean;
    fixInternalHyperlinks?: boolean;
  };
  trackChanges?: boolean;
  userProfile?: {
    firstName: string;
    lastName: string;
    email: string;
  };
  customReplacements?: Array<{
    find: string;
    replace: string;
    matchType: "contains" | "exact" | "startsWith";
    applyTo: "url" | "text" | "both";
  }>;
}

/**
 * Hyperlink processing service
 */
export class HyperlinkProcessor {
  private docXMLater: DocXMLaterProcessor;
  private readonly DEBUG = process.env.NODE_ENV !== "production";

  constructor() {
    this.docXMLater = new DocXMLaterProcessor();
  }

  /**
   * Standardize hyperlink formatting to Verdana 12pt blue underlined
   */
  async standardizeFormatting(doc: Document): Promise<number> {
    let standardizedCount = 0;

    try {
      const hyperlinks = await this.docXMLater.extractHyperlinks(doc);
      log.debug(`Found ${hyperlinks.length} hyperlinks to standardize`);

      for (const { hyperlink, url, text } of hyperlinks) {
        try {
          hyperlink.setFormatting({
            font: "Verdana",
            size: 12,
            color: "0000FF",
            underline: "single",
            bold: false,
            italic: false,
          });
          standardizedCount++;
          log.debug(`Standardized hyperlink: "${text}" (${url})`);
        } catch (error) {
          log.warn(`Failed to standardize hyperlink "${text}": ${error}`);
        }
      }

      log.info(`Standardized ${standardizedCount} of ${hyperlinks.length} hyperlinks`);
    } catch (error) {
      log.error(`Error standardizing hyperlink formatting: ${error}`);
      throw error;
    }

    return standardizedCount;
  }

  /**
   * Apply URL updates to hyperlinks with track changes support
   */
  async applyUrlUpdates(
    doc: Document,
    urlMap: Map<string, string>,
    author: string = "DocHub"
  ): Promise<UrlUpdateResult> {
    if (urlMap.size === 0) {
      return { updated: 0, failed: [] };
    }

    const failedUrls: UrlUpdateResult["failed"] = [];
    let updatedCount = 0;
    const paragraphs = doc.getAllParagraphs();
    const trackChangesEnabled = doc.isTrackChangesEnabled();

    log.debug(`Processing ${paragraphs.length} paragraphs for URL updates`);

    for (let paraIndex = 0; paraIndex < paragraphs.length; paraIndex++) {
      const para = paragraphs[paraIndex];
      const content = para.getContent();

      for (const item of [...content]) {
        if (item instanceof Hyperlink) {
          const oldUrl = item.getUrl();

          if (oldUrl && urlMap.has(oldUrl)) {
            const newUrl = urlMap.get(oldUrl)!;

            if (oldUrl === newUrl) {
              continue;
            }

            try {
              if (trackChangesEnabled) {
                const oldHyperlink = item.clone();
                item.setUrl(newUrl);

                const deletion = Revision.createDeletion(author, [oldHyperlink]);
                const insertion = Revision.createInsertion(author, [item]);

                const replaced = para.replaceContent(item, [deletion, insertion]);

                if (replaced) {
                  const revisionManager = doc.getRevisionManager();
                  revisionManager.register(deletion);
                  revisionManager.register(insertion);
                  log.debug(`Created tracked change for hyperlink URL: ${oldUrl} -> ${newUrl}`);
                }
              } else {
                item.setUrl(newUrl);
                log.debug(`Updated hyperlink URL: ${oldUrl} -> ${newUrl}`);
              }

              updatedCount++;
            } catch (error) {
              log.error(`Failed to update URL at paragraph ${paraIndex}: ${oldUrl} -> ${newUrl}`, error);
              failedUrls.push({
                oldUrl,
                newUrl,
                error,
                paragraphIndex: paraIndex,
              });
            }
          }
        }
      }
    }

    if (failedUrls.length > 0) {
      log.warn(`URL update completed with ${failedUrls.length} failures`);
    } else {
      log.info(`Successfully updated ${updatedCount} hyperlink URLs`);
    }

    return { updated: updatedCount, failed: failedUrls };
  }

  /**
   * Process custom URL and text replacements
   */
  async processCustomReplacements(
    doc: Document,
    replacements: NonNullable<HyperlinkProcessingOptions["customReplacements"]>
  ): Promise<{ updatedUrls: number; updatedTexts: number }> {
    const hyperlinks = await this.docXMLater.extractHyperlinks(doc);
    let updatedUrls = 0;
    let updatedTexts = 0;

    for (const { hyperlink, url, text } of hyperlinks) {
      for (const rule of replacements) {
        if (rule.applyTo === "url" || rule.applyTo === "both") {
          if (url && this.matchesPattern(url, rule.find, rule.matchType)) {
            const newUrl = url.replace(rule.find, rule.replace);
            hyperlink.setUrl(newUrl);
            updatedUrls++;
          }
        }

        if (rule.applyTo === "text" || rule.applyTo === "both") {
          if (this.matchesPattern(text, rule.find, rule.matchType)) {
            const newText = text.replace(rule.find, rule.replace);
            hyperlink.setText(newText);
            updatedTexts++;
          }
        }
      }
    }

    return { updatedUrls, updatedTexts };
  }

  /**
   * Fix internal hyperlinks - repair broken bookmarks
   */
  async fixInternalHyperlinks(doc: Document): Promise<number> {
    const hyperlinks = await this.docXMLater.extractHyperlinks(doc);
    let fixedCount = 0;

    for (const { hyperlink, text } of hyperlinks) {
      const anchor = hyperlink.getAnchor();
      if (!anchor) continue;

      const bookmarkExists = doc.hasBookmark(anchor);

      if (!bookmarkExists) {
        if (text) {
          const matchingHeading = this.findHeadingByText(doc, text);
          if (matchingHeading) {
            const newBookmark = this.createBookmarkForHeading(doc, matchingHeading, anchor);
            if (newBookmark) {
              fixedCount++;
              log.info(`Created bookmark "${anchor}" for heading "${text}"`);
            }
          }
        }
      }
    }

    return fixedCount;
  }

  /**
   * Find matching API result for a URL
   */
  findMatchingApiResult(url: string, apiResultsMap: Map<string, unknown>): unknown {
    if (!url || !apiResultsMap || apiResultsMap.size === 0) {
      return null;
    }

    const lookupIds = extractLookupIds(url);
    if (!lookupIds) {
      return null;
    }

    if (lookupIds.contentId) {
      const result = apiResultsMap.get(lookupIds.contentId);
      if (result) {
        log.debug(`Matched by Content_ID: ${lookupIds.contentId}`);
        return result;
      }
    }

    if (lookupIds.documentId) {
      const result = apiResultsMap.get(lookupIds.documentId);
      if (result) {
        log.debug(`Matched by Document_ID: ${lookupIds.documentId}`);
        return result;
      }
    }

    return null;
  }

  /**
   * Pattern matching helper
   */
  private matchesPattern(
    text: string,
    pattern: string,
    matchType: "contains" | "exact" | "startsWith"
  ): boolean {
    switch (matchType) {
      case "exact":
        return text === pattern;
      case "startsWith":
        return text.startsWith(pattern);
      case "contains":
      default:
        return text.includes(pattern);
    }
  }

  /**
   * Find heading by text content
   */
  private findHeadingByText(doc: Document, searchText: string): unknown | null {
    const normalizedSearch = searchText.trim().toLowerCase();
    const paragraphs = doc.getAllParagraphs();

    for (const para of paragraphs) {
      const style = para.getStyle();

      if (style && (style.startsWith("Heading") || style.includes("Heading"))) {
        const paraText = (para.getText() || "").trim().toLowerCase();
        if (paraText === normalizedSearch) {
          return para;
        }
      }
    }

    return null;
  }

  /**
   * Create bookmark for heading
   */
  private createBookmarkForHeading(
    doc: Document,
    heading: unknown,
    bookmarkName: string
  ): boolean {
    try {
      // Implementation depends on docxmlater API
      // This is a placeholder for the actual implementation
      return false;
    } catch (error) {
      log.warn(`Failed to create bookmark: ${error}`);
      return false;
    }
  }
}

export const hyperlinkProcessor = new HyperlinkProcessor();
