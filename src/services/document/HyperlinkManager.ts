/**
 * HyperlinkManager - Manages all hyperlink operations in Word documents
 * Implements the two-part OpenXML reference system
 */

import type {
  DetailedHyperlinkInfo,
  HyperlinkProcessingOptions,
  HyperlinkValidationIssue,
  HyperlinkType
} from '@/types/hyperlink';

/**
 * Pre-defined regex patterns for theSource URLs
 */
const CONTENT_ID_PATTERN = /(TSRC|CMS)-([a-zA-Z0-9]+)-(\d{6})/i;
const DOCUMENT_ID_PATTERN = /docid=([a-zA-Z0-9-]+)(?:[^a-zA-Z0-9-]|$)/i;
const THE_SOURCE_PATTERN = /thesource\.cvshealth\.com/i;

/**
 * Cached hyperlink data for performance optimization
 */
interface HyperlinkCacheEntry {
  url: string;
  relationshipId: string;
  displayText: string;
  type: HyperlinkType;
  lastModified: number;
  processCount: number;
}

/**
 * Cache statistics for monitoring
 */
interface CacheStats {
  totalEntries: number;
  hits: number;
  misses: number;
  hitRate: number;
}

/**
 * Manages hyperlink operations in Word documents
 */
export class HyperlinkManager {
  private relationshipCounter = 1;
  private processedHyperlinks = new Map<string, HyperlinkCacheEntry>();
  private cacheHits = 0;
  private cacheMisses = 0;

  /**
   * Scan and extract all hyperlinks from document
   */
  async scanHyperlinks(
    documentXml: any,
    relsXml: any,
    options: HyperlinkProcessingOptions = {}
  ): Promise<DetailedHyperlinkInfo[]> {
    const hyperlinks: DetailedHyperlinkInfo[] = [];
    const relationships = this.extractRelationships(relsXml);

    // Traverse document to find hyperlinks
    this.traverseElement(documentXml, (element: any, path: string) => {
      if (element['w:hyperlink']) {
        const hyperlinkElements = Array.isArray(element['w:hyperlink'])
          ? element['w:hyperlink']
          : [element['w:hyperlink']];

        for (const hyperlink of hyperlinkElements) {
          // CRITICAL: Use correct attribute accessor with @_ prefix (OOXML_HYPERLINK_ARCHITECTURE.md)
          const relationshipId = hyperlink['@_r:id'];

          // Check cache first for performance
          let hyperlinkInfo: DetailedHyperlinkInfo | null = null;
          const cached = this.getCachedHyperlink(relationshipId);

          if (cached) {
            // Reconstruct hyperlinkInfo from cache
            hyperlinkInfo = {
              id: cached.relationshipId,
              relationshipId: cached.relationshipId,
              element: hyperlink,
              containingPart: 'document.xml',
              url: cached.url,
              displayText: cached.displayText,
              type: cached.type,
              isInternal: cached.type === 'internal' || cached.type === 'bookmark',
              isValid: true,
              validationMessage: '',
              context: path,
            };
          } else {
            // Not in cache, extract from XML
            hyperlinkInfo = this.extractHyperlinkInfo(
              hyperlink,
              relationships,
              path
            );

            // Cache the extracted info for future use
            if (hyperlinkInfo) {
              this.cacheHyperlink(hyperlinkInfo);
            }
          }

          if (hyperlinkInfo && this.shouldProcessHyperlink(hyperlinkInfo, options)) {
            hyperlinks.push(hyperlinkInfo);
          }
        }
      }
    });

    return hyperlinks;
  }

  /**
   * Append content IDs to matching hyperlinks
   */
  async appendContentIds(
    documentXml: any,
    relsXml: any,
    contentId: string,
    targetPattern?: RegExp
  ): Promise<number> {
    let modifiedCount = 0;
    const relationships = this.extractRelationships(relsXml);

    // Get all relationships that are hyperlinks
    if (relsXml.Relationships?.Relationship) {
      const rels = Array.isArray(relsXml.Relationships.Relationship)
        ? relsXml.Relationships.Relationship
        : [relsXml.Relationships.Relationship];

      for (const rel of rels) {
        // Use proper @_ prefix for attributes (OOXML_HYPERLINK_ARCHITECTURE.md)
        if (rel['@_Type']?.includes('hyperlink') && rel['@_Target']) {
          const url = rel['@_Target'];

          // Check if this is a theSource URL that needs Content ID
          if (this.shouldAppendContentId(url, targetPattern)) {
            // Append content ID if not already present
            if (!url.includes(contentId)) {
              rel['@_Target'] = url + contentId;
              // CRITICAL: Ensure TargetMode is set for external URLs
              if (url.startsWith('http')) {
                rel['@_TargetMode'] = 'External';
              }
              modifiedCount++;
            }
          }
        }
      }
    }

    return modifiedCount;
  }

  /**
   * Update hyperlinks matching pattern
   */
  async updateHyperlinks(
    documentXml: any,
    relsXml: any,
    targetPattern: RegExp,
    replacement: string
  ): Promise<number> {
    let modifiedCount = 0;

    if (relsXml.Relationships?.Relationship) {
      const rels = Array.isArray(relsXml.Relationships.Relationship)
        ? relsXml.Relationships.Relationship
        : [relsXml.Relationships.Relationship];

      for (const rel of rels) {
        // Use proper @_ prefix for attributes (OOXML_HYPERLINK_ARCHITECTURE.md)
        if (rel['@_Type']?.includes('hyperlink') && rel['@_Target']) {
          if (targetPattern.test(rel['@_Target'])) {
            rel['@_Target'] = rel['@_Target'].replace(targetPattern, replacement);
            // Ensure TargetMode is set for external URLs
            if (rel['@_Target'].startsWith('http')) {
              rel['@_TargetMode'] = 'External';
            }
            modifiedCount++;
          }
        }
      }
    }

    return modifiedCount;
  }

  /**
   * Validate all hyperlinks
   */
  async validateHyperlinks(
    documentXml: any,
    relsXml: any
  ): Promise<HyperlinkValidationIssue[]> {
    const issues: HyperlinkValidationIssue[] = [];
    const relationships = this.extractRelationships(relsXml);
    const usedRelationships = new Set<string>();

    // Find all used relationship IDs in document
    this.traverseElement(documentXml, (element: any) => {
      // Use proper @_ prefix for attributes (OOXML_HYPERLINK_ARCHITECTURE.md)
      if (element['w:hyperlink']?.['@_r:id']) {
        usedRelationships.add(element['w:hyperlink']['@_r:id']);
      }
    });

    // Check for orphaned relationships
    for (const [id, rel] of relationships.entries()) {
      if (!usedRelationships.has(id)) {
        issues.push({
          hyperlinkId: id,
          url: rel.target,
          issueType: 'orphaned',
          severity: 'warning',
          message: `Orphaned hyperlink relationship: ${id}`,
          suggestion: 'Remove unused relationship',
          autoFixable: true
        });
      }

      // Validate URL format
      if (!this.isValidUrl(rel.target)) {
        issues.push({
          hyperlinkId: id,
          url: rel.target,
          issueType: 'invalid_url',
          severity: 'error',
          message: `Invalid URL format: ${rel.target}`,
          suggestion: 'Fix URL format',
          autoFixable: false
        });
      }
    }

    // Check for missing relationships
    for (const id of usedRelationships) {
      if (!relationships.has(id)) {
        issues.push({
          hyperlinkId: id,
          url: '',
          issueType: 'missing_relationship',
          severity: 'error',
          message: `Missing relationship for ID: ${id}`,
          suggestion: 'Remove hyperlink or add relationship',
          autoFixable: false
        });
      }
    }

    return issues;
  }

  /**
   * Remove hyperlinks matching pattern
   */
  async removeHyperlinks(
    documentXml: any,
    relsXml: any,
    targetPattern: RegExp
  ): Promise<number> {
    let removedCount = 0;
    const toRemove: string[] = [];

    // Find relationships to remove
    if (relsXml.Relationships?.Relationship) {
      const rels = Array.isArray(relsXml.Relationships.Relationship)
        ? relsXml.Relationships.Relationship
        : [relsXml.Relationships.Relationship];

      for (let i = 0; i < rels.length; i++) {
        const rel = rels[i];
        // Use proper @_ prefix for attributes (OOXML_HYPERLINK_ARCHITECTURE.md)
        if (rel['@_Type']?.includes('hyperlink') && rel['@_Target']) {
          if (targetPattern.test(rel['@_Target'])) {
            toRemove.push(rel['@_Id']);
            removedCount++;
          }
        }
      }

      // Remove marked relationships
      relsXml.Relationships.Relationship = rels.filter(
        (rel: any) => !toRemove.includes(rel['@_Id'])
      );
    }

    // Remove hyperlink elements from document
    if (removedCount > 0) {
      this.removeHyperlinkElements(documentXml, toRemove);
    }

    return removedCount;
  }

  /**
   * Update hyperlink display text
   */
  async updateHyperlinkText(
    documentXml: any,
    relationshipId: string,
    newText: string
  ): Promise<boolean> {
    let updated = false;

    this.traverseElement(documentXml, (element: any) => {
      // Use proper @_ prefix for attributes (OOXML_HYPERLINK_ARCHITECTURE.md)
      if (element['w:hyperlink']?.['@_r:id'] === relationshipId) {
        // Find text runs within hyperlink
        const runs = element['w:hyperlink']['w:r'];
        if (runs) {
          const runArray = Array.isArray(runs) ? runs : [runs];
          for (const run of runArray) {
            if (run['w:t']) {
              // Preserve xml:space attribute according to OOXML_HYPERLINK_ARCHITECTURE.md
              if (typeof run['w:t'] === 'string') {
                run['w:t'] = {
                  '@_xml:space': 'preserve',
                  '#text': newText
                };
              } else if (run['w:t']['#text'] !== undefined) {
                run['w:t']['#text'] = newText;
                // Keep existing attributes like '@_xml:space'
              }
              updated = true;
              break; // Update only first text run
            }
          }
        }
      }
    });

    return updated;
  }

  /**
   * Clean up orphaned relationships
   */
  async cleanupOrphanedRelationships(
    documentXml: any,
    relsXml: any
  ): Promise<number> {
    const usedRelationships = new Set<string>();
    let removedCount = 0;

    // Find all used relationship IDs
    this.traverseElement(documentXml, (element: any) => {
      // Use proper @_ prefix for attributes (OOXML_HYPERLINK_ARCHITECTURE.md)
      if (element['w:hyperlink']?.['@_r:id']) {
        usedRelationships.add(element['w:hyperlink']['@_r:id']);
      }
    });

    // Remove unused relationships
    if (relsXml.Relationships?.Relationship) {
      const rels = Array.isArray(relsXml.Relationships.Relationship)
        ? relsXml.Relationships.Relationship
        : [relsXml.Relationships.Relationship];

      relsXml.Relationships.Relationship = rels.filter((rel: any) => {
        // Use proper @_ prefix for attributes (OOXML_HYPERLINK_ARCHITECTURE.md)
        if (rel['@_Type']?.includes('hyperlink') && !usedRelationships.has(rel['@_Id'])) {
          removedCount++;
          return false;
        }
        return true;
      });
    }

    return removedCount;
  }

  /**
   * Consolidate duplicate URLs
   */
  async consolidateDuplicates(
    documentXml: any,
    relsXml: any
  ): Promise<number> {
    const urlMap = new Map<string, string[]>();
    let consolidatedCount = 0;

    // Group relationships by URL
    if (relsXml.Relationships?.Relationship) {
      const rels = Array.isArray(relsXml.Relationships.Relationship)
        ? relsXml.Relationships.Relationship
        : [relsXml.Relationships.Relationship];

      for (const rel of rels) {
        // Use proper @_ prefix for attributes (OOXML_HYPERLINK_ARCHITECTURE.md)
        if (rel['@_Type']?.includes('hyperlink') && rel['@_Target']) {
          const url = rel['@_Target'];
          const ids = urlMap.get(url) || [];
          ids.push(rel['@_Id']);
          urlMap.set(url, ids);
        }
      }

      // Process duplicates
      for (const [url, ids] of urlMap.entries()) {
        if (ids.length > 1) {
          const [keepId, ...removeIds] = ids;
          consolidatedCount += removeIds.length;

          // Update document references
          this.updateHyperlinkReferences(documentXml, removeIds, keepId);

          // Remove duplicate relationships
          relsXml.Relationships.Relationship = rels.filter(
            (rel: any) => !removeIds.includes(rel['@_Id'])
          );
        }
      }
    }

    return consolidatedCount;
  }

  // Private helper methods

  /**
   * Check if URL should have content ID appended
   */
  private shouldAppendContentId(url: string, targetPattern?: RegExp): boolean {
    // First check custom pattern if provided
    if (targetPattern && !targetPattern.test(url)) {
      return false;
    }

    // Check if it's a theSource URL
    if (!THE_SOURCE_PATTERN.test(url)) {
      return false;
    }

    // Check if it matches Content ID or Document ID patterns
    return CONTENT_ID_PATTERN.test(url) || DOCUMENT_ID_PATTERN.test(url);
  }

  /**
   * Extract relationships from rels XML
   */
  private extractRelationships(relsXml: any): Map<string, any> {
    const relationships = new Map();

    if (relsXml.Relationships?.Relationship) {
      const rels = Array.isArray(relsXml.Relationships.Relationship)
        ? relsXml.Relationships.Relationship
        : [relsXml.Relationships.Relationship];

      for (const rel of rels) {
        // Use proper @_ prefix for attributes (OOXML_HYPERLINK_ARCHITECTURE.md)
        relationships.set(rel['@_Id'], {
          type: rel['@_Type'],
          target: rel['@_Target'],
          targetMode: rel['@_TargetMode']
        });
      }
    }

    return relationships;
  }

  /**
   * Extract hyperlink information from element
   */
  private extractHyperlinkInfo(
    hyperlink: any,
    relationships: Map<string, any>,
    path: string
  ): DetailedHyperlinkInfo | null {
    // Use proper @_ prefix for attributes (OOXML_HYPERLINK_ARCHITECTURE.md)
    const relationshipId = hyperlink['@_r:id'];
    if (!relationshipId) return null;

    const rel = relationships.get(relationshipId);
    if (!rel) return null;

    // Extract display text from runs
    let displayText = '';
    const runs = hyperlink['w:r'];
    if (runs) {
      const runArray = Array.isArray(runs) ? runs : [runs];
      for (const run of runArray) {
        if (run['w:t']) {
          displayText += typeof run['w:t'] === 'string' ? run['w:t'] : '';
        }
      }
    }

    // Determine hyperlink type
    const type = this.determineHyperlinkType(rel.target);

    return {
      id: relationshipId,
      relationshipId,
      element: hyperlink,
      containingPart: 'document.xml',
      url: rel.target,
      displayText,
      type,
      isInternal: type === 'internal' || type === 'bookmark',
      isValid: true,
      validationMessage: '',
      context: path
    };
  }

  /**
   * Determine hyperlink type from URL
   */
  private determineHyperlinkType(url: string): HyperlinkType {
    if (!url) return 'external';
    if (url.startsWith('#')) return 'bookmark';
    if (url.startsWith('mailto:')) return 'email';
    if (url.startsWith('file://')) return 'file';
    if (url.startsWith('http://') || url.startsWith('https://')) return 'external';
    return 'internal';
  }

  /**
   * Check if hyperlink should be processed
   */
  private shouldProcessHyperlink(
    hyperlink: DetailedHyperlinkInfo,
    options: HyperlinkProcessingOptions
  ): boolean {
    if (options.processInternalLinks === false && hyperlink.isInternal) {
      return false;
    }

    if (options.processExternalLinks === false && !hyperlink.isInternal) {
      return false;
    }

    if (options.urlPattern) {
      const pattern = options.urlPattern instanceof RegExp
        ? options.urlPattern
        : new RegExp(options.urlPattern, 'i');
      if (!pattern.test(hyperlink.url)) {
        return false;
      }
    }

    if (options.displayTextPattern) {
      const pattern = options.displayTextPattern instanceof RegExp
        ? options.displayTextPattern
        : new RegExp(options.displayTextPattern, 'i');
      if (!pattern.test(hyperlink.displayText)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Validate URL format
   */
  private isValidUrl(url: string): boolean {
    if (!url) return false;

    // Allow internal links
    if (url.startsWith('#')) return true;

    // Allow common protocols
    if (url.startsWith('http://') ||
        url.startsWith('https://') ||
        url.startsWith('mailto:') ||
        url.startsWith('file://')) {
      try {
        new URL(url);
        return true;
      } catch {
        return false;
      }
    }

    return false;
  }

  /**
   * Traverse XML element tree
   */
  private traverseElement(
    element: any,
    callback: (element: any, path: string) => void,
    path: string = ''
  ): void {
    if (!element || typeof element !== 'object') return;

    callback(element, path);

    for (const [key, value] of Object.entries(element)) {
      if (typeof value === 'object') {
        if (Array.isArray(value)) {
          for (let i = 0; i < value.length; i++) {
            this.traverseElement(value[i], callback, `${path}/${key}[${i}]`);
          }
        } else {
          this.traverseElement(value, callback, `${path}/${key}`);
        }
      }
    }
  }

  /**
   * Remove hyperlink elements from document
   */
  private removeHyperlinkElements(documentXml: any, relationshipIds: string[]): void {
    const idSet = new Set(relationshipIds);

    this.traverseElement(documentXml, (element: any) => {
      if (element['w:hyperlink']) {
        const hyperlinks = Array.isArray(element['w:hyperlink'])
          ? element['w:hyperlink']
          : [element['w:hyperlink']];

        element['w:hyperlink'] = hyperlinks.filter(
          // Use proper @_ prefix for attributes (OOXML_HYPERLINK_ARCHITECTURE.md)
          (h: any) => !idSet.has(h['@_r:id'])
        );

        if (element['w:hyperlink'].length === 0) {
          delete element['w:hyperlink'];
        }
      }
    });
  }

  /**
   * Update hyperlink references in document
   */
  private updateHyperlinkReferences(
    documentXml: any,
    oldIds: string[],
    newId: string
  ): void {
    const oldIdSet = new Set(oldIds);

    this.traverseElement(documentXml, (element: any) => {
      // Use proper @_ prefix for attributes (OOXML_HYPERLINK_ARCHITECTURE.md)
      if (element['w:hyperlink']?.['@_r:id'] && oldIdSet.has(element['w:hyperlink']['@_r:id'])) {
        element['w:hyperlink']['@_r:id'] = newId;
      }
    });
  }

  /**
   * Generate new relationship ID
   */
  generateRelationshipId(): string {
    return `rId${this.relationshipCounter++}`;
  }

  // ============================================================================
  // CACHE MANAGEMENT METHODS
  // ============================================================================

  /**
   * Get cached hyperlink data
   */
  getCachedHyperlink(relationshipId: string): HyperlinkCacheEntry | null {
    const entry = this.processedHyperlinks.get(relationshipId);
    if (entry) {
      this.cacheHits++;
      return entry;
    }
    this.cacheMisses++;
    return null;
  }

  /**
   * Cache hyperlink data for future lookups
   */
  cacheHyperlink(hyperlinkInfo: DetailedHyperlinkInfo): void {
    const entry: HyperlinkCacheEntry = {
      url: hyperlinkInfo.url,
      relationshipId: hyperlinkInfo.relationshipId,
      displayText: hyperlinkInfo.displayText,
      type: hyperlinkInfo.type,
      lastModified: Date.now(),
      processCount: 1,
    };

    const existing = this.processedHyperlinks.get(hyperlinkInfo.relationshipId);
    if (existing) {
      entry.processCount = existing.processCount + 1;
    }

    this.processedHyperlinks.set(hyperlinkInfo.relationshipId, entry);
  }

  /**
   * Check if hyperlink is cached
   */
  isCached(relationshipId: string): boolean {
    return this.processedHyperlinks.has(relationshipId);
  }

  /**
   * Clear all cached hyperlinks
   */
  clearCache(): void {
    this.processedHyperlinks.clear();
    this.cacheHits = 0;
    this.cacheMisses = 0;
  }

  /**
   * Remove specific hyperlink from cache
   */
  removeCached(relationshipId: string): boolean {
    return this.processedHyperlinks.delete(relationshipId);
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): CacheStats {
    const totalRequests = this.cacheHits + this.cacheMisses;
    return {
      totalEntries: this.processedHyperlinks.size,
      hits: this.cacheHits,
      misses: this.cacheMisses,
      hitRate: totalRequests > 0 ? (this.cacheHits / totalRequests) * 100 : 0,
    };
  }

  /**
   * Get all cached hyperlinks
   */
  getAllCached(): Map<string, HyperlinkCacheEntry> {
    return new Map(this.processedHyperlinks);
  }

  /**
   * Prune old cache entries (older than maxAgeMs)
   */
  pruneCache(maxAgeMs: number = 3600000): number {
    const now = Date.now();
    let prunedCount = 0;

    for (const [id, entry] of this.processedHyperlinks.entries()) {
      if (now - entry.lastModified > maxAgeMs) {
        this.processedHyperlinks.delete(id);
        prunedCount++;
      }
    }

    return prunedCount;
  }
}