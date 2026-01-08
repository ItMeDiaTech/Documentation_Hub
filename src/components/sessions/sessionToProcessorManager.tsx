/**
 * Session to Processor Mapper
 *
 * Provides type-safe conversion between Session (UI format) and WordProcessingOptions (Processor format)
 * Prevents style transposition by ensuring all properties are correctly mapped and validated
 */

import type { WordProcessingOptions } from '../../services/document/WordDocumentProcessor';
import type { Session, SessionStyle, TableShadingSettings } from '../../types/session';

/**
 * Normalize color from UI format (#RRGGBB) to OOXML format (RRGGBB)
 *
 * @param color - Color in hex format (with or without # prefix)
 * @returns Color in OOXML format (6 hex digits, uppercase, no # prefix)
 */
function normalizeColor(color: string): string {
  return color.replace('#', '').toUpperCase();
}

/**
 * Validates that a color is in correct format (6 hex digits without # prefix)
 *
 * @param color - Color to validate
 * @returns True if valid OOXML color format
 */
function isValidOOXMLColor(color: string): boolean {
  return /^[0-9A-Fa-f]{6}$/.test(color);
}

/**
 * Maps SessionStyle[] (UI format) to WordProcessingOptions.styles (Processor format)
 *
 * CRITICAL: Preserves ALL properties to prevent transposition
 * - Includes preserve* flags for conditional formatting
 * - Includes noSpaceBetweenSame for contextual spacing
 * - Includes indentation for list paragraph positioning
 * - Auto-normalizes colors from #RRGGBB to RRGGBB
 *
 * @param sessionStyles - Array of SessionStyle objects from UI
 * @returns Array of style objects compatible with WordProcessingOptions
 */
export function mapSessionStylesToProcessor(
  sessionStyles: SessionStyle[]
): NonNullable<WordProcessingOptions['styles']> {
  return sessionStyles.map((style) => ({
    // Identity
    id: style.id,
    name: style.name,

    // Font properties
    fontFamily: style.fontFamily,
    fontSize: style.fontSize,

    // Format properties
    bold: style.bold,
    italic: style.italic,
    underline: style.underline,

    // Preserve flags - CRITICAL for preventing transposition
    preserveBold: style.preserveBold,
    preserveItalic: style.preserveItalic,
    preserveUnderline: style.preserveUnderline,

    // Paragraph properties
    alignment: style.alignment,
    spaceBefore: style.spaceBefore,
    spaceAfter: style.spaceAfter,
    lineSpacing: style.lineSpacing,

    // Advanced properties
    color: normalizeColor(style.color), // Auto-normalize: #000000 → 000000
    noSpaceBetweenSame: style.noSpaceBetweenSame,
    indentation: style.indentation,
  }));
}

/**
 * Maps TableShadingSettings (UI format) to WordProcessingOptions.tableShadingSettings
 *
 * @param settings - Table shading settings from session
 * @returns Normalized table shading settings for processor
 */
function mapTableShadingSettings(
  settings: TableShadingSettings | undefined
): WordProcessingOptions['tableShadingSettings'] {
  if (!settings) return undefined;

  return {
    header2Shading: normalizeColor(settings.header2Shading),
    otherShading: normalizeColor(settings.otherShading),
    imageBorderWidth: settings.imageBorderWidth ?? 1.0,
  };
}

/**
 * Maps Session.processingOptions.enabledOperations to WordProcessingOptions boolean flags
 *
 * This function provides the bridge between UI checkbox state and processor method execution:
 * - UI stores array of enabled option IDs (e.g., ['remove-italics', 'smart-tables'])
 * - Processor expects individual boolean flags and nested operations object
 *
 * @param enabledOperations - Array of enabled option IDs
 * @returns Partial WordProcessingOptions with appropriate flags set
 */
function mapEnabledOperationsToFlags(enabledOperations: string[]): Partial<WordProcessingOptions> {
  const enabled = new Set(enabledOperations);
  const flags: Partial<WordProcessingOptions> = {};

  // ═══════════════════════════════════════════════════════════
  // Text Formatting Group
  // ═══════════════════════════════════════════════════════════
  if (enabled.has('remove-italics')) flags.removeItalics = true;
  if (enabled.has('remove-whitespace')) flags.removeWhitespace = true;

  // ═══════════════════════════════════════════════════════════
  // Content Structure Group
  // ═══════════════════════════════════════════════════════════
  if (enabled.has('remove-paragraph-lines')) flags.removeParagraphLines = true;
  if (enabled.has('preserve-user-blank-structures')) flags.preserveUserBlankStructures = true;
  if (enabled.has('remove-headers-footers')) flags.removeHeadersFooters = true;
  if (enabled.has('add-document-warning')) flags.addDocumentWarning = true;
  if (enabled.has('center-border-images')) flags.centerAndBorderImages = true;

  // ═══════════════════════════════════════════════════════════
  // Lists & Tables Group
  // ═══════════════════════════════════════════════════════════
  if (enabled.has('list-indentation')) {
    // Special case: list-indentation sets listBulletSettings.enabled
    // CRITICAL FIX: Do NOT create the object here - just set the enabled flag
    // The actual indentationLevels will be populated from session.listBulletSettings
    // to preserve UI-configured indentation values
    if (!flags.listBulletSettings) {
      flags.listBulletSettings = { enabled: true } as any;
    } else {
      flags.listBulletSettings.enabled = true;
    }
  }
  if (enabled.has('bullet-uniformity')) flags.bulletUniformity = true;
  if (enabled.has('smart-tables')) {
    flags.smartTables = true;
    flags.tableUniformity = true; // Auto-enable table uniformity with smart tables
  }

  // ═══════════════════════════════════════════════════════════
  // Hyperlink Operations (nested under operations object)
  // NOTE: operations property comes from HyperlinkProcessingOptions parent interface
  // Using type assertion to work with inherited property
  // ═══════════════════════════════════════════════════════════
  const operations: any = {};
  if (enabled.has('update-top-hyperlinks')) operations.updateTopHyperlinks = true;
  if (enabled.has('update-toc-hyperlinks')) operations.updateTocHyperlinks = true;
  if (enabled.has('force-remove-heading1-toc')) operations.forceRemoveHeading1FromTOC = true;
  if (enabled.has('fix-internal-hyperlinks')) operations.fixInternalHyperlinks = true;
  if (enabled.has('fix-content-ids')) operations.fixContentIds = true;
  if (enabled.has('replace-outdated-titles')) operations.replaceOutdatedTitles = true;
  if (enabled.has('validate-document-styles')) operations.validateDocumentStyles = true;
  if (enabled.has('validate-header2-tables')) operations.validateHeader2Tables = true;

  // Assign operations object using type assertion
  (flags as any).operations = operations;

  return flags;
}

/**
 * MAIN CONVERTER: Session → WordProcessingOptions
 *
 * Converts complete Session object to WordProcessingOptions for document processing
 * - Type-safe conversion with zero data loss
 * - Auto-normalizes colors (#RRGGBB → RRGGBB)
 * - Maps UI option IDs to processor boolean flags
 * - Preserves all style properties including preserve* flags
 *
 * @param session - Complete Session object from SessionContext
 * @returns WordProcessingOptions ready for WordDocumentProcessor.processDocument()
 */
export function sessionToProcessorOptions(session: Session): WordProcessingOptions {
  // Base options
  const options: WordProcessingOptions = {
    createBackup: session.processingOptions?.createBackup ?? true,
    validateBeforeProcessing: session.processingOptions?.validateUrls ?? true,
    // Enable change tracking for Document Changes UI - tracks hyperlink and other modifications
    trackChanges: true,
  };

  // Map enabled operations to boolean flags
  const enabledOps = session.processingOptions?.enabledOperations || [];
  Object.assign(options, mapEnabledOperationsToFlags(enabledOps));

  // Map styles with ALL properties (prevents transposition)
  if (session.styles && session.styles.length > 0) {
    options.styles = mapSessionStylesToProcessor(session.styles);
    options.assignStyles = true;
  }

  // Map list settings (direct copy - interfaces are compatible)
  if (session.listBulletSettings?.enabled) {
    options.listBulletSettings = {
      enabled: true,
      indentationLevels: session.listBulletSettings.indentationLevels,
      spacingBetweenItems: 0, // Use List Paragraph style's spaceAfter instead
    };
  }

  // Map table shading with color normalization
  options.tableShadingSettings = mapTableShadingSettings(session.tableShadingSettings);

  // Enable auto-operations based on configuration
  if (options.smartTables) {
    options.tableUniformity = true;
  }

  // Set preservation flags for blank lines
  if (enabledOps.includes('validate-header2-tables')) {
    options.preserveBlankLinesAfterHeader2Tables = true;
  }

  return options;
}

/**
 * Validates WordProcessingOptions before processing
 *
 * Catches configuration errors that would cause document corruption:
 * - Invalid color formats (must be 6 hex digits without #)
 * - Invalid font sizes (range: 1-1638 pt)
 * - Invalid spacing values (must be non-negative)
 * - Missing required properties
 *
 * @param options - WordProcessingOptions to validate
 * @returns Validation result with specific error messages
 */
export function validateProcessingOptions(options: WordProcessingOptions): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  // Validate styles if present
  if (options.styles) {
    for (const style of options.styles) {
      // Required fields
      if (!style.id || !style.name) {
        errors.push(`Style missing required fields: id="${style.id}", name="${style.name}"`);
      }

      // Color format: must be 6 hex digits WITHOUT # prefix at this point
      if (style.color && !isValidOOXMLColor(style.color)) {
        errors.push(
          `Invalid color for style "${style.id}": "${style.color}" ` +
            `(expected 6 hex digits without # prefix, e.g., "000000")`
        );
      }

      // Font size range (Word maximum is 1638 pt)
      if (style.fontSize <= 0 || style.fontSize > 1638) {
        errors.push(
          `Invalid fontSize for style "${style.id}": ${style.fontSize} ` + `(valid range: 1-1638)`
        );
      }

      // Spacing must be non-negative
      if (style.spaceBefore < 0) {
        errors.push(
          `Invalid spaceBefore for style "${style.id}": ${style.spaceBefore} (must be >= 0)`
        );
      }
      if (style.spaceAfter < 0) {
        errors.push(
          `Invalid spaceAfter for style "${style.id}": ${style.spaceAfter} (must be >= 0)`
        );
      }

      // Line spacing multiplier (typical: 1.0, 1.15, 1.5, 2.0)
      if (style.lineSpacing <= 0 || style.lineSpacing > 10) {
        errors.push(
          `Invalid lineSpacing for style "${style.id}": ${style.lineSpacing} ` +
            `(valid range: 0.1-10)`
        );
      }

      // Indentation validation (if present)
      if (style.indentation) {
        if (
          style.indentation.left !== undefined &&
          (style.indentation.left < 0 || style.indentation.left > 10)
        ) {
          errors.push(
            `Invalid indentation.left for style "${style.id}": ${style.indentation.left} ` +
              `(valid range: 0-10 inches)`
          );
        }
        if (
          style.indentation.firstLine !== undefined &&
          (style.indentation.firstLine < 0 || style.indentation.firstLine > 10)
        ) {
          errors.push(
            `Invalid indentation.firstLine for style "${style.id}": ${style.indentation.firstLine} ` +
              `(valid range: 0-10 inches)`
          );
        }
      }
    }
  }

  // Validate table shading colors
  if (options.tableShadingSettings) {
    const { header2Shading, otherShading } = options.tableShadingSettings;

    if (header2Shading && !isValidOOXMLColor(header2Shading)) {
      errors.push(
        `Invalid header2Shading color: "${header2Shading}" ` +
          `(expected 6 hex digits without # prefix, e.g., "BFBFBF")`
      );
    }

    if (otherShading && !isValidOOXMLColor(otherShading)) {
      errors.push(
        `Invalid otherShading color: "${otherShading}" ` +
          `(expected 6 hex digits without # prefix, e.g., "DFDFDF")`
      );
    }
  }

  // Validate list settings if enabled
  if (options.listBulletSettings?.enabled) {
    if (
      !options.listBulletSettings.indentationLevels ||
      options.listBulletSettings.indentationLevels.length === 0
    ) {
      errors.push('List settings enabled but indentationLevels array is empty or undefined');
    } else {
      // Validate each indentation level
      for (const level of options.listBulletSettings.indentationLevels) {
        if (level.symbolIndent < 0 || level.symbolIndent > 10) {
          errors.push(
            `Invalid symbolIndent at level ${level.level}: ${level.symbolIndent} inches ` +
              `(valid range: 0-10)`
          );
        }
        if (level.textIndent < 0 || level.textIndent > 10) {
          errors.push(
            `Invalid textIndent at level ${level.level}: ${level.textIndent} inches ` +
              `(valid range: 0-10)`
          );
        }
        if (level.textIndent <= level.symbolIndent) {
          errors.push(
            `Invalid indentation at level ${level.level}: textIndent (${level.textIndent}) ` +
              `must be greater than symbolIndent (${level.symbolIndent})`
          );
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Quick validation check - returns true if options are valid
 *
 * @param options - WordProcessingOptions to check
 * @returns True if valid, false otherwise
 */
export function isValid(options: WordProcessingOptions): boolean {
  return validateProcessingOptions(options).valid;
}

/**
 * Development helper: Logs validation errors to console
 *
 * @param options - WordProcessingOptions to validate
 * @returns True if valid, false with console errors if invalid
 */
export function validateAndLog(options: WordProcessingOptions): boolean {
  const result = validateProcessingOptions(options);

  if (!result.valid) {
    console.error('❌ WordProcessingOptions validation failed:');
    result.errors.forEach((error, index) => {
      console.error(`  ${index + 1}. ${error}`);
    });
  } else {
    console.log('✅ WordProcessingOptions validation passed');
  }

  return result.valid;
}

/**
 * Helper: Get user-friendly description of which operations are enabled
 * Useful for logging and debugging
 *
 * @param session - Session to describe
 * @returns Human-readable string of enabled operations
 */
export function describeEnabledOperations(session: Session): string {
  const enabledOps = session.processingOptions?.enabledOperations || [];

  if (enabledOps.length === 0) {
    return 'No operations enabled';
  }

  const opNames = enabledOps.map((op) => {
    // Convert kebab-case to Title Case
    return op
      .split('-')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  });

  return `${enabledOps.length} operations: ${opNames.slice(0, 5).join(', ')}${
    enabledOps.length > 5 ? '...' : ''
  }`;
}
