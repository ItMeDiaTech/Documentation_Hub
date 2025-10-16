/**
 * TypeScript type definitions for Office Open XML structures
 * Replaces 'any' types with proper type safety and guards
 *
 * Based on ECMA-376 Office Open XML File Formats specification
 * https://www.ecma-international.org/publications-and-standards/standards/ecma-376/
 */

/**
 * Attribute structure used in preserveOrder: true format
 */
export interface XmlAttributes {
  [key: string]: string | number | boolean;
}

/**
 * Base XML element in preserveOrder: true format
 */
export interface XmlElement {
  ':@'?: XmlAttributes;
  '#text'?: string;
  [key: string]: any; // For child elements
}

/**
 * Run Properties (w:rPr) - Character-level formatting
 * Used in w:r elements to format text
 */
export interface RunProperties {
  'w:rFonts'?: Array<{
    ':@'?: {
      '@_w:ascii'?: string;
      '@_w:hAnsi'?: string;
      '@_w:eastAsia'?: string;
      '@_w:cs'?: string;
    };
  }>;
  'w:sz'?: Array<{
    ':@'?: {
      '@_w:val'?: string; // Font size in half-points
    };
  }>;
  'w:szCs'?: Array<{
    ':@'?: {
      '@_w:val'?: string;
    };
  }>;
  'w:color'?: Array<{
    ':@'?: {
      '@_w:val'?: string; // Hex color (e.g., "FF0000")
    };
  }>;
  'w:b'?: Array<{}> | Array<{
    ':@'?: {
      '@_w:val'?: string; // "true" or "false"
    };
  }>;
  'w:i'?: Array<{}> | Array<{
    ':@'?: {
      '@_w:val'?: string;
    };
  }>;
  'w:u'?: Array<{
    ':@'?: {
      '@_w:val'?: string; // Underline style (e.g., "single")
    };
  }>;
  'w:rStyle'?: Array<{
    ':@'?: {
      '@_w:val'?: string; // Character style ID
    };
  }>;
}

/**
 * Paragraph Properties (w:pPr) - Paragraph-level formatting
 */
export interface ParagraphProperties {
  'w:pStyle'?: Array<{
    ':@'?: {
      '@_w:val'?: string; // Paragraph style ID (e.g., "Heading1", "Normal")
    };
  }>;
  'w:jc'?: Array<{
    ':@'?: {
      '@_w:val'?: string; // Alignment: "left", "center", "right", "both"
    };
  }>;
  'w:spacing'?: Array<{
    ':@'?: {
      '@_w:before'?: string; // Space before in twips
      '@_w:after'?: string;  // Space after in twips
      '@_w:line'?: string;   // Line spacing
      '@_w:lineRule'?: string; // "auto", "exact", "atLeast"
    };
  }>;
  'w:ind'?: Array<{
    ':@'?: {
      '@_w:left'?: string;    // Left indent in twips
      '@_w:right'?: string;   // Right indent in twips
      '@_w:hanging'?: string; // Hanging indent in twips
      '@_w:firstLine'?: string; // First line indent in twips
    };
  }>;
  'w:numPr'?: Array<{
    'w:ilvl'?: Array<{
      ':@'?: {
        '@_w:val'?: string; // List level (0-8)
      };
    }>;
    'w:numId'?: Array<{
      ':@'?: {
        '@_w:val'?: string; // Numbering instance ID
      };
    }>;
  }>;
}

/**
 * Table Cell Properties (w:tcPr)
 */
export interface TableCellProperties {
  'w:tcW'?: Array<{
    ':@'?: {
      '@_w:w'?: string;    // Width in twips
      '@_w:type'?: string; // "dxa", "pct", "auto"
    };
  }>;
  'w:shd'?: Array<{
    ':@'?: {
      '@_w:val'?: string;  // Shading pattern
      '@_w:color'?: string; // Foreground color
      '@_w:fill'?: string;  // Background color (hex)
    };
  }>;
  'w:tcMar'?: Array<{
    'w:top'?: Array<{
      ':@'?: {
        '@_w:w'?: string;
        '@_w:type'?: string;
      };
    }>;
    'w:left'?: Array<{
      ':@'?: {
        '@_w:w'?: string;
        '@_w:type'?: string;
      };
    }>;
    'w:bottom'?: Array<{
      ':@'?: {
        '@_w:w'?: string;
        '@_w:type'?: string;
      };
    }>;
    'w:right'?: Array<{
      ':@'?: {
        '@_w:w'?: string;
        '@_w:type'?: string;
      };
    }>;
  }>;
  'w:vAlign'?: Array<{
    ':@'?: {
      '@_w:val'?: string; // "top", "center", "bottom"
    };
  }>;
}

/**
 * Table Properties (w:tblPr)
 */
export interface TableProperties {
  'w:tblStyle'?: Array<{
    ':@'?: {
      '@_w:val'?: string; // Table style ID
    };
  }>;
  'w:tblW'?: Array<{
    ':@'?: {
      '@_w:w'?: string;
      '@_w:type'?: string;
    };
  }>;
  'w:tblBorders'?: Array<{
    'w:top'?: Array<{
      ':@'?: {
        '@_w:val'?: string;   // Border style
        '@_w:sz'?: string;    // Border width
        '@_w:space'?: string; // Border spacing
        '@_w:color'?: string; // Border color
      };
    }>;
    'w:left'?: Array<{
      ':@'?: {
        '@_w:val'?: string;
        '@_w:sz'?: string;
        '@_w:space'?: string;
        '@_w:color'?: string;
      };
    }>;
    'w:bottom'?: Array<{
      ':@'?: {
        '@_w:val'?: string;
        '@_w:sz'?: string;
        '@_w:space'?: string;
        '@_w:color'?: string;
      };
    }>;
    'w:right'?: Array<{
      ':@'?: {
        '@_w:val'?: string;
        '@_w:sz'?: string;
        '@_w:space'?: string;
        '@_w:color'?: string;
      };
    }>;
    'w:insideH'?: Array<{
      ':@'?: {
        '@_w:val'?: string;
        '@_w:sz'?: string;
        '@_w:space'?: string;
        '@_w:color'?: string;
      };
    }>;
    'w:insideV'?: Array<{
      ':@'?: {
        '@_w:val'?: string;
        '@_w:sz'?: string;
        '@_w:space'?: string;
        '@_w:color'?: string;
      };
    }>;
  }>;
}

/**
 * Style Definition
 */
export interface StyleDefinition {
  ':@'?: {
    '@_w:type'?: string;     // "paragraph", "character", "table", "numbering"
    '@_w:styleId'?: string;  // Style identifier
    '@_w:default'?: string;  // "1" or "0"
  };
  'w:name'?: Array<{
    ':@'?: {
      '@_w:val'?: string; // Display name
    };
  }>;
  'w:basedOn'?: Array<{
    ':@'?: {
      '@_w:val'?: string; // Parent style ID
    };
  }>;
  'w:next'?: Array<{
    ':@'?: {
      '@_w:val'?: string; // Next style ID
    };
  }>;
  'w:rPr'?: RunProperties[];
  'w:pPr'?: ParagraphProperties[];
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

/**
 * Type guard for Run Properties
 */
export function isRunProperties(obj: unknown): obj is RunProperties {
  if (typeof obj !== 'object' || obj === null) {
    return false;
  }

  // Check for at least one valid property
  const rPr = obj as Record<string, any>;
  return (
    'w:rFonts' in rPr ||
    'w:sz' in rPr ||
    'w:color' in rPr ||
    'w:b' in rPr ||
    'w:i' in rPr ||
    'w:u' in rPr ||
    'w:rStyle' in rPr
  );
}

/**
 * Type guard for Paragraph Properties
 */
export function isParagraphProperties(obj: unknown): obj is ParagraphProperties {
  if (typeof obj !== 'object' || obj === null) {
    return false;
  }

  const pPr = obj as Record<string, any>;
  return (
    'w:pStyle' in pPr ||
    'w:jc' in pPr ||
    'w:spacing' in pPr ||
    'w:ind' in pPr ||
    'w:numPr' in pPr
  );
}

/**
 * Type guard for Table Cell Properties
 */
export function isTableCellProperties(obj: unknown): obj is TableCellProperties {
  if (typeof obj !== 'object' || obj === null) {
    return false;
  }

  const tcPr = obj as Record<string, any>;
  return (
    'w:tcW' in tcPr ||
    'w:shd' in tcPr ||
    'w:tcMar' in tcPr ||
    'w:vAlign' in tcPr
  );
}

/**
 * Type guard for Table Properties
 */
export function isTableProperties(obj: unknown): obj is TableProperties {
  if (typeof obj !== 'object' || obj === null) {
    return false;
  }

  const tblPr = obj as Record<string, any>;
  return (
    'w:tblStyle' in tblPr ||
    'w:tblW' in tblPr ||
    'w:tblBorders' in tblPr
  );
}

/**
 * Type guard for Style Definition
 */
export function isStyleDefinition(obj: unknown): obj is StyleDefinition {
  if (typeof obj !== 'object' || obj === null) {
    return false;
  }

  const style = obj as Record<string, any>;
  return (
    ':@' in style &&
    typeof style[':@'] === 'object' &&
    style[':@'] !== null &&
    ('@_w:styleId' in style[':@'] || '@_w:type' in style[':@'])
  );
}

// ============================================================================
// SAFE ACCESSORS WITH TYPE GUARDS
// ============================================================================

/**
 * Safely get font size from run properties
 * Returns fontSize in points (not half-points)
 */
export function getFontSize(rPr: unknown): number | null {
  if (!isRunProperties(rPr)) {
    return null;
  }

  const szItem = rPr['w:sz'];
  if (!szItem || !Array.isArray(szItem) || szItem.length === 0) {
    return null;
  }

  const sz = szItem[0];
  const sizeVal = sz?.[':@']?.['@_w:val'];

  if (!sizeVal) {
    return null;
  }

  const halfPoints = parseInt(sizeVal, 10);
  if (isNaN(halfPoints)) {
    return null;
  }

  return halfPoints / 2; // Convert half-points to points
}

/**
 * Safely check if run properties have bold
 */
export function hasBold(rPr: unknown): boolean {
  if (!isRunProperties(rPr)) {
    return false;
  }

  return 'w:b' in rPr && Array.isArray(rPr['w:b']);
}

/**
 * Safely check if run properties have italic
 */
export function hasItalic(rPr: unknown): boolean {
  if (!isRunProperties(rPr)) {
    return false;
  }

  return 'w:i' in rPr && Array.isArray(rPr['w:i']);
}

/**
 * Safely get paragraph style ID
 */
export function getParagraphStyleId(pPr: unknown): string | null {
  if (!isParagraphProperties(pPr)) {
    return null;
  }

  const pStyle = pPr['w:pStyle'];
  if (!pStyle || !Array.isArray(pStyle) || pStyle.length === 0) {
    return null;
  }

  const styleId = pStyle[0]?.[':@']?.['@_w:val'];
  return typeof styleId === 'string' ? styleId : null;
}

/**
 * Safely get paragraph alignment
 */
export function getParagraphAlignment(pPr: unknown): string | null {
  if (!isParagraphProperties(pPr)) {
    return null;
  }

  const jc = pPr['w:jc'];
  if (!jc || !Array.isArray(jc) || jc.length === 0) {
    return null;
  }

  const alignment = jc[0]?.[':@']?.['@_w:val'];
  return typeof alignment === 'string' ? alignment : null;
}

/**
 * Safely get table cell shading color
 */
export function getCellShadingColor(tcPr: unknown): string | null {
  if (!isTableCellProperties(tcPr)) {
    return null;
  }

  const shd = tcPr['w:shd'];
  if (!shd || !Array.isArray(shd) || shd.length === 0) {
    return null;
  }

  const fill = shd[0]?.[':@']?.['@_w:fill'];
  return typeof fill === 'string' ? fill : null;
}

// ============================================================================
// EXAMPLE USAGE
// ============================================================================

/**
 * Example: Safe heading detection with type guards
 *
 * Before (unsafe):
 * ```typescript
 * const rPr: any = rPrItem['w:rPr'];
 * const fontSize = parseInt(rPr['w:sz'][0][':@']['@_w:val']) / 2;
 * const hasBold = rPr['w:b'] !== undefined;
 * ```
 *
 * After (type-safe):
 * ```typescript
 * const rPr: unknown = rPrItem['w:rPr'];
 * if (isRunProperties(rPr)) {
 *   const fontSize = getFontSize(rPr);
 *   const isBold = hasBold(rPr);
 *   if (fontSize && fontSize >= 18 && isBold) {
 *     // Detected Heading 1
 *   }
 * }
 * ```
 */
