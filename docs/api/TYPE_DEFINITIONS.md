# TypeScript Type Definitions Guide

Complete reference for all TypeScript types, interfaces, and enums used in the Documentation Hub's DOCX processing API.

## Table of Contents

- [Core Types](#core-types)
- [Result Types](#result-types)
- [Style Types](#style-types)
- [Document Structure Types](#document-structure-types)
- [Processing Options](#processing-options)
- [Error Types](#error-types)
- [Helper Types](#helper-types)

---

## Core Types

### ProcessorResult<T>

Generic result type for all processor operations. Provides consistent error handling across the API.

```typescript
interface ProcessorResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  warnings?: string[];
}
```

**Properties:**
- `success` (boolean) - Indicates if the operation succeeded
- `data` (T, optional) - Result data if successful
- `error` (string, optional) - Error message if failed
- `warnings` (string[], optional) - Warning messages

**Example:**
```typescript
const result: ProcessorResult<Document> = await processor.loadFromFile('file.docx');

if (result.success) {
  const doc = result.data; // TypeScript knows data exists
  // Work with document...
} else {
  console.error(result.error); // TypeScript knows error exists
}
```

---

### DocXMLaterOptions

Configuration options for the DocXMLaterProcessor.

```typescript
interface DocXMLaterOptions {
  preserveFormatting?: boolean;
  validateOutput?: boolean;
}
```

**Properties:**
- `preserveFormatting` (boolean, optional, default: true) - Preserve existing formatting when applying styles
- `validateOutput` (boolean, optional, default: false) - Validate document structure before saving

**Example:**
```typescript
const processor = new DocXMLaterProcessor({
  preserveFormatting: true,
  validateOutput: false
});
```

---

## Result Types

### DocumentReadResult

Result type for document reading operations.

```typescript
interface DocumentReadResult extends ProcessorResult {
  data?: DocxDocument;
}
```

**Extends:** `ProcessorResult`

**Example:**
```typescript
const result: DocumentReadResult = await processor.readDocument('file.docx');

if (result.success && result.data) {
  console.log(`Paragraphs: ${result.data.content.paragraphs.length}`);
  console.log(`Tables: ${result.data.content.tables?.length || 0}`);
}
```

---

### DocumentModifyResult

Result type for document modification operations.

```typescript
interface DocumentModifyResult extends ProcessorResult {
  data?: Buffer;
}
```

**Extends:** `ProcessorResult`

**Properties:**
- `data` (Buffer, optional) - Modified DOCX file as buffer

**Example:**
```typescript
const result: DocumentModifyResult = await processor.toBuffer(doc);

if (result.success && result.data) {
  // result.data is a Buffer containing the DOCX file
  await fs.writeFile('output.docx', result.data);
}
```

---

### StyleApplicationResult

Result type for style application operations.

```typescript
interface StyleApplicationResult {
  appliedCount: number;
  skippedCount: number;
  paragraphsModified: number[];
  totalParagraphs: number;
}
```

**Properties:**
- `appliedCount` (number) - Number of paragraphs where style was applied
- `skippedCount` (number) - Number of paragraphs that didn't match criteria
- `paragraphsModified` (number[]) - Array of modified paragraph indices
- `totalParagraphs` (number) - Total number of paragraphs in document

**Example:**
```typescript
const result: ProcessorResult<StyleApplicationResult> = await processor.applyStyleToParagraphs(
  doc,
  'Heading1',
  { target: 'all' }
);

if (result.success && result.data) {
  console.log(`Applied to ${result.data.appliedCount} of ${result.data.totalParagraphs} paragraphs`);
  console.log(`Modified paragraphs:`, result.data.paragraphsModified);
}
```

---

## Style Types

### TextStyle

Text formatting properties for runs and paragraphs.

```typescript
interface TextStyle {
  fontFamily?: string;
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  preserveBold?: boolean;
  preserveItalic?: boolean;
  preserveUnderline?: boolean;
  color?: string;
  highlight?: string;
}
```

**Properties:**
- `fontFamily` (string, optional) - Font name (e.g., "Arial", "Times New Roman")
- `fontSize` (number, optional) - Font size in points
- `bold` (boolean, optional) - Bold formatting
- `italic` (boolean, optional) - Italic formatting
- `underline` (boolean, optional) - Underline formatting
- `preserveBold` (boolean, optional) - Preserve existing bold (ignore bold property)
- `preserveItalic` (boolean, optional) - Preserve existing italic
- `preserveUnderline` (boolean, optional) - Preserve existing underline
- `color` (string, optional) - Text color in hex format (with or without #)
- `highlight` (string, optional) - Highlight color name

**Example:**
```typescript
const textStyle: TextStyle = {
  fontFamily: 'Arial',
  fontSize: 12,
  bold: true,
  color: '#FF0000', // Red text
  highlight: 'yellow'
};

await processor.createParagraph(doc, 'Important Text', textStyle);
```

---

### ParagraphStyle

Paragraph formatting properties for alignment, spacing, and indentation.

```typescript
interface ParagraphStyle {
  alignment?: 'left' | 'center' | 'right' | 'justify';
  indentLeft?: number;
  indentRight?: number;
  indentFirstLine?: number;
  spaceBefore?: number;
  spaceAfter?: number;
  lineSpacing?: number;
  keepNext?: boolean;
  keepLines?: boolean;
}
```

**Properties:**
- `alignment` ('left'|'center'|'right'|'justify', optional) - Text alignment
- `indentLeft` (number, optional) - Left indentation in twips
- `indentRight` (number, optional) - Right indentation in twips
- `indentFirstLine` (number, optional) - First line indentation in twips
- `spaceBefore` (number, optional) - Space before paragraph in twips
- `spaceAfter` (number, optional) - Space after paragraph in twips
- `lineSpacing` (number, optional) - Line spacing in twips
- `keepNext` (boolean, optional) - Keep with next paragraph
- `keepLines` (boolean, optional) - Keep lines together

**Note:** 1 inch = 1440 twips, 1 point = 20 twips

**Example:**
```typescript
const processor = new DocXMLaterProcessor();

const paragraphStyle: ParagraphStyle = {
  alignment: 'justify',
  indentLeft: processor.inchesToTwips(0.5),    // 0.5 inch = 720 twips
  indentFirstLine: processor.inchesToTwips(0.25), // 0.25 inch = 360 twips
  spaceBefore: processor.pointsToTwips(12),    // 12 points = 240 twips
  spaceAfter: processor.pointsToTwips(6),      // 6 points = 120 twips
  keepNext: true
};

await processor.createParagraph(doc, 'Formatted paragraph', paragraphStyle);
```

---

### StyleApplication

Targeting criteria for applying styles to paragraphs.

```typescript
interface StyleApplication {
  target: 'all' | 'pattern' | 'indices';
  styleId: string;
  pattern?: string | RegExp;
  indices?: number[];
}
```

**Properties:**
- `target` ('all'|'pattern'|'indices') - Target mode selector
  - `'all'` - Apply to all paragraphs
  - `'pattern'` - Apply to paragraphs matching pattern
  - `'indices'` - Apply to specific paragraph indices
- `styleId` (string) - ID of the style to apply
- `pattern` (string | RegExp, optional) - Pattern to match (required if target='pattern')
- `indices` (number[], optional) - Paragraph indices (required if target='indices')

**Examples:**
```typescript
// Apply to all paragraphs
const applyAll: StyleApplication = {
  target: 'all',
  styleId: 'Normal'
};

// Apply to paragraphs containing specific text
const applyPattern: StyleApplication = {
  target: 'pattern',
  styleId: 'Heading1',
  pattern: /^Chapter \d+/i
};

// Apply to specific paragraph indices
const applyIndices: StyleApplication = {
  target: 'indices',
  styleId: 'Title',
  indices: [0, 5, 10]
};

const result = await processor.applyStyleToParagraphs(doc, 'Heading1', applyPattern);
```

---

### NumberingStyle

Numbering/list formatting properties.

```typescript
interface NumberingStyle {
  level: number;
  format: 'bullet' | 'decimal' | 'lowerLetter' | 'upperLetter' | 'lowerRoman' | 'upperRoman';
  text?: string;
  alignment?: 'left' | 'center' | 'right';
  indentLeft?: number;
  indentHanging?: number;
}
```

**Properties:**
- `level` (number) - List level (0-8, total 9 levels)
- `format` (string) - Numbering format type
- `text` (string, optional) - For bullets, the character to use
- `alignment` ('left'|'center'|'right', optional) - Number alignment
- `indentLeft` (number, optional) - Left indentation in twips
- `indentHanging` (number, optional) - Hanging indentation in twips

---

## Document Structure Types

### DocxDocument

Complete document structure with all components.

```typescript
interface DocxDocument {
  styles: DocxStyles;
  numbering: DocxNumbering;
  fonts: DocxFonts;
  content: DocxContent;
}
```

**Properties:**
- `styles` (DocxStyles) - Document styles
- `numbering` (DocxNumbering) - Numbering definitions
- `fonts` (DocxFonts) - Font definitions
- `content` (DocxContent) - Document content (paragraphs, tables)

**Example:**
```typescript
const result: DocumentReadResult = await processor.readDocument('file.docx');

if (result.success && result.data) {
  const doc: DocxDocument = result.data;

  // Access paragraphs
  doc.content.paragraphs.forEach((para, index) => {
    console.log(`Paragraph ${index}: ${para.text}`);
  });

  // Access tables
  doc.content.tables?.forEach((table, index) => {
    console.log(`Table ${index}: ${table.rows.length} rows`);
  });
}
```

---

### Paragraph

Paragraph structure with text and formatting.

```typescript
interface Paragraph {
  text: string;
  style?: string;
  numbering?: {
    id: string;
    level: number;
  };
  runs?: Run[];
}
```

**Properties:**
- `text` (string) - Combined text from all runs
- `style` (string, optional) - Style name applied to paragraph
- `numbering` (object, optional) - Numbering/list information
- `runs` (Run[], optional) - Individual text runs with formatting

---

### Run

Text run with specific formatting.

```typescript
interface Run {
  text: string;
  style?: TextStyle;
}
```

**Properties:**
- `text` (string) - Text content
- `style` (TextStyle, optional) - Text formatting

---

### Table

Table structure with rows and cells.

```typescript
interface Table {
  rows: TableRow[];
  style?: string;
}
```

**Properties:**
- `rows` (TableRow[]) - Array of table rows
- `style` (string, optional) - Table style name

---

### TableRow

Table row containing cells.

```typescript
interface TableRow {
  cells: TableCell[];
}
```

**Properties:**
- `cells` (TableCell[]) - Array of cells in the row

---

### TableCell

Table cell with content and formatting.

```typescript
interface TableCell {
  text: string;
  colspan: number;
  rowspan: number;
  paragraphs: Paragraph[];
  style?: any;
}
```

**Properties:**
- `text` (string) - Combined text from all paragraphs
- `colspan` (number) - Column span (1 = no merge, >1 = merged cells)
- `rowspan` (number) - Row span (1 = no merge, >1 = merged cells)
- `paragraphs` (Paragraph[]) - Detailed paragraph structure within cell
- `style` (any, optional) - Cell style (deprecated, kept for compatibility)

**Example:**
```typescript
const result = await processor.readDocument('file.docx');

if (result.success && result.data) {
  result.data.content.tables?.forEach((table) => {
    table.rows.forEach((row, rowIndex) => {
      row.cells.forEach((cell, cellIndex) => {
        console.log(`Cell [${rowIndex}][${cellIndex}]: ${cell.text}`);
        console.log(`  Colspan: ${cell.colspan}, Rowspan: ${cell.rowspan}`);

        // Access cell paragraphs
        cell.paragraphs.forEach((para, paraIndex) => {
          console.log(`  Paragraph ${paraIndex}: ${para.text}`);
        });
      });
    });
  });
}
```

---

## Processing Options

### DocumentReadOptions

Options for reading document structure.

```typescript
interface DocumentReadOptions {
  parseStyles?: boolean;
  parseNumbering?: boolean;
  parseFonts?: boolean;
  parseContent?: boolean;
}
```

**Properties:**
- `parseStyles` (boolean, optional) - Parse style definitions
- `parseNumbering` (boolean, optional) - Parse numbering definitions
- `parseFonts` (boolean, optional) - Parse font definitions
- `parseContent` (boolean, optional) - Parse document content

---

### DocumentModifyOptions

Options for modifying documents.

```typescript
interface DocumentModifyOptions {
  operation: DocumentOperation;
  preserveFormatting?: boolean;
  updateStyles?: boolean;
  updateNumbering?: boolean;
}
```

**Properties:**
- `operation` (DocumentOperation) - Type of operation
- `preserveFormatting` (boolean, optional) - Preserve existing formatting
- `updateStyles` (boolean, optional) - Update style definitions
- `updateNumbering` (boolean, optional) - Update numbering definitions

---

### DocumentOperation

Enum for document operation types.

```typescript
enum DocumentOperation {
  CREATE = 'create',
  READ = 'read',
  MODIFY = 'modify',
  MODIFY_TEMPLATE = 'modify_template',
  MODIFY_XML = 'modify_xml',
}
```

**Values:**
- `CREATE` - Create new document
- `READ` - Read existing document
- `MODIFY` - Modify existing document
- `MODIFY_TEMPLATE` - Modify document template
- `MODIFY_XML` - Modify document XML

---

## Error Types

### DocxProcessingError

Custom error class for DOCX processing errors.

```typescript
class DocxProcessingError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: any
  ) {
    super(message);
    this.name = 'DocxProcessingError';
  }
}
```

**Properties:**
- `message` (string) - Error message
- `code` (string) - Error code from ErrorCode enum
- `details` (any, optional) - Additional error details

**Example:**
```typescript
try {
  // DOCX processing...
} catch (error) {
  if (error instanceof DocxProcessingError) {
    console.error(`Error ${error.code}: ${error.message}`);
    console.error('Details:', error.details);
  }
}
```

---

### ErrorCode

Enum for standardized error codes.

```typescript
enum ErrorCode {
  INVALID_DOCX = 'INVALID_DOCX',
  FILE_NOT_FOUND = 'FILE_NOT_FOUND',
  PARSE_ERROR = 'PARSE_ERROR',
  XML_ERROR = 'XML_ERROR',
  STYLE_NOT_FOUND = 'STYLE_NOT_FOUND',
  NUMBERING_NOT_FOUND = 'NUMBERING_NOT_FOUND',
  UNSUPPORTED_OPERATION = 'UNSUPPORTED_OPERATION',
}
```

**Values:**
- `INVALID_DOCX` - Invalid or corrupted DOCX file
- `FILE_NOT_FOUND` - File does not exist
- `PARSE_ERROR` - Failed to parse document
- `XML_ERROR` - XML parsing or generation error
- `STYLE_NOT_FOUND` - Referenced style not found
- `NUMBERING_NOT_FOUND` - Referenced numbering not found
- `UNSUPPORTED_OPERATION` - Operation not supported

---

## Helper Types

### HyperlinkInfo

Information about a hyperlink extracted from a document.

```typescript
interface HyperlinkInfo {
  hyperlink: Hyperlink;
  paragraph: Paragraph;
  paragraphIndex: number;
  url?: string;
  text: string;
}
```

**Properties:**
- `hyperlink` (Hyperlink) - Hyperlink object instance
- `paragraph` (Paragraph) - Parent paragraph containing the hyperlink
- `paragraphIndex` (number) - Index of the paragraph in document
- `url` (string, optional) - Hyperlink URL
- `text` (string) - Display text (automatically sanitized)

**Example:**
```typescript
const hyperlinks: HyperlinkInfo[] = await processor.extractHyperlinks(doc);

hyperlinks.forEach((link) => {
  console.log(`Text: ${link.text}`);
  console.log(`URL: ${link.url}`);
  console.log(`Paragraph: ${link.paragraphIndex}`);
});
```

---

### SearchResult

Result from text search operations.

```typescript
interface SearchResult {
  text: string;
  paragraphIndex: number;
  runIndex: number;
}
```

**Properties:**
- `text` (string) - Matched text
- `paragraphIndex` (number) - Index of paragraph containing match
- `runIndex` (number) - Index of run within paragraph

**Example:**
```typescript
const results: SearchResult[] = await processor.findText(doc, 'important', {
  caseSensitive: false
});

results.forEach((result) => {
  console.log(`Found "${result.text}" in paragraph ${result.paragraphIndex}`);
});
```

---

### SizeEstimate

Document size estimation result.

```typescript
interface SizeEstimate {
  totalEstimatedMB: number;
  warning?: string;
}
```

**Properties:**
- `totalEstimatedMB` (number) - Estimated size in megabytes
- `warning` (string, optional) - Warning if size exceeds thresholds

---

### SizeStats

Detailed document statistics.

```typescript
interface SizeStats {
  elements: {
    paragraphs: number;
    tables: number;
    images: number;
    hyperlinks: number;
  };
  size: {
    totalEstimatedMB: number;
  };
  warnings?: string[];
}
```

**Properties:**
- `elements` (object) - Element counts
  - `paragraphs` (number) - Number of paragraphs
  - `tables` (number) - Number of tables
  - `images` (number) - Number of images
  - `hyperlinks` (number) - Number of hyperlinks
- `size` (object) - Size information
  - `totalEstimatedMB` (number) - Estimated size in megabytes
- `warnings` (string[], optional) - Array of warning messages

**Example:**
```typescript
const stats: SizeStats = await processor.getSizeStats(doc);

console.log('Document Statistics:');
console.log(`- Paragraphs: ${stats.elements.paragraphs}`);
console.log(`- Tables: ${stats.elements.tables}`);
console.log(`- Images: ${stats.elements.images}`);
console.log(`- Hyperlinks: ${stats.elements.hyperlinks}`);
console.log(`- Size: ${stats.size.totalEstimatedMB.toFixed(2)} MB`);

if (stats.warnings) {
  stats.warnings.forEach((warning) => console.warn(warning));
}
```

---

## Type Guards

### Type guard examples for safe type checking

```typescript
// Check if result succeeded
function isSuccess<T>(result: ProcessorResult<T>): result is ProcessorResult<T> & { success: true; data: T } {
  return result.success === true && result.data !== undefined;
}

// Usage
const result = await processor.loadFromFile('file.docx');
if (isSuccess(result)) {
  const doc = result.data; // TypeScript knows data exists
  // Work with document...
}
```

---

## Unit Conversion Constants

```typescript
// Constants used for unit conversion
const TWIPS_PER_INCH = 1440;
const TWIPS_PER_POINT = 20;
const POINTS_PER_INCH = 72;

// Helper functions
function inchesToTwips(inches: number): number {
  return inches * TWIPS_PER_INCH;
}

function pointsToTwips(points: number): number {
  return points * TWIPS_PER_POINT;
}

function twipsToPoints(twips: number): number {
  return twips / TWIPS_PER_POINT;
}

function twipsToInches(twips: number): number {
  return twips / TWIPS_PER_INCH;
}
```

---

## Best Practices

### 1. Always check result success

```typescript
const result = await processor.loadFromFile('file.docx');
if (!result.success) {
  console.error('Error:', result.error);
  return;
}
const doc = result.data;
```

### 2. Use type guards for better type safety

```typescript
function processDocument(result: ProcessorResult<Document>): void {
  if (result.success && result.data) {
    // TypeScript knows result.data exists
    const doc = result.data;
    // Work with document...
  }
}
```

### 3. Combine styles for flexibility

```typescript
const combinedStyle: TextStyle & ParagraphStyle = {
  // Text formatting
  fontFamily: 'Arial',
  fontSize: 12,
  bold: true,
  color: '#0066CC',

  // Paragraph formatting
  alignment: 'left',
  indentLeft: processor.inchesToTwips(0.5),
  spaceBefore: processor.pointsToTwips(12)
};

await processor.createParagraph(doc, 'Formatted text', combinedStyle);
```

### 4. Use utility functions for units

```typescript
const processor = new DocXMLaterProcessor();

// Convert measurements
const halfInch = processor.inchesToTwips(0.5);
const twelvePoints = processor.pointsToTwips(12);

// Use in formatting
await processor.createParagraph(doc, 'Text', {
  indentLeft: halfInch,
  spaceBefore: twelvePoints
});
```

---

**Last Updated:** 2025-11-13
**Version:** 1.0.40
**Documentation Hub** | [GitHub](https://github.com/ItMeDiaTech/Documentation_Hub)
