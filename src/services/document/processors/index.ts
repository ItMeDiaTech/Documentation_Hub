/**
 * Document Processors - Focused modules for WordDocumentProcessor
 *
 * This module exports specialized processors that handle specific aspects
 * of document processing. These were refactored from the monolithic
 * WordDocumentProcessor.ts (5400+ lines) into focused, testable modules.
 *
 * Processors:
 * - HyperlinkProcessor: Hyperlink manipulation, API integration, URL updates
 * - TableProcessor: Table formatting, uniformity, Header2 handling
 * - ListProcessor: List bullets, numbering, indentation
 * - StyleProcessor: Heading styles, text formatting, style definitions
 * - StructureProcessor: Blank lines, paragraphs, document structure
 */

export { HyperlinkProcessor, hyperlinkProcessor } from "./HyperlinkProcessor";
export type { UrlUpdateResult, HyperlinkProcessingResult, HyperlinkProcessingOptions } from "./HyperlinkProcessor";

export { TableProcessor, tableProcessor } from "./TableProcessor";
export type { TableShadingSettings, TableFormattingResult, Header2TableValidationResult, HLPTableAnalysis, HLPVariant, HLPTableProcessingResult } from "./TableProcessor";

export { ListProcessor, listProcessor } from "./ListProcessor";
export type { ListIndentationLevel, ListBulletSettings, ListProcessingResult } from "./ListProcessor";

export { StyleProcessor, styleProcessor } from "./StyleProcessor";
export type { SessionStyle, StyleApplicationResult } from "./StyleProcessor";

export { StructureProcessor, structureProcessor } from "./StructureProcessor";
