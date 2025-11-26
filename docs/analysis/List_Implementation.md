Based on the source code analysis, here's how **docxmlater** handles bullet point symbols:

## ✅ User Input Acceptance

**Yes, docxmlater fully accepts user-defined bullet symbols** through multiple methods:

1. **Array of custom bullets** in [`createBulletList()`](examples/03-lists/simple-bullet-list.ts:51):

   ```typescript
   const listId = doc.createBulletList(3, ['▪', '○', '▸']);
   ```

2. **Direct symbol specification** via [`NumberingLevel.createBulletLevel()`](src/formatting/NumberingLevel.ts:461):

   ```typescript
   const level = NumberingLevel.createBulletLevel(0, '➤'); // Arrow bullet
   ```

3. **Framework capability** (available but not currently used): [`getBulletSymbolWithFont()`](node_modules/docxmlater/dist/formatting/NumberingLevel.d.ts:35-38)
   - Available predefined styles: `'standard'`, `'circle'`, `'square'`, `'arrow'`, `'check'`
   - Each provides 9 coordinated symbols with recommended fonts
   - Current project uses user-configured bullets instead (from UI settings)

## 🔧 Symbol Assignment & Storage

Bullets are stored in the [`NumberingLevelProperties`](src/formatting/NumberingLevel.ts:36-75) interface:

- **`text`**: The actual bullet character (e.g., '•', '▪', '★')
- **`format`**: Set to `"bullet"` for bullet lists
- **`font`**: Font family (default: "Verdana" in this project via framework standardization)
- **`fontSize`**: Size in half-points (default: 24 = 12pt)
- **`color`**: Hex color without # (default: "000000")
- **`bold`**: Whether bold (default: `true` as of recent updates)

Generated XML structure (actual project output):

```xml
<w:lvl w:ilvl="0">
  <w:numFmt w:val="bullet"/>
  <w:lvlText w:val="•"/>  <!-- User's symbol here -->
  <w:rPr>
    <w:rFonts w:hint="default" w:ascii="Verdana" w:hAnsi="Verdana" w:cs="Verdana"/>
    <w:b/>
    <w:bCs/>
    <w:color w:val="000000"/>
    <w:sz w:val="24"/>
    <w:szCs w:val="24"/>
  </w:rPr>
</w:lvl>
```

**Note:** This project uses **Verdana** font for bullet formatting (not Calibri as shown in examples). Fonts are applied via custom XML injection in `injectCompleteRunPropertiesToNumbering()` which directly manipulates `word/numbering.xml` for complete control over bullet formatting. The framework's `standardizeBulletSymbols()` method is available but not used in the main bullet processing pipeline.

## 📝 Modifying Pre-Existing Bullet Points (Example 4 Pattern - IMPLEMENTED)

**Current Implementation:** [`WordDocumentProcessor.ts:3100-3135`](src/services/document/WordDocumentProcessor.ts:3100-3135)

**ACTUAL IMPLEMENTATION:** Uses **custom XML injection** via `injectCompleteRunPropertiesToNumbering()` for complete control:

```typescript
// ACTUAL: Custom XML injection approach (not example 4 pattern)
// Direct manipulation of numbering.xml for complete control
const xmlContent = await numberingPart.getContent();
// Build rPr elements with exact font specifications
const standardRPr = `<w:rPr>
  <w:rFonts w:hint="default" w:ascii="Verdana" w:hAnsi="Verdana" w:cs="Verdana"/>
  <w:color w:val="000000"/>
  <w:sz w:val="24"/>
  <w:szCs w:val="24"/>
  <w:b/>
  <w:bCs/>
</w:rPr>`;
xmlContent = xmlContent.replace(existingRPr, standardRPr);
```

**Implementation Details:**

1. **Updates ALL existing abstractNum definitions** - not just new lists
2. **Processes ALL 9 bullet levels (0-8)** - Word's full level range
3. **Sets user-configured symbols** from UI settings
4. **Complete formatting control** - all 5 properties explicitly set
5. **No framework override conflicts** - removed redundant `standardizeBulletSymbols()` call

**Why Custom XML Injection?**

- ✅ **Complete control** over bullet formatting (no framework defaults)
- ✅ **Predictable results** - direct XML manipulation prevents conflicts
- ✅ **Verdana font guarantee** - ensures proper Unicode bullet rendering in Word
- ✅ **Preserves user symbols** - UI-configured bullets maintained exactly
- ✅ **Framework-independent** - doesn't rely on `standardizeBulletSymbols()` method

## 🎨 Framework Method Usage (Conditional Only)

Framework's [`standardizeBulletSymbols()`](node_modules/docxmlater/dist/core/Document.d.ts:268) is now used **only** in specific contexts:

**Usage 1:** When custom styles already applied ([`WordDocumentProcessor.ts:671`](src/services/document/WordDocumentProcessor.ts:671))

```typescript
// Only apply when ListParagraph style already processed
const bulletResult = doc.standardizeBulletSymbols({ fontSize: 12, bold: true });
```

**Usage 2:** Color-only updates ([`WordDocumentProcessor.ts:3271`](src/services/document/WordDocumentProcessor.ts:3271))

```typescript
// Standardize colors without changing other properties
const bulletResult = doc.standardizeBulletSymbols({ color: '000000', bold: true });
```

**NOT used in [`applyBulletUniformity()`](src/services/document/WordDocumentProcessor.ts:2845-2993)** - Complete property setting provides better control.

## 📊 Default Formatting

Current project formatting (applied via **custom XML injection**):

- **Font**: **Verdana** (11pt = 22 half-points for regular text, but bullets use 12pt = 24 half-points)
- **Size**: 12pt (24 half-points) - applied via XML `<w:sz w:val="24"/><w:szCs w:val="24"/>`
- **Color**: Black (#000000) - applied via XML `<w:color w:val="000000"/>`
- **Bold**: true - applied via XML `<w:b/><w:bCs/>` (bold + complex script bold)
- **Bold Complexity Script Support**: Added `<w:bCs/>` for proper rendering in complex scripts
- **Font Hint**: "default" - applied via `w:hint="default"` to ensure proper fallback
- **Default symbol**: '•' (U+2022) if not specified by user

**Implementation Approach:** The project uses **direct XML manipulation** of `word/numbering.xml` for bullet formatting. This `injectCompleteRunPropertiesToNumbering()` method provides:

- ✅ **Complete formatting control** - every rPr property explicitly set
- ✅ **No framework dependencies** - doesn't rely on docxmlater methods
- ✅ **Consistent rendering** - explicit font, size, and script support
- ✅ **User symbol preservation** - bullets from StylesEditor UI maintained exactly

**Bullet Symbol Process:**

1. **UI Configuration**: Symbols set in StylesEditor → `ListBulletSettings` → Session storage
2. **Processing**: `applyBulletUniformity()` creates `NumberingLevel` objects with user symbols
3. **XML Injection**: `injectCompleteRunPropertiesToNumbering()` applies Verdana 12pt bold black formatting
4. **Result**: Professional bullet formatting with user-chosen symbols

**Why Not Framework Methods?**

- `standardizeBulletSymbols()` could override symbol choices and font preferences
- Direct XML control ensures exact formatting matches user expectations
- Framework methods are available and used for simple color/bold updates in other contexts
- This hybrid approach balances reliability with framework capabilities

## 🔍 SDT Tag Removal Verification

**SDT (Structured Document Tag) tags are properly removed** during the docxmlater load/save cycle:

### Pre-Processing Example (Not_Processed_Example/word/document.xml):

```xml
<sdt>
  <sdtPr>
    <id w:val="116935416"/>
    <docPartObj>
      <docPartGallery w:val="Table of Contents"/>
      <docPartUnique w:val="1"/>
    </docPartObj>
  </sdtPr>
  <sdtContent>
    <tbl>
      <!-- table content with Header 2 in cells -->
      <tblPr><tblStyle w:val="Table4"/></tblPr>
      <!-- table rows and cells -->
    </tbl>
  </sdtContent>
</sdt>
```

### Post-Processing Result (Processed_Example/word/document.xml):

- **SDT wrapper removed**: Table content exists as direct `<tbl>` element
- **TOC field preserved**: Only the actual table of contents field remains
- **Table structure intact**: Header 2 cells maintain their position and content

**Verification**:

- ✅ `Not_Processed_Example/word/document.xml` contains `<w:sdt>` tags around tables
- ✅ `Processed_Example/word/document.xml` has no `<w:sdt>` tags - they are removed during processing
- ✅ Table content and Header 2 formatting preserved despite SDT removal

## 📋 Header 2 Style Presence Verification

**Header 2 styles are maintained throughout processing** with proper conversions:

### Pre-Processing (Not_Processed_Example):

- **Style**: `Heading2` (paragraph style)
- **Content**: Header 2 text in table cells
- **Formatting**: Variable (depends on original document)

### Post-Processing (Processed_Example):

- **Style**: Converted to `TableHeader` style (list-based formatting)
- **Form**: Bold Verdana 12pt text in table cells
- **Preservation**: ✅ Header 2 content and position maintained
- **Shading**: `BFBFBF` applied to 1x1 Header 2 tables

**Key Transformations**:

1. `Heading2` paragraphs → `TableHeader` style application
2. 1x1 tables with Header 2 → `BFBFBF` background shading
3. Multi-cell tables → `DFDFDF` background shading
4. **No content loss** - Header 2 text preserved exactly

**Conclusion**: The bullet implementation uses a **hybrid approach** combining docxmlater's document manipulation with direct XML control for formatting. UI-configured symbols are preserved while ensuring consistent professional Verdana 12pt bold black formatting. SDT tags are removed during load/save cycles, and Header 2 styles convert from `Heading2` to `TableHeader` but maintain proper formatting throughout processing.
