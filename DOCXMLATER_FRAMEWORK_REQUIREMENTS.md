# DocXMLater Framework Requirements

## Overview

To completely replace JSZip, fast-xml-parser, and other third-party XML/ZIP libraries, the DocXMLater framework needs to implement the following methods and capabilities. These requirements were identified during the refactoring process to eliminate external dependencies.

## 1. XML Operations

### 1.1 Raw XML Access

```typescript
// Get raw XML content from any document part
document.getRawXml(partName: string): Promise<string>
// Example: doc.getRawXml('word/document.xml')
// Example: doc.getRawXml('word/styles.xml')

// Set raw XML content in any document part
document.setRawXml(partName: string, xml: string): Promise<void>
// Example: doc.setRawXml('word/styles.xml', fixedXmlString)
```

**Purpose**: Direct access to XML strings for validation and string-based fixes without parsing overhead.

### 1.2 XML Parsing and Building

```typescript
// Parse XML string to JavaScript object
document.parseXml(xml: string): any
// Should handle Office Open XML namespaces correctly

// Build XML string from JavaScript object
document.buildXml(obj: any): string
// Should maintain Office Open XML structure and namespaces
```

**Purpose**: When we need to work with parsed XML structures, avoiding fast-xml-parser.

### 1.3 Relationship Management

```typescript
// Get relationships for a document part
document.getRelationships(partName?: string): Promise<Relationship[]>
// Example: doc.getRelationships('word/document.xml')

// Add a new relationship
document.addRelationship(partName: string, rel: Relationship): Promise<string>
// Returns the generated relationship ID

// Update an existing relationship
document.updateRelationship(partName: string, relId: string, updates: Partial<Relationship>): Promise<void>

// Remove a relationship
document.removeRelationship(partName: string, relId: string): Promise<void>

interface Relationship {
  Id: string;
  Type: string;
  Target: string;
  TargetMode?: 'Internal' | 'External';
}
```

**Purpose**: Manage hyperlink relationships without needing to parse/rebuild .rels files.

## 2. Document Package Operations

### 2.1 Part Management

```typescript
// Get any part from the document package
document.getPart(partName: string): Promise<DocumentPart>
// Example: doc.getPart('word/numbering.xml')

// Set/update any part in the document package
document.setPart(partName: string, content: string | Buffer): Promise<void>

// Remove a part from the document package
document.removePart(partName: string): Promise<void>

// Check if a part exists
document.partExists(partName: string): Promise<boolean>

// List all parts in the package
document.listParts(): Promise<string[]>

interface DocumentPart {
  name: string;
  content: string | Buffer;
  contentType?: string;
  compression?: boolean;
}
```

**Purpose**: Complete control over document package structure, eliminating JSZip dependency.

### 2.2 Content Types Management

```typescript
// Get all content type definitions
document.getContentTypes(): Promise<Map<string, string>>

// Register a new content type
document.addContentType(partName: string, contentType: string): Promise<void>

// Remove a content type
document.removeContentType(partName: string): Promise<void>
```

**Purpose**: Manage [Content_Types].xml without manual XML manipulation.

## 3. Style Operations

### 3.1 Style Validation

```typescript
// Get all style definitions
document.getStyles(): Style[]

// Validate a style definition
style.isValid(): boolean

// Remove a style
document.removeStyle(styleId: string): void

// Update an existing style
document.updateStyle(styleId: string, properties: StyleProperties): void

// Get raw styles.xml content (for string-based validation)
document.getStylesXml(): Promise<string>

// Set raw styles.xml content (for string-based fixes)
document.setStylesXml(xml: string): Promise<void>
```

**Purpose**: Complete style management and validation capabilities.

### 3.2 Style Creation (Already Exists)

```typescript
// These already exist in DocXMLater
Style.create(properties: StyleDefinition): Style
document.addStyle(style: Style): void
```

## 4. Hyperlink Operations

### 4.1 URL Updates (Already Implemented)

```typescript
// Already exists in DocXMLater
hyperlink.setUrl(newUrl: string): void
hyperlink.getUrl(): string
hyperlink.setText(newText: string): void
hyperlink.getText(): string
```

### 4.2 Relationship-Aware Operations (Needed)

```typescript
// Get the relationship ID for a hyperlink
hyperlink.getRelationshipId(): string

// Update hyperlink with new relationship ID
hyperlink.setRelationshipId(relId: string): void

// Create external hyperlink with proper relationship
Hyperlink.createExternalWithRelationship(url: string, text: string): Promise<Hyperlink>
// Should automatically create and register the relationship
```

**Purpose**: Maintain two-part hyperlink system integrity.

## 5. Document Creation and Loading

### 5.1 Enhanced Loading (Partially Exists)

```typescript
// These already exist
Document.load(filePath: string): Promise<Document>
Document.loadFromBuffer(buffer: Buffer): Promise<Document>

// Needed: Create empty document structure
Document.createEmpty(): Document
// Should create minimal valid DOCX structure
```

### 5.2 Buffer Operations (Already Exists)

```typescript
// Already exists
document.toBuffer(): Promise<Buffer>
document.save(filePath: string): Promise<void>
```

## 6. Validation Capabilities

### 6.1 Structure Validation

```typescript
// Validate document structure
document.validate(): ValidationResult

// Validate specific part
document.validatePart(partName: string): ValidationResult

interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}
```

**Purpose**: Built-in validation without external validators.

## 7. Low-Level Access

### 7.1 Internal ZIP Access (Temporary)

Until all methods above are implemented, temporary access to internal ZIP structure:

```typescript
// Temporary property access
document._zip or document.zip
// Should be removed once all methods above are implemented
```

## Implementation Priority

### Phase 1 - Critical (Blocks refactoring)
1. `getRawXml()` - Needed for validation
2. `setRawXml()` - Needed for fixes
3. `getPart()` / `setPart()` - Package manipulation
4. `getRelationships()` - Hyperlink validation

### Phase 2 - Important (Improves functionality)
5. `parseXml()` / `buildXml()` - Replace fast-xml-parser
6. `listParts()` / `partExists()` - Package inspection
7. `getContentTypes()` - Content type management
8. Style validation methods

### Phase 3 - Nice to Have (Completes framework)
9. `Document.createEmpty()` - Document creation
10. `validate()` / `validatePart()` - Built-in validation
11. Relationship management methods
12. Content type management methods

## Benefits After Implementation

1. **Zero External Dependencies**: No JSZip, fast-xml-parser, or xml2js needed
2. **Better Performance**: Direct API calls instead of parsing/rebuilding
3. **Type Safety**: Full TypeScript support throughout
4. **Simplified Architecture**: Single framework for all operations
5. **Reduced Bundle Size**: ~200KB less in dependencies
6. **Easier Maintenance**: Single codebase to maintain

## Migration Path

1. Implement Phase 1 methods in DocXMLater
2. Test with existing documents
3. Switch imports from old validators to new
4. Remove old files and dependencies
5. Update documentation

## Example Usage After Implementation

```typescript
import { Document } from 'docxmlater';

// Load document
const doc = await Document.load('document.docx');

// Direct XML access
const stylesXml = await doc.getRawXml('word/styles.xml');
const fixedXml = stylesXml.replace(/>>/g, '>');
await doc.setRawXml('word/styles.xml', fixedXml);

// Relationship management
const rels = await doc.getRelationships('word/document.xml');
for (const rel of rels) {
  if (rel.Type.includes('hyperlink') && !rel.TargetMode) {
    await doc.updateRelationship('word/document.xml', rel.Id, {
      TargetMode: 'External'
    });
  }
}

// Validation
const result = await doc.validate();
if (!result.valid) {
  console.log('Validation errors:', result.errors);
}

// Save corrected document
await doc.save('fixed.docx');
```

## Notes for Implementation

1. **String-based operations** are critical - avoid parse/rebuild cycles that corrupt documents
2. **Maintain backward compatibility** with existing DocXMLater API
3. **Use TypeScript** for all new methods with proper types
4. **Add comprehensive error handling** with meaningful messages
5. **Include debug logging** using the existing logger system
6. **Write unit tests** for each new method

## Conclusion

Once these methods are implemented in the DocXMLater framework, the entire document processing system can operate without any external XML or ZIP libraries. This will result in a cleaner, more maintainable, and more performant codebase.