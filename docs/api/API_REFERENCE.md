# DocXMLaterProcessor API Reference

Complete reference for all public methods in the Documentation Hub's DOCX processing API.

## Table of Contents

- [Overview](#overview)
- [Document I/O Operations](#document-io-operations)
- [Style Operations](#style-operations)
- [Table Operations](#table-operations)
- [Paragraph Formatting](#paragraph-formatting)
- [High-Level Operations](#high-level-operations)
- [Hyperlink Operations](#hyperlink-operations)
- [Search & Replace](#search--replace)
- [Document Statistics](#document-statistics)
- [Utility Methods](#utility-methods)
- [Quick Reference Table](#quick-reference-table)

## Overview

The `DocXMLaterProcessor` class provides a comprehensive API for manipulating Microsoft Word (.docx) documents. It wraps the docxmlater library with enterprise-grade features including:

- **Type Safety**: Full TypeScript definitions
- **Error Handling**: Comprehensive error results
- **Memory Management**: Automatic resource cleanup
- **Performance**: Batch operations (30-50% faster for hyperlinks)
- **Data Integrity**: Defensive text sanitization

## Document I/O Operations

### loadFromFile(filePath: string)

Load a DOCX document from a file path.

**Parameters:**
- `filePath` (string) - Absolute or relative path to the DOCX file

**Returns:** `Promise<ProcessorResult<Document>>`

**Example:**
```typescript
const processor = new DocXMLaterProcessor();
const result = await processor.loadFromFile('./documents/report.docx');

if (result.success) {
  const doc = result.data;
  // Work with document...
  doc.dispose();
}
```

---

### loadFromBuffer(buffer: Buffer)

Load a DOCX document from a Buffer object.

**Parameters:**
- `buffer` (Buffer) - Buffer containing the DOCX file data

**Returns:** `Promise<ProcessorResult<Document>>`

**Example:**
```typescript
const response = await fetch('https://example.com/document.docx');
const arrayBuffer = await response.arrayBuffer();
const buffer = Buffer.from(arrayBuffer);

const result = await processor.loadFromBuffer(buffer);
```

---

### saveToFile(doc: Document, filePath: string)

Save a Document to a file path with atomic operations.

**Parameters:**
- `doc` (Document) - Document instance to save
- `filePath` (string) - Path where the DOCX file will be saved

**Returns:** `Promise<ProcessorResult<void>>`

**Example:**
```typescript
const doc = await processor.loadFromFile('input.docx');
// Make modifications...
await processor.saveToFile(doc.data, 'output.docx');
doc.data.dispose();
```

---

### toBuffer(doc: Document)

Convert a Document to a Buffer object for in-memory operations or HTTP transmission.

**Parameters:**
- `doc` (Document) - Document instance to convert

**Returns:** `Promise<DocumentModifyResult>`

**Example:**
```typescript
const result = await processor.toBuffer(doc);
if (result.success) {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.send(result.data);
}
```

---

## Style Operations

### createDocumentWithStyle(styleId: string, styleName: string, properties: TextStyle & ParagraphStyle)

Create a new blank document with a custom paragraph style.

**Parameters:**
- `styleId` (string) - Unique identifier for the style
- `styleName` (string) - Display name for the style
- `properties` (TextStyle & ParagraphStyle) - Combined formatting properties

**Returns:** `Promise<ProcessorResult<Document>>`

**Example:**
```typescript
const result = await processor.createDocumentWithStyle(
  'CustomHeading',
  'My Custom Heading',
  {
    fontFamily: 'Arial',
    fontSize: 16,
    bold: true,
    color: '#0066CC',
    alignment: 'left',
    spaceBefore: 240,
    spaceAfter: 120
  }
);
```

---

### applyStyleToParagraphs(doc: Document, styleId: string, application: StyleApplication)

Apply a style to paragraphs based on target criteria (all, pattern, or specific indices).

**Parameters:**
- `doc` (Document) - Document containing paragraphs to modify
- `styleId` (string) - ID of the style to apply
- `application` (StyleApplication) - Targeting criteria

**Returns:** `Promise<ProcessorResult<StyleApplicationResult>>`

**Example:**
```typescript
// Apply to paragraphs containing "IMPORTANT"
const result = await processor.applyStyleToParagraphs(doc, 'Heading1', {
  target: 'pattern',
  pattern: /IMPORTANT/i
});

console.log(`Applied to ${result.data.appliedCount} paragraphs`);
```

---

## Table Operations

### createTable(doc: Document, rows: number, columns: number, options?: TableOptions)

Create a formatted table in the document.

**Parameters:**
- `doc` (Document) - Document to add the table to
- `rows` (number) - Number of rows
- `columns` (number) - Number of columns
- `options` (object, optional) - Formatting options
  - `borders` (boolean) - Show borders (default: true)
  - `borderColor` (string) - Border color in hex
  - `borderSize` (number) - Border size in points
  - `headerShading` (string) - Header row background color
  - `cellPadding` (number) - Cell padding in twips

**Returns:** `Promise<ProcessorResult<Table>>`

**Example:**
```typescript
const result = await processor.createTable(doc, 3, 4, {
  borders: true,
  borderColor: '0066CC',
  borderSize: 6,
  headerShading: 'E6F2FF'
});
```

---

### setCellShading(cell: TableCell, color: string)

Set background color (shading) for a table cell.

**Parameters:**
- `cell` (TableCell) - Table cell to apply shading to
- `color` (string) - Background color in hex format

**Returns:** `Promise<ProcessorResult<void>>`

**Example:**
```typescript
const cell = table.getRow(0).getCell(0);
await processor.setCellShading(cell, '#E6F2FF');
```

---

### addCellContent(cell: TableCell, text: string, formatting?: TextStyle)

Add formatted text content to a table cell.

**Parameters:**
- `cell` (TableCell) - Table cell to add content to
- `text` (string) - Text content to add
- `formatting` (TextStyle, optional) - Text formatting options

**Returns:** `Promise<ProcessorResult<void>>`

**Example:**
```typescript
await processor.addCellContent(headerCell, 'Product Name', {
  bold: true,
  fontSize: 12,
  color: '#FFFFFF'
});
```

---

## Paragraph Formatting

### createParagraph(doc: Document, text: string, formatting?: ParagraphStyle & TextStyle)

Create a formatted paragraph in the document.

**Parameters:**
- `doc` (Document) - Document to add paragraph to
- `text` (string) - Text content for the paragraph
- `formatting` (ParagraphStyle & TextStyle, optional) - Formatting options

**Returns:** `Promise<ProcessorResult<Paragraph>>`

**Example:**
```typescript
const result = await processor.createParagraph(doc, 'Chapter 1: Introduction', {
  fontFamily: 'Arial',
  fontSize: 16,
  bold: true,
  color: '#0066CC',
  alignment: 'left',
  spaceBefore: 240,
  spaceAfter: 120,
  keepNext: true
});
```

---

### setIndentation(para: Paragraph, options: IndentationOptions)

Set indentation on an existing paragraph.

**Parameters:**
- `para` (Paragraph) - Paragraph to modify
- `options` (object) - Indentation settings
  - `left` (number, optional) - Left indentation in twips
  - `right` (number, optional) - Right indentation in twips
  - `firstLine` (number, optional) - First line indentation in twips

**Returns:** `Promise<ProcessorResult<void>>`

**Example:**
```typescript
// Set hanging indent for bibliography
await processor.setIndentation(paragraphs[0], {
  left: processor.inchesToTwips(0.5),
  firstLine: processor.inchesToTwips(-0.25)
});
```

---

## High-Level Operations

### readDocument(filePath: string)

Read an existing document and extract its complete structure.

**Parameters:**
- `filePath` (string) - Path to the DOCX file to read

**Returns:** `Promise<DocumentReadResult>`

**Example:**
```typescript
const result = await processor.readDocument('./report.docx');

if (result.success) {
  console.log(`Paragraphs: ${result.data.content.paragraphs.length}`);
  console.log(`Tables: ${result.data.content.tables.length}`);
}
```

---

### modifyDocument(filePath: string, modifications: (doc: Document) => Promise<void> | void)

Perform atomic load-modify-save operations on a document.

**Parameters:**
- `filePath` (string) - Path to the DOCX file to modify
- `modifications` (function) - Function that receives the document and makes modifications

**Returns:** `Promise<DocumentModifyResult>`

**Example:**
```typescript
await processor.modifyDocument('./contract.docx', async (doc) => {
  doc.replaceText('COMPANY_NAME', 'Acme Corporation');
  doc.replaceText('CURRENT_YEAR', '2025');
});
```

---

### modifyDocumentBuffer(buffer: Buffer, modifications: (doc: Document) => Promise<void> | void)

Perform atomic load-modify operations on a document from Buffer.

**Parameters:**
- `buffer` (Buffer) - Buffer containing the DOCX file data
- `modifications` (function) - Function that receives the document and makes modifications

**Returns:** `Promise<DocumentModifyResult>`

**Example:**
```typescript
const result = await processor.modifyDocumentBuffer(inputBuffer, async (doc) => {
  const para = doc.createParagraph('CONFIDENTIAL');
  para.setAlignment('center');
});
```

---

## Hyperlink Operations

### extractHyperlinks(doc: Document)

Extract all hyperlinks from a document with comprehensive coverage (body, tables, headers, footers).

**Performance:** 89% code reduction, 20-30% faster than manual extraction

**Parameters:**
- `doc` (Document) - Document to extract hyperlinks from

**Returns:** `Promise<Array<HyperlinkInfo>>`

**Example:**
```typescript
const hyperlinks = await processor.extractHyperlinks(doc);

hyperlinks.forEach((link, index) => {
  console.log(`${index + 1}. ${link.text}`);
  console.log(`   URL: ${link.url}`);
});
```

---

### updateHyperlinkUrls(doc: Document, urlMap: Map<string, string>)

Batch update hyperlink URLs using direct mapping.

**Performance:** 30-50% faster than modifyHyperlinks for simple replacements

**Parameters:**
- `doc` (Document) - Document to modify
- `urlMap` (Map<string, string>) - Map of old URLs to new URLs

**Returns:** `Promise<ProcessorResult<UpdateStats>>`

**Example:**
```typescript
const urlMap = new Map([
  ['http://old-site.com/page1', 'https://new-site.com/page1'],
  ['http://old-site.com/page2', 'https://new-site.com/page2']
]);

const result = await processor.updateHyperlinkUrls(doc, urlMap);
console.log(`Updated: ${result.data.modifiedHyperlinks}`);
```

---

### modifyHyperlinks(doc: Document, urlTransform: (url: string, displayText: string) => string)

Modify hyperlinks using a transformation function.

**Parameters:**
- `doc` (Document) - Document to modify
- `urlTransform` (function) - Function that receives URL and text, returns new URL

**Returns:** `Promise<ProcessorResult<ModifyStats>>`

**Example:**
```typescript
// Upgrade HTTP to HTTPS
await processor.modifyHyperlinks(doc, (url, displayText) => {
  if (url.startsWith('http://') && url.includes('example.com')) {
    return url.replace('http://', 'https://');
  }
  return url;
});
```

---

### appendContentIdToTheSourceUrls(filePath: string, contentId?: string)

Append Content ID fragment to theSource URLs (CVS Health specific).

**Parameters:**
- `filePath` (string) - Path to the DOCX file to modify
- `contentId` (string, optional) - Content fragment to append (default: '#content')

**Returns:** `Promise<ProcessorResult<UpdateStats>>`

**Example:**
```typescript
const result = await processor.appendContentIdToTheSourceUrls('./document.docx');
// Transforms: thesource.cvshealth.com/page/docid=abc -> ...#content
```

---

### replaceHyperlinkText(doc: Document, pattern: string | RegExp, replacement: string)

Replace hyperlink display text based on a pattern.

**Parameters:**
- `doc` (Document) - Document to modify
- `pattern` (string | RegExp) - Pattern to match in display text
- `replacement` (string) - Replacement text

**Returns:** `Promise<ProcessorResult<ReplaceStats>>`

**Example:**
```typescript
// Regex replacement with capture groups
await processor.replaceHyperlinkText(doc, /Page (\d+)/, 'Section $1');
```

---

## Search & Replace

### findText(doc: Document, pattern: string | RegExp, options?: SearchOptions)

Find text in document using built-in search.

**Parameters:**
- `doc` (Document) - Document to search
- `pattern` (string | RegExp) - Text string or regex pattern
- `options` (object, optional)
  - `caseSensitive` (boolean) - Case-sensitive search
  - `wholeWord` (boolean) - Match whole words only

**Returns:** `Promise<ProcessorResult<Array<SearchResult>>>`

**Example:**
```typescript
const result = await processor.findText(doc, 'important', {
  caseSensitive: false
});

console.log(`Found ${result.data.length} matches`);
```

---

### replaceText(doc: Document, find: string | RegExp, replace: string, options?: ReplaceOptions)

Replace text in document using built-in replace.

**Parameters:**
- `doc` (Document) - Document to modify
- `find` (string | RegExp) - Text or pattern to find
- `replace` (string) - Replacement text
- `options` (object, optional)
  - `caseSensitive` (boolean) - Case-sensitive search
  - `wholeWord` (boolean) - Match whole words only

**Returns:** `Promise<ProcessorResult<ReplaceStats>>`

**Example:**
```typescript
// Simple text replacement
await processor.replaceText(doc, '{{COMPANY_NAME}}', 'Acme Corporation');

// Regex replacement with capture groups
await processor.replaceText(doc, /(\d{2})\/(\d{2})\/(\d{4})/, '$3-$1-$2');
```

---

## Document Statistics

### getWordCount(doc: Document)

Get word count from document (includes paragraphs, tables, headers, footers).

**Parameters:**
- `doc` (Document) - Document to analyze

**Returns:** `Promise<ProcessorResult<{ wordCount: number }>>`

**Example:**
```typescript
const result = await processor.getWordCount(doc);
console.log(`Document contains ${result.data.wordCount} words`);

// Calculate reading time (200 words per minute)
const readingTime = Math.ceil(result.data.wordCount / 200);
```

---

### getCharacterCount(doc: Document, includeSpaces?: boolean)

Get character count from document.

**Parameters:**
- `doc` (Document) - Document to analyze
- `includeSpaces` (boolean, optional) - Include spaces in count (default: true)

**Returns:** `Promise<ProcessorResult<{ characterCount: number }>>`

**Example:**
```typescript
const withSpaces = await processor.getCharacterCount(doc, true);
const withoutSpaces = await processor.getCharacterCount(doc, false);

console.log(`Characters (with spaces): ${withSpaces.data.characterCount}`);
console.log(`Characters (no spaces): ${withoutSpaces.data.characterCount}`);
```

---

### estimateSize(doc: Document)

Estimate document size before saving.

**Parameters:**
- `doc` (Document) - Document to estimate

**Returns:** `Promise<ProcessorResult<{ totalEstimatedMB: number, warning?: string }>>`

**Example:**
```typescript
const sizeResult = await processor.estimateSize(doc);
console.log(`Estimated size: ${sizeResult.data.totalEstimatedMB.toFixed(2)} MB`);

if (sizeResult.data.totalEstimatedMB < 10) {
  await processor.saveToFile(doc, 'output.docx');
} else {
  console.error('Document too large');
}
```

---

### getSizeStats(doc: Document)

Get detailed document statistics including element counts and size.

**Parameters:**
- `doc` (Document) - Document to analyze

**Returns:** `Promise<ProcessorResult<SizeStats>>`

**Example:**
```typescript
const stats = await processor.getSizeStats(doc);

console.log(`Paragraphs: ${stats.data.elements.paragraphs}`);
console.log(`Tables: ${stats.data.elements.tables}`);
console.log(`Images: ${stats.data.elements.images}`);
console.log(`Hyperlinks: ${stats.data.elements.hyperlinks}`);
console.log(`Size: ${stats.data.size.totalEstimatedMB.toFixed(2)} MB`);
```

---

## Utility Methods

### createNewDocument()

Create a new blank document.

**Returns:** `Document`

**Example:**
```typescript
const doc = processor.createNewDocument();
await processor.createParagraph(doc, 'Hello World!');
await processor.saveToFile(doc, 'new-document.docx');
doc.dispose();
```

---

### inchesToTwips(inches: number)

Convert inches to twips (1 inch = 1440 twips).

**Parameters:**
- `inches` (number) - Measurement in inches

**Returns:** `number`

**Example:**
```typescript
const indent = processor.inchesToTwips(0.5);  // 720 twips
await processor.setIndentation(para, { left: indent });
```

---

### pointsToTwips(points: number)

Convert points to twips (1 point = 20 twips).

**Parameters:**
- `points` (number) - Measurement in points

**Returns:** `number`

**Example:**
```typescript
const spacing = processor.pointsToTwips(12);  // 240 twips
await processor.createParagraph(doc, 'Text', { spaceBefore: spacing });
```

---

### twipsToPoints(twips: number)

Convert twips to points (20 twips = 1 point).

**Parameters:**
- `twips` (number) - Measurement in twips

**Returns:** `number`

**Example:**
```typescript
const formatting = para.getFormatting();
const points = processor.twipsToPoints(formatting.spaceBefore);
console.log(`Space before: ${points}pt`);
```

---

## Quick Reference Table

| Method | Category | Description | Returns |
|--------|----------|-------------|---------|
| `loadFromFile` | Document I/O | Load document from file path | `Promise<ProcessorResult<Document>>` |
| `loadFromBuffer` | Document I/O | Load document from Buffer | `Promise<ProcessorResult<Document>>` |
| `saveToFile` | Document I/O | Save document to file path | `Promise<ProcessorResult<void>>` |
| `toBuffer` | Document I/O | Convert document to Buffer | `Promise<DocumentModifyResult>` |
| `createDocumentWithStyle` | Style Operations | Create document with custom style | `Promise<ProcessorResult<Document>>` |
| `applyStyleToParagraphs` | Style Operations | Apply style to paragraphs | `Promise<ProcessorResult<StyleApplicationResult>>` |
| `createTable` | Table Operations | Create formatted table | `Promise<ProcessorResult<Table>>` |
| `setCellShading` | Table Operations | Set cell background color | `Promise<ProcessorResult<void>>` |
| `addCellContent` | Table Operations | Add content to table cell | `Promise<ProcessorResult<void>>` |
| `createParagraph` | Paragraph Formatting | Create formatted paragraph | `Promise<ProcessorResult<Paragraph>>` |
| `setIndentation` | Paragraph Formatting | Set paragraph indentation | `Promise<ProcessorResult<void>>` |
| `readDocument` | High-Level Operations | Read document structure | `Promise<DocumentReadResult>` |
| `modifyDocument` | High-Level Operations | Atomic load-modify-save | `Promise<DocumentModifyResult>` |
| `modifyDocumentBuffer` | High-Level Operations | Modify document from Buffer | `Promise<DocumentModifyResult>` |
| `extractHyperlinks` | Hyperlink Operations | Extract all hyperlinks | `Promise<Array<HyperlinkInfo>>` |
| `updateHyperlinkUrls` | Hyperlink Operations | Batch update hyperlink URLs | `Promise<ProcessorResult<UpdateStats>>` |
| `modifyHyperlinks` | Hyperlink Operations | Transform hyperlink URLs | `Promise<ProcessorResult<ModifyStats>>` |
| `appendContentIdToTheSourceUrls` | Hyperlink Operations | Append #content to theSource | `Promise<ProcessorResult<UpdateStats>>` |
| `replaceHyperlinkText` | Hyperlink Operations | Replace hyperlink display text | `Promise<ProcessorResult<ReplaceStats>>` |
| `findText` | Search & Replace | Find text in document | `Promise<ProcessorResult<Array<SearchResult>>>` |
| `replaceText` | Search & Replace | Replace text in document | `Promise<ProcessorResult<ReplaceStats>>` |
| `getWordCount` | Document Statistics | Get word count | `Promise<ProcessorResult<{ wordCount: number }>>` |
| `getCharacterCount` | Document Statistics | Get character count | `Promise<ProcessorResult<{ characterCount: number }>>` |
| `estimateSize` | Document Statistics | Estimate document size | `Promise<ProcessorResult<SizeEstimate>>` |
| `getSizeStats` | Document Statistics | Get detailed statistics | `Promise<ProcessorResult<SizeStats>>` |
| `createNewDocument` | Utilities | Create blank document | `Document` |
| `inchesToTwips` | Utilities | Convert inches to twips | `number` |
| `pointsToTwips` | Utilities | Convert points to twips | `number` |
| `twipsToPoints` | Utilities | Convert twips to points | `number` |

---

## Notes

### Memory Management

Always call `dispose()` on documents when finished to prevent memory leaks:

```typescript
const loadResult = await processor.loadFromFile('document.docx');
if (loadResult.success) {
  const doc = loadResult.data;
  // Work with document...
  doc.dispose(); // Clean up
}
```

### Error Handling

All methods return `ProcessorResult<T>` objects with success/error information:

```typescript
const result = await processor.loadFromFile('file.docx');
if (!result.success) {
  console.error('Error:', result.error);
  return;
}
const doc = result.data;
```

### Performance Tips

1. Use `updateHyperlinkUrls()` for direct URL mapping (30-50% faster)
2. Use batch operations when possible
3. Dispose documents immediately after use
4. Use `modifyDocument()` for atomic operations

---

**Last Updated:** 2025-11-13
**Version:** 1.0.40
**Documentation Hub** | [GitHub](https://github.com/ItMeDiaTech/Documentation_Hub)
