# Office Open XML Hyperlink Architecture Reference

**Technical Documentation for Document Processing**
_Last Updated: January 2025_

---

## Table of Contents

1. [Introduction](#introduction)
2. [Office Open XML Document Structure](#office-open-xml-document-structure)
3. [XML Namespace Prefixes](#xml-namespace-prefixes)
4. [Hyperlink Two-Part System](#hyperlink-two-part-system)
5. [Relationship Architecture](#relationship-architecture)
6. [XML Parser Configuration](#xml-parser-configuration)
7. [Nested Element Handling](#nested-element-handling)
8. [Common Pitfalls & Solutions](#common-pitfalls--solutions)
9. [Code Smell Detection](#code-smell-detection)
10. [Code Examples](#code-examples)
11. [Validation Checklist](#validation-checklist)

---

## Introduction

Office Open XML (OOXML) is the standard file format for Microsoft Word `.docx` files. Understanding its architecture is **critical** for document processing because:

- **One wrong namespace → Document corruption**
- **Orphaned relationships → Broken hyperlinks**
- **Missing attributes → Rendering failures**

This document provides the technical foundation for processing OOXML hyperlinks correctly.

---

## Office Open XML Document Structure

### Document Package Architecture

A `.docx` file is actually a **ZIP archive** containing multiple XML files:

```
document.docx (ZIP file)
│
├── [Content_Types].xml          # MIME types for all parts
├── _rels/
│   └── .rels                     # Package-level relationships
│
├── word/
│   ├── document.xml              # Main document content
│   ├── styles.xml                # Style definitions
│   ├── numbering.xml             # List numbering
│   ├── fontTable.xml             # Font declarations
│   ├── header1.xml               # Header content
│   ├── footer1.xml               # Footer content
│   │
│   └── _rels/
│       ├── document.xml.rels     # Relationships for main document
│       ├── header1.xml.rels      # Relationships for header1
│       └── footer1.xml.rels      # Relationships for footer1
│
└── docProps/
    ├── core.xml                  # Core properties (author, dates)
    └── app.xml                   # Application properties
```

### Key Principles

1. **Content and Structure are Separate**
   - `word/document.xml` contains structure + text
   - `word/_rels/document.xml.rels` contains external references (URLs, images, etc.)

2. **Relationships Connect Everything**
   - Every hyperlink in `document.xml` references a relationship via `r:id`
   - The relationship file maps that `r:id` to the actual URL

3. **Multiple Document Parts**
   - Headers, footers, and main document are **separate XML files**
   - Each has its own relationship file

---

## XML Namespace Prefixes

### Core Namespaces Used in OOXML

| Prefix | Namespace URI                                                            | Purpose                   | Usage                                     |
| ------ | ------------------------------------------------------------------------ | ------------------------- | ----------------------------------------- |
| `w:`   | `http://schemas.openxmlformats.org/wordprocessingml/2006/main`           | **WordprocessingML main** | Paragraphs, runs, text, styles            |
| `r:`   | `http://schemas.openxmlformats.org/officeDocument/2006/relationships`    | **Relationships**         | Hyperlink IDs, image refs, external links |
| `a:`   | `http://schemas.openxmlformats.org/drawingml/2006/main`                  | **DrawingML**             | Charts, shapes, SmartArt                  |
| `pic:` | `http://schemas.openxmlformats.org/drawingml/2006/picture`               | **Pictures**              | Embedded images                           |
| `wp:`  | `http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing` | **Drawing anchoring**     | Image positioning in text                 |
| `v:`   | `http://schemas.openxmlformats.org/vml`                                  | **VML (legacy)**          | Older vector graphics                     |
| `o:`   | `urn:schemas-microsoft-com:office:office`                                | **Office extensions**     | Microsoft-specific features               |

### Prefix Usage Rules

#### `w:` - Document Content Elements

```xml
<w:p>                    <!-- Paragraph -->
  <w:pPr>               <!-- Paragraph properties -->
    <w:pStyle w:val="Heading1"/>
  </w:pPr>
  <w:r>                 <!-- Run (text formatting container) -->
    <w:rPr>             <!-- Run properties -->
      <w:b/>            <!-- Bold -->
      <w:sz w:val="28"/> <!-- Font size (half-points) -->
    </w:rPr>
    <w:t>Text</w:t>     <!-- Text content -->
  </w:r>
</w:p>
```

**Key Elements:**

- `w:p` - Paragraph
- `w:r` - Run (text container with formatting)
- `w:t` - Text node
- `w:pPr` - Paragraph properties
- `w:rPr` - Run properties
- `w:hyperlink` - Hyperlink element

#### `r:` - Relationship References

```xml
<!-- In document.xml -->
<w:hyperlink r:id="rId5">
  <w:r>
    <w:t>Click here</w:t>
  </w:r>
</w:hyperlink>

<!-- In document.xml.rels -->
<Relationship
  Id="rId5"
  Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink"
  Target="https://example.com"
  TargetMode="External"/>
```

**Critical Rule:** The `r:id` value MUST exactly match a `Relationship` `Id` in the corresponding `.rels` file.

---

## Hyperlink Two-Part System

### Architecture Overview

Hyperlinks in OOXML use a **mandatory two-part reference system**:

```
┌─────────────────────────────────────────────────────────────┐
│                    DOCUMENT.XML                              │
│  <w:hyperlink r:id="rId5">                                  │
│    <w:r><w:t>Display Text</w:t></w:r>                       │
│  </w:hyperlink>                                             │
│                                                              │
│  ↓ References relationship via r:id="rId5"                  │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                DOCUMENT.XML.RELS                             │
│  <Relationship                                               │
│    Id="rId5"                                                │
│    Type="...relationships/hyperlink"                        │
│    Target="https://example.com"                             │
│    TargetMode="External"/>                                  │
│                                                              │
│  ↓ Contains actual URL                                      │
└─────────────────────────────────────────────────────────────┐
                            ↓
              https://example.com (final URL)
```

### Why This Design?

1. **Content Reuse**: Same URL can be referenced by multiple hyperlinks
2. **Security**: External URLs isolated in relationship files
3. **Validation**: Relationship integrity can be checked independently
4. **Performance**: URLs stored once, referenced many times

### Hyperlink Types

#### External Hyperlinks

```xml
<!-- document.xml -->
<w:hyperlink r:id="rId7">
  <w:r>
    <w:rPr>
      <w:rStyle w:val="Hyperlink"/>
    </w:rPr>
    <w:t>Visit Website</w:t>
  </w:r>
</w:hyperlink>

<!-- document.xml.rels -->
<Relationship
  Id="rId7"
  Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink"
  Target="https://example.com"
  TargetMode="External"/>
```

**Key Attributes:**

- `TargetMode="External"` - Required for external URLs
- `Type` ends with `/hyperlink`

#### Internal Hyperlinks (Bookmarks)

```xml
<!-- document.xml - Hyperlink -->
<w:hyperlink w:anchor="_Toc123456">
  <w:r><w:t>Jump to Section</w:t></w:r>
</w:hyperlink>

<!-- document.xml - Target bookmark -->
<w:bookmarkStart w:id="0" w:name="_Toc123456"/>
<w:r><w:t>Section Heading</w:t></w:r>
<w:bookmarkEnd w:id="0"/>
```

**Key Differences:**

- Uses `w:anchor` attribute instead of `r:id`
- NO relationship file entry needed
- Target must exist as a bookmark in the same document

---

## Relationship Architecture

### Relationship File Structure

```xml
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">

  <!-- Hyperlink relationship -->
  <Relationship
    Id="rId5"
    Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink"
    Target="https://thesource.caci.com/docid=ABC123#content"
    TargetMode="External"/>

  <!-- Image relationship -->
  <Relationship
    Id="rId6"
    Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"
    Target="media/image1.png"/>

  <!-- Style relationship -->
  <Relationship
    Id="rId1"
    Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles"
    Target="styles.xml"/>

</Relationships>
```

### Relationship Types (Complete List)

| Type Suffix  | Purpose              | TargetMode | Example Target        |
| ------------ | -------------------- | ---------- | --------------------- |
| `/hyperlink` | External hyperlink   | External   | `https://example.com` |
| `/bookmark`  | Internal anchor link | Internal   | `#_Toc123456`         |
| `/image`     | Embedded image       | Internal   | `media/image1.png`    |
| `/styles`    | Style definitions    | Internal   | `styles.xml`          |
| `/header`    | Header part          | Internal   | `header1.xml`         |
| `/footer`    | Footer part          | Internal   | `footer1.xml`         |
| `/fontTable` | Font definitions     | Internal   | `fontTable.xml`       |
| `/numbering` | List numbering       | Internal   | `numbering.xml`       |

### Relationship ID Rules

1. **IDs must be unique** within each `.rels` file
2. **IDs are case-sensitive**: `rId5` ≠ `RId5`
3. **Common pattern**: `rId` + number (e.g., `rId1`, `rId2`, `rId3`)
4. **Auto-generated**: When adding relationships, generate sequential IDs
5. **Preserve on update**: When modifying a URL, **keep the same ID**

### Critical: Updating Hyperlinks Correctly

#### ❌ WRONG - Creates Orphaned Relationships

```javascript
// BAD: Creates new hyperlink with new relationship ID
const newHyperlink = Hyperlink.createExternal(newUrl, text);
paragraph.addHyperlink(newHyperlink); // Generates new rId9
// Result: Old rId5 orphaned, new rId9 not referenced in document
```

#### ✅ CORRECT - Updates Existing Relationship

```javascript
// GOOD: Update existing relationship, preserve ID
const relationshipId = hyperlink.getRelationshipId(); // e.g., "rId5"
document.updateRelationship(relationshipId, {
  Target: newUrl, // URL changes, ID stays "rId5"
});
// Result: Hyperlink still references rId5, which now points to new URL
```

---

## XML Parser Configuration

### fast-xml-parser Settings

Your application uses `fast-xml-parser` with this configuration:

```javascript
const xmlParser = new XMLParser({
  ignoreAttributes: false, // ✅ Keep all attributes
  parseAttributeValue: true, // ✅ Parse numbers/booleans
  trimValues: true, // ✅ Remove whitespace
  processEntities: false, // ✅ Keep entities as-is
  parseTagValue: false, // ✅ Don't convert tag values
  preserveOrder: false, // ✅ Object mode (not array)
  attributeNamePrefix: '@_', // ⚠️ CRITICAL: Attribute prefix
  textNodeName: '#text', // ⚠️ CRITICAL: Text node name
});
```

### Attribute Access Patterns

#### Configuration Impact

When `attributeNamePrefix: '@_'` is set:

```xml
<!-- XML Input -->
<w:hyperlink r:id="rId5" w:history="1">
  <w:r>
    <w:t xml:space="preserve">Text</w:t>
  </w:r>
</w:hyperlink>
```

```javascript
// Parsed JavaScript Object
{
  "w:hyperlink": {
    "@_r:id": "rId5",           // ← Attribute with @_ prefix
    "@_w:history": "1",         // ← Attribute with @_ prefix
    "w:r": {
      "w:t": {
        "@_xml:space": "preserve",  // ← Attribute with @_ prefix
        "#text": "Text"              // ← Text content
      }
    }
  }
}
```

#### ❌ WRONG - Incorrect Attribute Access

```javascript
// BROKEN: Using $ accessor (not configured)
if (hyperlink.$ && hyperlink.$['r:id']) {
  // ❌ Undefined!
  const relationshipId = hyperlink.$['r:id'];
}

// BROKEN: Missing prefix
if (hyperlink['r:id']) {
  // ❌ Undefined!
  const relationshipId = hyperlink['r:id'];
}
```

#### ✅ CORRECT - Matches Parser Configuration

```javascript
// CORRECT: Using @_ prefix
if (hyperlink['@_r:id']) {
  // ✅ Works!
  const relationshipId = hyperlink['@_r:id'];
}

// UTILITY FUNCTION: Consistent access
const getAttr = (element, attrName) => element[`@_${attrName}`];
const relationshipId = getAttr(hyperlink, 'r:id'); // ✅ Clean
```

### Text Node Access

```javascript
// Get text content
const textNode = run['w:t'];

if (typeof textNode === 'string') {
  // Simple text: "Hello"
  console.log(textNode);
} else if (textNode && textNode['#text']) {
  // Text with attributes: { '@_xml:space': 'preserve', '#text': 'Hello' }
  console.log(textNode['#text']);
}
```

### XML Builder Configuration

```javascript
const xmlBuilder = new XMLBuilder({
  ignoreAttributes: false,
  format: false, // No pretty-printing
  suppressEmptyNode: false, // Keep empty tags
  preserveOrder: false,
  attributeNamePrefix: '@_', // ⚠️ Must match parser!
  textNodeName: '#text',
});
```

**Critical:** Builder and parser MUST use identical `attributeNamePrefix` and `textNodeName`.

---

## Nested Element Handling

### Hyperlink Nesting Structure

Hyperlinks can be deeply nested within document structures:

```xml
<w:tbl>                           <!-- Table -->
  <w:tr>                          <!-- Table row -->
    <w:tc>                        <!-- Table cell -->
      <w:p>                       <!-- Paragraph in cell -->
        <w:hyperlink r:id="rId8"> <!-- Hyperlink in cell -->
          <w:r>
            <w:rPr>
              <w:b/>              <!-- Bold formatting -->
            </w:rPr>
            <w:t>Link Text</w:t>
          </w:r>
        </w:hyperlink>
      </w:p>
    </w:tc>
  </w:tr>
</w:tbl>
```

### Recursive Traversal Pattern

```javascript
/**
 * Find all hyperlinks in arbitrarily nested structure
 */
function findHyperlinks(obj, path = '', results = []) {
  if (!obj || typeof obj !== 'object') return results;

  // Check if current object is a hyperlink
  if (obj['w:hyperlink']) {
    const hyperlinks = Array.isArray(obj['w:hyperlink'])
      ? obj['w:hyperlink']
      : [obj['w:hyperlink']];

    for (const h of hyperlinks) {
      if (h['@_r:id']) {
        // ✅ Correct attribute access
        results.push({
          element: h,
          relationshipId: h['@_r:id'],
          path: path,
          displayText: extractText(h),
        });
      }
    }
  }

  // Recursively search all child objects
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'object') {
      findHyperlinks(value, `${path}/${key}`, results);
    }
  }

  return results;
}
```

### Text Extraction from Nested Runs

```javascript
/**
 * Extract all text from hyperlink (handles multiple runs)
 */
function extractText(hyperlinkElement) {
  let text = '';

  const extractFromElement = (elem) => {
    if (!elem) return;

    // Text node
    if (elem['w:t']) {
      const textNodes = Array.isArray(elem['w:t']) ? elem['w:t'] : [elem['w:t']];

      for (const t of textNodes) {
        if (typeof t === 'string') {
          text += t;
        } else if (t['#text']) {
          text += t['#text'];
        }
      }
    }

    // Run (text container)
    if (elem['w:r']) {
      const runs = Array.isArray(elem['w:r']) ? elem['w:r'] : [elem['w:r']];

      for (const run of runs) {
        extractFromElement(run);
      }
    }

    // Recursively check other elements
    for (const value of Object.values(elem)) {
      if (typeof value === 'object') {
        extractFromElement(value);
      }
    }
  };

  extractFromElement(hyperlinkElement);
  return text.trim();
}
```

### Preserving XML Attributes During Mutation

#### ❌ WRONG - Destroys Attributes

```javascript
// BROKEN: Replaces object, loses xml:space attribute
run['w:t'] = newText; // ❌ Loses { '@_xml:space': 'preserve' }
```

#### ✅ CORRECT - Preserves Structure

```javascript
// CORRECT: Update text content, preserve attributes
const textNode = run['w:t'];

if (typeof textNode === 'string') {
  // Simple string → convert to object with attributes
  run['w:t'] = {
    '@_xml:space': 'preserve', // Critical for whitespace
    '#text': newText,
  };
} else if (textNode && typeof textNode === 'object') {
  // Object with attributes → update text only
  textNode['#text'] = newText;
  // Attributes like '@_xml:space' preserved automatically
}
```

### Handling Array vs Single Element Ambiguity

XML parsers can represent repeated elements as either arrays or single objects:

```xml
<!-- Single run -->
<w:hyperlink r:id="rId5">
  <w:r><w:t>Text</w:t></w:r>
</w:hyperlink>

<!-- Multiple runs -->
<w:hyperlink r:id="rId5">
  <w:r><w:t>Bold </w:t></w:r>
  <w:r><w:t>Text</w:t></w:r>
</w:hyperlink>
```

```javascript
// SAFE: Normalize to array
const runs = Array.isArray(elem['w:r'])
  ? elem['w:r'] // Already array: [run1, run2]
  : [elem['w:r']]; // Single object: [run]

// Now you can safely iterate
for (const run of runs) {
  // Process each run
}
```

---

## Common Pitfalls & Solutions

### Pitfall 1: Orphaned Relationships

**Problem:** Creating new hyperlink elements without managing relationship IDs.

```javascript
// ❌ BROKEN CODE
const newHyperlink = Hyperlink.createExternal(newUrl, displayText);
paragraph.addContent(newHyperlink);
// Creates new relationship with new ID (e.g., rId9)
// Old hyperlink still references old ID (e.g., rId5)
// Result: Two relationships, old one orphaned
```

**Solution:** Update existing relationship, don't create new one.

```javascript
// ✅ CORRECT CODE
const relationshipId = hyperlink.getRelationshipId();
document.updateRelationship(relationshipId, { Target: newUrl });
// Same ID, new URL → No orphans
```

---

### Pitfall 2: Inconsistent Attribute Prefix

**Problem:** Using `$` accessor when parser uses `@_` prefix.

```javascript
// ❌ BROKEN - Wrong accessor
if (element.$ && element.$['r:id']) {
  // Returns undefined
  const id = element.$['r:id'];
}

// ✅ CORRECT - Matches parser config
if (element['@_r:id']) {
  const id = element['@_r:id'];
}
```

**Root Cause Check:**

```javascript
// Verify parser configuration
console.log(xmlParser.options.attributeNamePrefix); // Should be '@_'
```

---

### Pitfall 3: Missing Relationship Types

**Problem:** Only processing external hyperlinks, ignoring internal bookmarks.

```javascript
// ❌ INCOMPLETE - Misses internal links
if (rel['@_Type'] === 'http://.../hyperlink') {
  // Only external links
}

// ✅ COMPLETE - Handles all hyperlink types
const HYPERLINK_TYPES = [
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink',
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/bookmark',
];

if (HYPERLINK_TYPES.includes(rel['@_Type'])) {
  // Both external and internal links
}
```

---

### Pitfall 4: Destroying Text Node Attributes

**Problem:** Deleting or replacing text nodes loses critical `xml:space` attribute.

```xml
<!-- Before: Text with preserved spacing -->
<w:t xml:space="preserve">  Display Text  </w:t>

<!-- After broken mutation: Spacing lost -->
<w:t>Display Text</w:t>
```

```javascript
// ❌ BROKEN - Loses xml:space
delete run['w:t']; // Deletes entire node
run['w:t'] = newText; // String without attributes

// ✅ CORRECT - Preserves attributes
const textNode = run['w:t'];
if (textNode && textNode['#text']) {
  textNode['#text'] = newText; // Update text, keep '@_xml:space'
}
```

---

### Pitfall 5: Missing XML Declaration

**Problem:** Saving XML without `<?xml version="1.0"?>` declaration.

```javascript
// ❌ BROKEN - Missing declaration
const xmlString = xmlBuilder.build(xmlObj);
zip.file('word/document.xml', xmlString);

// ✅ CORRECT - Ensure declaration
const xmlString = xmlBuilder.build(xmlObj);
const xmlWithDeclaration = xmlString.startsWith('<?xml')
  ? xmlString
  : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + xmlString;

zip.file('word/document.xml', xmlWithDeclaration);
```

---

## Code Smell Detection

### How to Spot Broken Attribute Access

When reviewing or debugging OOXML processing code, watch for these RED FLAGS that indicate parser configuration mismatch:

#### ❌ RED FLAGS - Code that will FAIL

```javascript
// WRONG: Using $ accessor (from xml2js parser)
if (element.$) { ... }
if (element.$['r:id']) { ... }
const value = obj.$.attribute;
const type = rel.$.Type;
rel.$.Target = newUrl;  // Assignment will fail silently

// WRONG: Using ._ for text (from xml2js parser)
const text = textNode._;
textNode._ = newValue;
```

**Why these fail:** The project uses `fast-xml-parser` with `attributeNamePrefix: '@_'` configuration, not `xml2js` which uses `.$`.

#### ✅ GREEN LIGHT - Code that WORKS

```javascript
// CORRECT: Using @_ prefix (matches fast-xml-parser config)
if (element['@_r:id']) { ... }
const value = obj['@_attributeName'];
const type = rel['@_Type'];
rel['@_Target'] = newUrl;  // Works correctly

// CORRECT: Using #text for text (matches parser config)
const text = textNode['#text'];
textNode['#text'] = newValue;
```

### Quick Test: Does Your Code Use the Right Pattern?

**Search your code for these patterns:**

| Pattern             | Status     | Action                   |
| ------------------- | ---------- | ------------------------ |
| `\.$\[`             | ❌ WRONG   | Replace with `['@_xxx']` |
| `\._` (text access) | ❌ WRONG   | Replace with `['#text']` |
| `\['@_`             | ✅ CORRECT | Keep this pattern        |
| `\['#text'\]`       | ✅ CORRECT | Keep this pattern        |

**Rule of Thumb:** If you see `.$` or `._` anywhere in OOXML code, it's probably wrong and needs to be fixed.

### Automated Code Smell Detection

Use grep/ripgrep to find potential issues:

```bash
# Find all $ accessor usage (likely broken)
grep -r "\.\$\[" src/services/

# Find all ._ text node usage (likely broken)
grep -r "\._" src/services/ | grep -v "// CORRECT"

# Find correct @_ usage (for comparison)
grep -r "'\@_" src/services/
```

### Example: Debugging 100% Failure Rate

**Symptoms:**

- Hyperlink extraction returns empty array []
- Relationship updates don't apply
- No error messages in console
- TypeScript compiles successfully

**Diagnosis:**

```javascript
// Debug code to check parser output
const parsedXml = xmlParser.parse(xmlString);
console.log(JSON.stringify(parsedXml, null, 2));

// If you see:
{
  "w:hyperlink": {
    "@_r:id": "rId5",  // ✅ Attributes have @_ prefix
    "w:r": { ... }
  }
}

// But your code uses:
if (hyperlink.$['r:id']) {  // ❌ Wrong accessor
  // This will NEVER execute because hyperlink.$ is undefined
}

// FIX: Change to correct accessor
if (hyperlink['@_r:id']) {  // ✅ Matches parsed structure
  // Now this works!
}
```

### Prevention: Use Utility Functions

To prevent future accessor bugs, use these helper functions:

```typescript
/**
 * Safely get XML attribute value (matches parser config @_ prefix)
 */
function getAttr(element: any, attrName: string): string | undefined {
  return element?.[`@_${attrName}`];
}

/**
 * Safely set XML attribute value
 */
function setAttr(element: any, attrName: string, value: string): void {
  if (!element) return;
  element[`@_${attrName}`] = value;
}

/**
 * Safely get text node value (matches parser config #text)
 */
function getText(textNode: any): string {
  if (typeof textNode === 'string') return textNode;
  return textNode?.['#text'] || '';
}

/**
 * Safely set text node value, preserving attributes like xml:space
 */
function setText(textNode: any, newText: string): void {
  if (!textNode) return;
  if (typeof textNode === 'string') {
    throw new Error('Cannot modify string text node - use object with #text property');
  }
  textNode['#text'] = newText;
}
```

**Usage:**

```javascript
// Instead of: const id = hyperlink.$['r:id'];
const id = getAttr(hyperlink, 'r:id');

// Instead of: rel.$.Target = newUrl;
setAttr(rel, 'Target', newUrl);

// Instead of: const text = textNode._;
const text = getText(textNode);

// Instead of: textNode._ = newText;
setText(textNode, newText);
```

---

## Code Examples

### Example 1: Safely Update Hyperlink URL

```javascript
/**
 * Update hyperlink URL without creating orphaned relationships
 */
async function updateHyperlinkUrl(doc, relationshipId, newUrl) {
  // Step 1: Find the relationship in the relationships file
  const relsFile = doc.getRelsFile('word/_rels/document.xml.rels');
  const relsXml = await parseXml(relsFile);

  // Step 2: Find the specific relationship by ID
  const relationships = Array.isArray(relsXml.Relationships.Relationship)
    ? relsXml.Relationships.Relationship
    : [relsXml.Relationships.Relationship];

  const relationship = relationships.find((r) => r['@_Id'] === relationshipId);

  if (!relationship) {
    throw new Error(`Relationship ${relationshipId} not found`);
  }

  // Step 3: Update the Target URL (keep same ID)
  relationship['@_Target'] = newUrl;

  // Step 4: Save relationships file
  await saveXml(relsFile, relsXml);

  // The hyperlink element in document.xml is unchanged - still references same r:id
}
```

---

### Example 2: Extract All Hyperlinks with Locations

```javascript
/**
 * Extract hyperlinks from all document parts
 */
async function extractAllHyperlinks(docxPath) {
  const zip = await JSZip.loadAsync(fs.readFileSync(docxPath));
  const hyperlinks = [];

  // Define parts to search
  const parts = [
    { xml: 'word/document.xml', rels: 'word/_rels/document.xml.rels', location: 'Main Document' },
    { xml: 'word/header1.xml', rels: 'word/_rels/header1.xml.rels', location: 'Header 1' },
    { xml: 'word/footer1.xml', rels: 'word/_rels/footer1.xml.rels', location: 'Footer 1' },
  ];

  for (const part of parts) {
    const xmlFile = zip.file(part.xml);
    const relsFile = zip.file(part.rels);

    if (!xmlFile || !relsFile) continue;

    const xmlContent = await parseXml(await xmlFile.async('string'));
    const relsContent = await parseXml(await relsFile.async('string'));

    // Find hyperlinks in XML
    const foundLinks = findHyperlinks(xmlContent);

    // Enrich with URL from relationships
    for (const link of foundLinks) {
      const relationships = Array.isArray(relsContent.Relationships.Relationship)
        ? relsContent.Relationships.Relationship
        : [relsContent.Relationships.Relationship];

      const rel = relationships.find((r) => r['@_Id'] === link.relationshipId);

      if (rel) {
        hyperlinks.push({
          id: link.relationshipId,
          displayText: link.displayText,
          url: rel['@_Target'],
          location: part.location,
          partName: part.xml,
        });
      }
    }
  }

  return hyperlinks;
}
```

---

### Example 3: Safe Text Replacement in Hyperlinks

```javascript
/**
 * Update hyperlink display text while preserving all formatting
 */
function updateHyperlinkText(hyperlinkElement, newText) {
  // Find first run with text
  const runs = Array.isArray(hyperlinkElement['w:r'])
    ? hyperlinkElement['w:r']
    : [hyperlinkElement['w:r']];

  let firstTextRun = null;

  for (const run of runs) {
    if (run['w:t']) {
      firstTextRun = run;
      break;
    }
  }

  if (!firstTextRun) {
    // No text runs found, create one
    const newRun = {
      'w:t': {
        '@_xml:space': 'preserve',
        '#text': newText,
      },
    };
    hyperlinkElement['w:r'] = [newRun];
    return;
  }

  // Update text in first run, preserve attributes
  const textNode = firstTextRun['w:t'];

  if (typeof textNode === 'string') {
    // Convert string to object with attributes
    firstTextRun['w:t'] = {
      '@_xml:space': 'preserve',
      '#text': newText,
    };
  } else if (textNode && typeof textNode === 'object') {
    // Update text content, keep all attributes
    textNode['#text'] = newText;
  }

  // Clear text from subsequent runs (but keep run formatting)
  for (let i = 1; i < runs.length; i++) {
    if (runs[i]['w:t']) {
      // Keep run properties (bold, italic, etc.) but remove text
      const textNode = runs[i]['w:t'];
      if (typeof textNode === 'object' && textNode['#text']) {
        textNode['#text'] = '';
      } else {
        runs[i]['w:t'] = {
          '@_xml:space': 'preserve',
          '#text': '',
        };
      }
    }
  }
}
```

---

### Example 4: Add New Hyperlink with Proper Relationship

```javascript
/**
 * Add a new hyperlink with proper two-part system
 */
async function addHyperlink(doc, paragraphElement, url, displayText) {
  // Step 1: Generate unique relationship ID
  const existingIds = doc.getAllRelationshipIds();
  let newId = 'rId' + (existingIds.length + 1);
  while (existingIds.includes(newId)) {
    newId = 'rId' + (parseInt(newId.slice(3)) + 1);
  }

  // Step 2: Add relationship to .rels file
  const relsFile = doc.getRelsFile('word/_rels/document.xml.rels');
  const relsXml = await parseXml(relsFile);

  if (!relsXml.Relationships.Relationship) {
    relsXml.Relationships.Relationship = [];
  }

  const relationships = Array.isArray(relsXml.Relationships.Relationship)
    ? relsXml.Relationships.Relationship
    : [relsXml.Relationships.Relationship];

  relationships.push({
    '@_Id': newId,
    '@_Type': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink',
    '@_Target': url,
    '@_TargetMode': 'External',
  });

  relsXml.Relationships.Relationship = relationships;
  await saveXml(relsFile, relsXml);

  // Step 3: Add hyperlink element to paragraph
  const hyperlinkElement = {
    '@_r:id': newId, // Reference the relationship
    'w:r': {
      'w:rPr': {
        'w:rStyle': { '@_w:val': 'Hyperlink' }, // Apply hyperlink style
      },
      'w:t': {
        '@_xml:space': 'preserve',
        '#text': displayText,
      },
    },
  };

  // Add to paragraph
  if (!paragraphElement['w:hyperlink']) {
    paragraphElement['w:hyperlink'] = hyperlinkElement;
  } else {
    const existing = Array.isArray(paragraphElement['w:hyperlink'])
      ? paragraphElement['w:hyperlink']
      : [paragraphElement['w:hyperlink']];

    existing.push(hyperlinkElement);
    paragraphElement['w:hyperlink'] = existing;
  }

  return newId;
}
```

---

## Validation Checklist

### Before Saving Document

- [ ] **XML Declaration Present**: All XML files start with `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
- [ ] **Relationship Integrity**: Every `r:id` in document.xml has matching `Id` in .rels file
- [ ] **No Orphaned Relationships**: Every relationship in .rels is referenced by at least one element
- [ ] **Attribute Prefixes Consistent**: Using `@_` prefix for all attribute access
- [ ] **Text Node Attributes Preserved**: `xml:space="preserve"` maintained on text nodes
- [ ] **Namespace Declarations**: Root elements have proper `xmlns` attributes
- [ ] **TargetMode Specified**: External hyperlinks have `TargetMode="External"`
- [ ] **Valid URLs**: All hyperlink targets are valid URLs or internal anchors
- [ ] **Escaped Special Characters**: Ampersands, quotes properly escaped in URLs

### Hyperlink-Specific Validation

```javascript
/**
 * Validate hyperlink integrity
 */
function validateHyperlinks(documentXml, relsXml) {
  const issues = [];

  // Extract all hyperlink relationship IDs from document
  const hyperlinks = findHyperlinks(documentXml);
  const documentRIds = new Set(hyperlinks.map((h) => h.relationshipId));

  // Extract all relationship IDs from .rels file
  const relationships = Array.isArray(relsXml.Relationships.Relationship)
    ? relsXml.Relationships.Relationship
    : [relsXml.Relationships.Relationship];

  const relsIds = new Set(
    relationships.filter((r) => r['@_Type'].includes('/hyperlink')).map((r) => r['@_Id'])
  );

  // Check for orphaned relationships (in .rels but not in document)
  for (const relsId of relsIds) {
    if (!documentRIds.has(relsId)) {
      issues.push({
        type: 'orphaned_relationship',
        severity: 'warning',
        id: relsId,
        message: `Relationship ${relsId} exists but is not referenced in document`,
      });
    }
  }

  // Check for missing relationships (in document but not in .rels)
  for (const docId of documentRIds) {
    if (!relsIds.has(docId)) {
      issues.push({
        type: 'missing_relationship',
        severity: 'error',
        id: docId,
        message: `Hyperlink references ${docId} but relationship not found`,
      });
    }
  }

  // Validate URLs
  for (const rel of relationships) {
    if (rel['@_Type'].includes('/hyperlink')) {
      const url = rel['@_Target'];

      if (!url) {
        issues.push({
          type: 'empty_url',
          severity: 'error',
          id: rel['@_Id'],
          message: `Relationship ${rel['@_Id']} has empty Target`,
        });
      } else if (url.startsWith('http') && !rel['@_TargetMode']) {
        issues.push({
          type: 'missing_target_mode',
          severity: 'error',
          id: rel['@_Id'],
          message: `External URL missing TargetMode="External"`,
        });
      }
    }
  }

  return issues;
}
```

---

## Additional Resources

### Official Documentation

- **ECMA-376 Standard**: [Office Open XML File Formats](https://www.ecma-international.org/publications-and-standards/standards/ecma-376/)
- **Microsoft Office Dev Center**: [Open XML SDK Documentation](https://docs.microsoft.com/en-us/office/open-xml/open-xml-sdk)
- **WordprocessingML Reference**: [Structure of WordprocessingML](https://docs.microsoft.com/en-us/office/open-xml/structure-of-a-wordprocessingml-document)

### Technical References

- **Namespace Registry**: [Office Open XML Namespaces](http://officeopenxml.com/anatomyofOOXML.php)
- **Relationship Types**: [Complete Relationship Type List](http://officeopenxml.com/anatomyofOOXML-relationships.php)
- **Hyperlink Specification**: [WordprocessingML Hyperlinks](http://www.datypic.com/sc/ooxml/e-w_hyperlink-1.html)

### Tools

- **Open XML SDK Productivity Tool**: Validate and explore OOXML structure
- **7-Zip**: Inspect .docx file contents as ZIP archive
- **XML Notepad**: View and edit XML files with validation

---

## Conclusion

Understanding the Office Open XML hyperlink architecture is essential for document processing:

1. **Two-Part System is Mandatory**: Document elements reference relationships via `r:id`
2. **Relationship Integrity is Critical**: Every `r:id` must have a matching relationship
3. **Attribute Prefixes Must Match**: Parser and builder configurations must align
4. **Preserve XML Structure**: Don't destroy attributes when updating text
5. **Validate Before Saving**: Check for orphaned relationships and missing references

**Golden Rule:** When modifying hyperlinks, **update the relationship Target, never create new relationships** unless adding entirely new hyperlinks.

Following these principles ensures your document processing code produces valid, uncorrupted OOXML documents.

---

_This document is maintained as part of the Documentation Hub project. For questions or corrections, please refer to the project repository._
