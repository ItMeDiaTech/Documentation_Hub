## Problem Description

**Type:** Bug / Data Integrity
**Priority:** Critical
**Impact:** DOCX documents become corrupted and unreadable after processing
**Root Cause:** Violations of Office Open XML (OOXML) specification during programmatic editing

DOCX files are ZIP archives containing multiple XML files with strict structural requirements. When code modifies these files without adhering to the OOXML specification, it can result in corrupted documents that won't open in Microsoft Word or other applications.

## Background: OOXML Architecture

Based on project documentation ([`OOXML_HYPERLINK_ARCHITECTURE.md`](../OOXML_HYPERLINK_ARCHITECTURE.md) and [`docxmlater-functions-and-structure.md`](../docxmlater-functions-and-structure.md)):

### Document Structure

A `.docx` file is a ZIP archive containing:

```
document.docx
├── [Content_Types].xml
├── _rels/.rels
├── word/
│   ├── document.xml        # Main content
│   ├── _rels/
│   │   └── document.xml.rels  # Relationships (hyperlinks, images, etc.)
│   ├── styles.xml
│   ├── numbering.xml
│   └── fontTable.xml
└── docProps/
    ├── core.xml
    └── app.xml
```

### Critical Rules for OOXML Compliance

**1. XML Namespace Requirements**

| Prefix | Namespace                                                             | Purpose          | Example                     |
| ------ | --------------------------------------------------------------------- | ---------------- | --------------------------- |
| `w:`   | `http://schemas.openxmlformats.org/wordprocessingml/2006/main`        | Document content | `<w:p>`, `<w:r>`, `<w:t>`   |
| `r:`   | `http://schemas.openxmlformats.org/officeDocument/2006/relationships` | Relationships    | `<w:hyperlink r:id="rId5">` |

**Violation Example:**

```xml
<!-- WRONG - Missing namespace prefix -->
<hyperlink r:id="rId5">
  <t>Click here</t>
</hyperlink>

<!-- CORRECT -->
<w:hyperlink r:id="rId5">
  <w:r>
    <w:t>Click here</w:t>
  </w:r>
</w:hyperlink>
```

**2. Two-Part Hyperlink System**

Every hyperlink requires TWO parts that must stay synchronized:

**Part 1: Content in `word/document.xml`**

```xml
<w:hyperlink r:id="rId5">
  <w:r>
    <w:rPr>
      <w:rStyle w:val="Hyperlink"/>
    </w:rPr>
    <w:t>Link Text</w:t>
  </w:r>
</w:hyperlink>
```

**Part 2: Relationship in `word/_rels/document.xml.rels`**

```xml
<Relationship Id="rId5"
  Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink"
  Target="https://example.com"
  TargetMode="External" />
```

**Common Corruption Causes:**

- **Orphaned Relationships:** `r:id` in document.xml has no matching relationship
- **Missing Relationships:** Hyperlink exists but relationship file not updated
- **Duplicate IDs:** Two different hyperlinks use same `r:id`
- **Wrong Relationship Type:** Using wrong `Type` attribute

**3. XML Structure Integrity**

Documents must maintain proper nesting:

```xml
<!-- CORRECT Structure -->
<w:p>                      <!-- Paragraph -->
  <w:pPr>                  <!-- Paragraph properties -->
    <w:pStyle w:val="Normal"/>
  </w:pPr>
  <w:r>                    <!-- Run (text container) -->
    <w:rPr>                <!-- Run properties -->
      <w:b/>               <!-- Bold -->
    </w:rPr>
    <w:t>Text</w:t>       <!-- Text -->
  </w:r>
</w:p>
```

**Violation Example:**

```xml
<!-- WRONG - Run properties outside run -->
<w:p>
  <w:rPr>
    <w:b/>
  </w:rPr>
  <w:t>Text</w:t>         <!-- Text not wrapped in run -->
</w:p>
```

## Required Investigation

### 1. Review All DOCX Manipulation Code

Examine all files that modify DOCX/XML structures:

**Identified Files (from project structure):**

- `src/services/document/DocumentProcessingComparison.ts`
- `src/services/HyperlinkService.ts`
- `electron/services/HyperlinkProcessor.ts`
- Any code using JSZip or xml2js to modify document.xml

**Check For:**

- [ ] Proper XML namespace usage (`w:`, `r:`, etc.)
- [ ] Synchronization between document.xml and document.xml.rels
- [ ] Correct element nesting (p → r → t)
- [ ] Relationship ID uniqueness
- [ ] Proper attribute escaping (XML special characters)

### 2. Validate Against OOXML Specification

**Key Documentation References:**

- Project: [`OOXML_HYPERLINK_ARCHITECTURE.md`](../OOXML_HYPERLINK_ARCHITECTURE.md)
- Project: [`docxmlater-functions-and-structure.md`](../docxmlater-functions-and-structure.md)
- External: [ECMA-376 Office Open XML Specification](http://www.ecma-international.org/publications/standards/Ecma-376.htm)

**Validation Checklist:**

- [ ] All hyperlinks have matching relationships
- [ ] No orphaned relationship IDs
- [ ] XML namespaces declared in root element
- [ ] Content-Type entries exist for all parts
- [ ] No duplicate relationship IDs across all .rels files

### 3. Implement Corruption Detection

Add validation before saving documents:

```typescript
// Proposed validation function
async function validateDocumentIntegrity(zipFile: JSZip): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Load main document and relationships
  const documentXml = await zipFile.file('word/document.xml')?.async('text');
  const relsXml = await zipFile.file('word/_rels/document.xml.rels')?.async('text');

  if (!documentXml || !relsXml) {
    errors.push('Missing required files: document.xml or document.xml.rels');
    return { valid: false, errors, warnings };
  }

  // Parse XML
  const doc = parseXML(documentXml);
  const rels = parseXML(relsXml);

  // Check 1: Validate all hyperlink r:id references exist in relationships
  const hyperlinkIds = extractHyperlinkIds(doc);
  const relationshipIds = extractRelationshipIds(rels);

  for (const id of hyperlinkIds) {
    if (!relationshipIds.has(id)) {
      errors.push(`Orphaned hyperlink: r:id="${id}" has no matching relationship`);
    }
  }

  // Check 2: Validate XML namespace declarations
  const requiredNamespaces = [
    'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
    'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  ];

  for (const ns of requiredNamespaces) {
    if (!documentXml.includes(ns)) {
      warnings.push(`Missing namespace declaration: ${ns}`);
    }
  }

  // Check 3: Validate element structure
  const structureErrors = validateElementNesting(doc);
  errors.push(...structureErrors);

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
```

### 4. Add Pre-Save Backup

Implement automatic backup before modifications:

```typescript
// Proposed safety mechanism
async function processDocumentSafely(filePath: string, operations: Operation[]): Promise<void> {
  // Create backup
  const backupPath = `${filePath}.backup`;
  await fs.copyFile(filePath, backupPath);

  try {
    // Perform modifications
    await modifyDocument(filePath, operations);

    // Validate result
    const zip = await JSZip.loadAsync(fs.readFileSync(filePath));
    const validation = await validateDocumentIntegrity(zip);

    if (!validation.valid) {
      // Restore from backup
      await fs.copyFile(backupPath, filePath);
      throw new Error(`Document corruption detected: ${validation.errors.join(', ')}`);
    }

    // Success - remove backup
    await fs.unlink(backupPath);
  } catch (error) {
    // Restore from backup on any error
    await fs.copyFile(backupPath, filePath);
    throw error;
  }
}
```

## Common Corruption Scenarios

Based on OOXML documentation, these are the most frequent causes:

### Scenario 1: Hyperlink Content ID Appending

**Problem:** Adding `_content` to hyperlink IDs without updating relationships

**Bad Code:**

```typescript
// Modifies document.xml hyperlink
hyperlink.setAttribute('r:id', `${originalId}_content`);
// But doesn't create new relationship in document.xml.rels!
```

**Fix:**

```typescript
// 1. Create new relationship
const newRelId = await addRelationship(relsXml, {
  type: 'hyperlink',
  target: originalTarget + '#_content',
  targetMode: 'External',
});

// 2. Update hyperlink reference
hyperlink.setAttribute('r:id', newRelId);
```

### Scenario 2: Text Replacement Breaking Structure

**Problem:** Replacing text without maintaining run structure

**Bad Code:**

```typescript
textNode.textContent = newText; // Loses formatting
```

**Fix:**

```typescript
// Preserve run structure
const run = textNode.closest('w:r');
const newRun = createRun(newText, {
  bold: run.querySelector('w:b') !== null,
  italic: run.querySelector('w:i') !== null,
  // ... copy all formatting
});
run.replaceWith(newRun);
```

### Scenario 3: Namespace Loss During Parsing

**Problem:** XML parser strips namespaces

**Bad Code:**

```typescript
const xml2js = require('xml2js');
const parser = new xml2js.Parser(); // Default settings strip namespaces!
```

**Fix:**

```typescript
const parser = new xml2js.Parser({
  xmlns: true, // Preserve namespaces
  explicitArray: false,
  preserveChildrenOrder: true,
});
```

## Acceptance Criteria

- [ ] All DOCX manipulation code reviewed for OOXML compliance
- [ ] Document validation added before every save operation
- [ ] Automatic backup/restore implemented
- [ ] Test suite includes corrupted document detection
- [ ] Corruption errors logged with specific violation details
- [ ] All hyperlink modifications maintain two-part system integrity
- [ ] XML namespaces properly preserved during parsing/serialization
- [ ] Element nesting validated (p → r → t structure)
- [ ] No orphaned relationships remain after processing
- [ ] Processed documents open successfully in Microsoft Word

## Testing Strategy

**1. Corruption Detection Tests**

```typescript
describe('Document Integrity', () => {
  it('should detect orphaned hyperlink IDs', async () => {
    const doc = createDocumentWithOrphanedHyperlink();
    const validation = await validateDocumentIntegrity(doc);
    expect(validation.valid).toBe(false);
    expect(validation.errors).toContain('Orphaned hyperlink');
  });

  it('should detect missing namespaces', async () => {
    const doc = createDocumentWithoutNamespaces();
    const validation = await validateDocumentIntegrity(doc);
    expect(validation.warnings).toContain('Missing namespace declaration');
  });
});
```

**2. Round-Trip Tests**

```typescript
it('should maintain document integrity after processing', async () => {
  const original = await loadDocument('test.docx');
  await processDocument(original, operations);
  const processed = await loadDocument('test.docx');

  // Document should still open in Word
  const validation = await validateDocumentIntegrity(processed);
  expect(validation.valid).toBe(true);
});
```

**3. Real-World Document Tests**

- Test with documents containing complex structures (tables, images, TOC)
- Test with large documents (100+ pages)
- Test with documents from different Word versions (2007, 2013, 2016, 2019, 365)

## Estimated Effort

**Phase 1: Investigation** (4 hours)

- Audit all DOCX manipulation code
- Identify current violation patterns
- Document specific corruption scenarios

**Phase 2: Implementation** (8 hours)

- Add document validation function
- Implement backup/restore mechanism
- Fix identified OOXML violations

**Phase 3: Testing** (4 hours)

- Create corruption detection test suite
- Run round-trip tests on sample documents
- Validate against Word compatibility

**Total: 16 hours**

## References

- [`OOXML_HYPERLINK_ARCHITECTURE.md`](../OOXML_HYPERLINK_ARCHITECTURE.md) - Project's OOXML technical documentation
- [`docxmlater-functions-and-structure.md`](../docxmlater-functions-and-structure.md) - DOCX manipulation API reference
- [ECMA-376 Standard](http://www.ecma-international.org/publications/standards/Ecma-376.htm) - Official Office Open XML specification
- [Microsoft Office Dev Center](https://docs.microsoft.com/en-us/office/open-xml/structure-of-a-wordprocessingml-document) - OOXML structure guide
