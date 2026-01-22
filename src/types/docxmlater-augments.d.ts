/**
 * Type augmentations for DocXMLater library
 *
 * This file declares optional methods that exist on the DocXMLater Document class
 * but are not included in the library's type definitions. These augmentations
 * provide type safety for feature detection patterns.
 *
 * @module docxmlater-augments
 */

import type { Document } from 'docxmlater';
import type { SessionStyle } from './session';
import type { TableShadingSettings } from '@/services/document/processors/TableProcessor';

/**
 * Configuration for the applyStyles method
 */
export interface ApplyStylesConfig {
  heading1?: StyleConfig;
  heading2?: StyleConfig;
  heading3?: StyleConfig;
  normal?: StyleConfig;
  listParagraph?: StyleConfig;
  heading2Tables?: Heading2TableConfig;
}

/**
 * Style configuration for individual style types
 */
export interface StyleConfig {
  fontFamily?: string;
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;
  alignment?: 'left' | 'center' | 'right' | 'justify';
  spaceBefore?: number;
  spaceAfter?: number;
  lineSpacing?: number;
  preserveBold?: boolean;
  preserveItalic?: boolean;
  preserveUnderline?: boolean;
}

/**
 * Configuration for Heading 2 table styling
 */
export interface Heading2TableConfig {
  enabled: boolean;
  shadingColor?: string;
  fontFamily?: string;
  fontSize?: number;
}

/**
 * Result from applyStyles operation
 */
export interface StyleResults {
  heading1: number;
  heading2: number;
  heading3: number;
  normal: number;
  listParagraph: number;
}

/**
 * Change entry from tracked changes
 */
export interface ChangeEntry {
  id: string;
  type: 'insertion' | 'deletion' | 'formatting';
  author: string;
  date?: string;
  text?: string;
  location?: string;
}

// Augment the docxmlater module to include optional methods
declare module 'docxmlater' {
  interface Document {
    /**
     * Apply custom styles to paragraphs based on configuration.
     * This method may not be available in all versions of DocXMLater.
     *
     * @param config - Style configuration object
     * @returns Results indicating how many paragraphs were styled
     */
    applyStyles?(config: ApplyStylesConfig): StyleResults;

    /**
     * Flush any pending tracked changes to the document.
     * This method may not be available in all versions of DocXMLater.
     *
     * @returns Array of change entries that were flushed, or null if none
     */
    flushPendingChanges?(): ChangeEntry[] | null;

    /**
     * Accept all tracked revisions in the document.
     * This method may not be available in all versions of DocXMLater.
     */
    acceptAllRevisions?(): Promise<void>;
  }
}

/**
 * Type guard to check if a Document has the applyStyles method
 *
 * @param doc - The document to check
 * @returns true if the document has the applyStyles method
 *
 * @example
 * ```typescript
 * if (hasApplyStyles(doc)) {
 *   const result = doc.applyStyles(config);
 * }
 * ```
 */
export function hasApplyStyles(doc: Document): doc is Document & { applyStyles: NonNullable<Document['applyStyles']> } {
  return typeof (doc as Document).applyStyles === 'function';
}

/**
 * Type guard to check if a Document has the flushPendingChanges method
 *
 * @param doc - The document to check
 * @returns true if the document has the flushPendingChanges method
 */
export function hasFlushPendingChanges(doc: Document): doc is Document & { flushPendingChanges: NonNullable<Document['flushPendingChanges']> } {
  return typeof (doc as Document).flushPendingChanges === 'function';
}

/**
 * Type guard to check if a Document has the acceptAllRevisions method
 *
 * @param doc - The document to check
 * @returns true if the document has the acceptAllRevisions method
 */
export function hasAcceptAllRevisions(doc: Document): doc is Document & { acceptAllRevisions: NonNullable<Document['acceptAllRevisions']> } {
  return typeof (doc as Document).acceptAllRevisions === 'function';
}
