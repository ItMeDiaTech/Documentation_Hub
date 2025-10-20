# Font Embedding in DOCX Documents

## Overview

This guide explains how to properly embed fonts in DOCX documents using the docxmlater framework's `FontManager` class. When fonts are embedded, they must be registered in `[Content_Types].xml` to ensure Office applications recognize them.

## Important: Content_Types.xml Registration

**CRITICAL:** When adding fonts to `/word/fonts/`, you **MUST** add corresponding entries to `[Content_Types].xml`. The `FontManager` class in docxmlater automatically handles this for you.

## Font Manager Architecture

### Font Structure in DOCX

```
document.docx (ZIP archive)
├── [Content_Types].xml          ← Registers all file types including fonts
├── word/
│   ├── document.xml
│   ├── fontTable.xml           ← Optional: Font substitution info
│   └── fonts/                  ← Embedded font files
│       ├── arial_1.ttf
│       ├── times_2.otf
│       └── custom_3.woff
```

### Content_Types.xml Example

When fonts are added, `FontManager` generates entries like:

```xml
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <!-- Font type registrations -->
  <Default Extension="ttf" ContentType="application/x-font-ttf"/>
  <Default Extension="otf" ContentType="application/x-font-opentype"/>
  <Default Extension="woff" ContentType="application/font-woff"/>
  <Default Extension="woff2" ContentType="font/woff2"/>

  <!-- Other content types... -->
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>
```

## Using FontManager in docxmlater

### Basic Usage

```typescript
import { Document } from 'docxmlater';

// Create or load document
const doc = await Document.load('input.docx');

// Access the document's FontManager
const fontManager = doc.getFontManager(); // Hypothetical API - needs verification

// Add a font from file
await fontManager.addFontFromFile('Arial', '/path/to/arial.ttf');

// Or add from buffer
const fontData = fs.readFileSync('/path/to/custom.ttf');
fontManager.addFont('CustomFont', fontData, 'ttf');

// Save document - Content_Types.xml is automatically updated
await doc.save('output.docx');
```

### Supported Font Formats

| Format | Extension | MIME Type | Description |
|--------|-----------|-----------|-------------|
| TrueType | `.ttf` | `application/x-font-ttf` | Standard TrueType fonts |
| OpenType | `.otf` | `application/x-font-opentype` | OpenType fonts |
| WOFF | `.woff` | `application/font-woff` | Web Open Font Format |
| WOFF2 | `.woff2` | `font/woff2` | WOFF 2.0 (compressed) |

### Font Manager Methods

```typescript
// Add font from buffer
addFont(fontFamily: string, data: Buffer, format: FontFormat): string

// Add font from file path
addFontFromFile(fontFamily: string, filePath: string, format?: FontFormat): Promise<string>

// Check if font exists
hasFont(fontFamily: string): boolean

// Get all registered fonts
getAllFonts(): FontEntry[]

// Get font count
getCount(): number

// Get font by family name
getFontByFamily(fontFamily: string): FontEntry | undefined

// Generate Content_Types.xml entries
generateContentTypeEntries(): string[]
```

### Font Entry Structure

```typescript
interface FontEntry {
  filename: string;       // e.g., 'arial_1.ttf'
  format: FontFormat;     // 'ttf' | 'otf' | 'woff' | 'woff2'
  fontFamily: string;     // e.g., 'Arial'
  data: Buffer;          // Font file binary data
  path: string;          // e.g., 'word/fonts/arial_1.ttf'
}
```

## Implementation Details

### How FontManager Works

1. **Font Addition:**
   - When `addFont()` is called, FontManager:
     - Sanitizes the font family name for filename safety
     - Generates a unique filename (e.g., `arial_1.ttf`)
     - Stores font data in memory
     - Returns the path: `word/fonts/filename.ext`

2. **Content_Types.xml Update:**
   - When document is saved, FontManager:
     - Detects all unique font extensions used
     - Generates `<Default Extension="..." ContentType="..."/>` entries
     - Injects entries into `[Content_Types].xml`

3. **ZIP Archive Creation:**
   - Font files are added to `word/fonts/` directory
   - Content_Types.xml is placed as first entry with STORE compression
   - Maintains proper file ordering for Office compatibility

### Filename Sanitization

Font family names are sanitized for safe filenames:

```typescript
// Input: "Times New Roman"
// Output: "times_new_roman_1.ttf"

// Input: "Source Sans Pro"
// Output: "source_sans_pro_2.ttf"
```

### Counter System

Each font gets a unique counter to prevent naming conflicts:

```typescript
fontManager.addFont('Arial', data1, 'ttf');  // → 'arial_1.ttf'
fontManager.addFont('Arial', data2, 'ttf');  // → 'arial_2.ttf'
```

## Obfuscated Fonts (.odttf)

For copyright protection, fonts can be obfuscated:

### ODTTF Format

- **Extension:** `.odttf` (Obfuscated OpenType)
- **MIME Type:** `application/vnd.openxmlformats-officedocument.obfuscatedFont`
- **Obfuscation:** First 32 bytes XOR-encrypted with font GUID

### Content_Types.xml for ODTTF

```xml
<Default Extension="odttf" ContentType="application/vnd.openxmlformats-officedocument.obfuscatedFont"/>
```

**Note:** docxmlater currently supports standard fonts (.ttf, .otf, .woff, .woff2). For .odttf support, custom implementation may be needed.

## Best Practices

### 1. Font Licensing

```typescript
// ✅ GOOD: Only embed fonts you have license to redistribute
fontManager.addFont('CustomBrandFont', brandFontData, 'ttf');

// ❌ BAD: Don't embed licensed fonts without permission
// fontManager.addFont('HelveticaNeue', data, 'ttf'); // License violation!
```

### 2. Font Subsetting

For production use, embed only glyphs actually used in the document:

```typescript
// Future enhancement: Subset fonts to reduce file size
// const subset = await createFontSubset(fontData, usedCharacters);
// fontManager.addFont('Arial', subset, 'ttf');
```

### 3. Error Handling

```typescript
try {
  await fontManager.addFontFromFile('CustomFont', '/path/to/font.ttf');
} catch (error) {
  console.error('Font embedding failed:', error);
  // Fallback: Use system fonts
}
```

### 4. Verify Font Registration

```typescript
// After adding fonts, verify they're registered
const fonts = fontManager.getAllFonts();
console.log(`Embedded ${fonts.length} fonts`);

fonts.forEach(font => {
  console.log(`- ${font.fontFamily} (${font.format}) at ${font.path}`);
});

// Verify Content_Types entries will be generated
const entries = fontManager.generateContentTypeEntries();
console.log('Content_Types.xml entries:', entries);
```

## Troubleshooting

### Issue: Fonts not displaying in Word

**Symptoms:** Document opens but custom fonts fall back to default

**Causes:**
1. Missing Content_Types.xml entries
2. Incorrect MIME types
3. Corrupted font files
4. Missing fontTable.xml references

**Solutions:**
```typescript
// Verify Content_Types.xml contains font entries
const entries = fontManager.generateContentTypeEntries();
if (entries.length === 0) {
  console.error('No font Content-Type entries generated!');
}

// Check font was actually added
if (!fontManager.hasFont('CustomFont')) {
  console.error('Font was not registered!');
}

// Verify font file is valid
const fontData = fs.readFileSync('/path/to/font.ttf');
if (fontData.length === 0) {
  console.error('Font file is empty!');
}
```

### Issue: ZIP corruption after adding fonts

**Symptoms:** "File is corrupted" error when opening DOCX

**Cause:** Incorrect ZIP structure or Content_Types.xml placement

**Solution:** Ensure docxmlater handles ZIP creation:
```typescript
// ✅ GOOD: Let docxmlater handle everything
await doc.save('output.docx');

// ❌ BAD: Don't manually manipulate ZIP after adding fonts
// const buffer = await doc.toBuffer();
// // Manual ZIP manipulation can corrupt structure
```

## Integration with WordDocumentProcessor

Our `WordDocumentProcessor` should expose font functionality:

```typescript
// In WordDocumentProcessor.ts
export class WordDocumentProcessor {
  /**
   * Adds a custom font to the document
   * Automatically updates Content_Types.xml
   */
  async addCustomFont(fontFamily: string, fontPath: string): Promise<void> {
    const doc = await this.loadDocument();
    const fontManager = doc.getFontManager();

    await fontManager.addFontFromFile(fontFamily, fontPath);

    this.log.info(`Added font: ${fontFamily} from ${fontPath}`);
  }

  /**
   * Gets all embedded fonts in the document
   */
  getEmbeddedFonts(): FontEntry[] {
    const doc = this.getCurrentDocument();
    return doc.getFontManager().getAllFonts();
  }
}
```

## References

- [ECMA-376: Office Open XML File Formats](https://www.ecma-international.org/publications-and-standards/standards/ecma-376/)
- [Microsoft: Office Open XML Font Table](https://learn.microsoft.com/en-us/office/open-xml/word/how-to-set-the-font-for-a-text-run)
- [ODTTF Wikipedia](https://en.wikipedia.org/wiki/ODTTF)
- docxmlater FontManager source code (see implementation above)

## Version History

- **2025-10-19:** Initial documentation created
- Based on docxmlater v0.26.0 FontManager implementation

---

**Last Updated:** 2025-10-19
**Maintained By:** Documentation Hub Team
