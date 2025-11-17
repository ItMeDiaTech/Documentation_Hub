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

**Note:** This project uses Verdana font (not Calibri) for proper Unicode bullet rendering in Word. The framework's `standardizeBulletSymbols()` method applies this formatting.

## 📝 Modifying Pre-Existing Bullet Points (Example 4 Pattern - IMPLEMENTED)

**Current Implementation:** [`WordDocumentProcessor.ts:2936-2958`](src/services/document/WordDocumentProcessor.ts:2936-2958)

The project now follows **Example 4's complete property setting pattern**:

```typescript
// ✅ COMPLETE PROPERTY SETTING (Example 4 pattern)
// Set ALL 5 bullet formatting properties for complete control
level.setText(newSymbol); // Bullet symbol (e.g., ●, ▪, ➤)
level.setFont('Calibri'); // Font: Calibri renders U+2022 as ●, not ■
level.setFontSize(24); // Size: 12pt = 24 half-points
level.setBold(true); // Bold: Improves visibility
level.setColor('000000'); // Color: Black (#000000)
```

**Implementation Details:**

1. **Updates ALL existing abstractNum definitions** - not just new lists
2. **Processes ALL 9 bullet levels (0-8)** - Word's full level range
3. **Sets user-configured symbols** from UI settings
4. **Complete formatting control** - all 5 properties explicitly set
5. **No framework override conflicts** - removed redundant `standardizeBulletSymbols()` call

**Why Complete Property Setting?**

- ✅ Full control over formatting (no framework defaults)
- ✅ Prevents property conflicts/overrides
- ✅ Matches Example 4's proven pattern
- ✅ Clearer code intent and maintainability
- ✅ Ensures Calibri font for proper ● rendering

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

Current project formatting (applied via **Example 4 complete property setting**):

- **Font**: Calibri (critical for proper U+2022 → ● rendering, not ■)
- **Size**: 12pt (24 half-points)
- **Color**: Black (#000000)
- **Bold**: true
- **Default symbol**: '•' (U+2022) if not specified by user

**Implementation Approach:** The project uses **Example 4's complete property setting pattern** ([`WordDocumentProcessor.ts:2943-2949`](src/services/document/WordDocumentProcessor.ts:2943-2949)) which sets ALL 5 properties (setText, setFont, setFontSize, setBold, setColor) for complete control over bullet formatting. This approach:

- Eliminates framework conflicts
- Provides predictable, consistent results
- Ensures proper Unicode bullet rendering (● not ■)

**Conclusion**: docxmlater correctly handles bullet symbols through a robust system that accepts any Unicode character. Using Example 4's complete property setting pattern provides the most reliable control over bullet formatting, ensuring all properties are explicitly set without relying on framework defaults or inheritance.
