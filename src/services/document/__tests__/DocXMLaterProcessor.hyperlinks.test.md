# Test Cases for Enhanced Hyperlink Processing

**Status:** To Be Implemented
**Related Issue:** #004 - Implement docXMLater Built-in Hyperlink Functions

## Test Coverage Needed

### 1. Hyperlinks in Tables

```typescript
describe('DocXMLaterProcessor - Table Hyperlinks', () => {
  it('should extract hyperlinks from table cells', async () => {
    // Create document with table containing hyperlinks
    const doc = Document.create();
    const table = doc.createTable(2, 2);
    const cell = table.getCell(0, 0);
    const para = cell?.createParagraph();
    para?.addHyperlink(Hyperlink.createExternal('https://example.com', 'Link'));

    // Extract
    const processor = new DocXMLaterProcessor();
    const hyperlinks = await processor.extractHyperlinks(doc);

    // Verify
    expect(hyperlinks).toHaveLength(1);
    expect(hyperlinks[0].url).toBe('https://example.com');
    expect(hyperlinks[0].text).toBe('Link');
  });

  it('should update URLs in table cells', async () => {
    // Create document with table hyperlinks
    const doc = Document.create();
    const table = doc.createTable(1, 1);
    const cell = table.getCell(0, 0);
    const para = cell?.createParagraph();
    para?.addHyperlink(Hyperlink.createExternal('https://old.com', 'Link'));

    // Update
    const processor = new DocXMLaterProcessor();
    const result = await processor.modifyHyperlinks(doc, (url) => url.replace('old', 'new'));

    // Verify
    expect(result.success).toBe(true);
    expect(result.data?.modifiedHyperlinks).toBe(1);

    // Extract and verify URL changed
    const hyperlinks = await processor.extractHyperlinks(doc);
    expect(hyperlinks[0].url).toBe('https://new.com');
  });
});
```

### 2. Hyperlinks in Headers

```typescript
describe('DocXMLaterProcessor - Header Hyperlinks', () => {
  it('should extract hyperlinks from headers', async () => {
    // Create document with header containing hyperlinks
    const doc = Document.create();
    const header = Header.create();
    const para = header.addParagraph();
    para.addHyperlink(Hyperlink.createExternal('https://header.com', 'Header Link'));
    doc.setHeader(header);

    // Extract
    const processor = new DocXMLaterProcessor();
    const hyperlinks = await processor.extractHyperlinks(doc);

    // Verify
    expect(hyperlinks).toHaveLength(1);
    expect(hyperlinks[0].url).toBe('https://header.com');
    expect(hyperlinks[0].text).toBe('Header Link');
  });

  it('should update URLs in headers', async () => {
    // Create document with header hyperlinks
    const doc = Document.create();
    const header = Header.create();
    const para = header.addParagraph();
    para.addHyperlink(Hyperlink.createExternal('https://old-header.com', 'Link'));
    doc.setHeader(header);

    // Update
    const processor = new DocXMLaterProcessor();
    const result = await processor.modifyHyperlinks(doc, (url) => url.replace('old', 'new'));

    // Verify
    expect(result.success).toBe(true);
    expect(result.data?.modifiedHyperlinks).toBe(1);
  });
});
```

### 3. Hyperlinks in Footers

```typescript
describe('DocXMLaterProcessor - Footer Hyperlinks', () => {
  it('should extract hyperlinks from footers', async () => {
    // Create document with footer containing hyperlinks
    const doc = Document.create();
    const footer = Footer.create();
    const para = footer.addParagraph();
    para.addHyperlink(Hyperlink.createExternal('https://footer.com', 'Footer Link'));
    doc.setFooter(footer);

    // Extract
    const processor = new DocXMLaterProcessor();
    const hyperlinks = await processor.extractHyperlinks(doc);

    // Verify
    expect(hyperlinks).toHaveLength(1);
    expect(hyperlinks[0].url).toBe('https://footer.com');
  });

  it('should update URLs in footers', async () => {
    // Create document with footer hyperlinks
    const doc = Document.create();
    const footer = Footer.create();
    const para = footer.addParagraph();
    para.addHyperlink(Hyperlink.createExternal('https://old-footer.com', 'Link'));
    doc.setFooter(footer);

    // Update
    const processor = new DocXMLaterProcessor();
    const result = await processor.modifyHyperlinks(doc, (url) => url.replace('old', 'new'));

    // Verify
    expect(result.success).toBe(true);
    expect(result.data?.modifiedHyperlinks).toBe(1);
  });
});
```

### 4. Comprehensive Coverage

```typescript
describe('DocXMLaterProcessor - Comprehensive Hyperlink Coverage', () => {
  it('should extract hyperlinks from all document parts', async () => {
    // Create document with hyperlinks in multiple locations
    const doc = Document.create();

    // Body hyperlink
    doc.createParagraph().addHyperlink(Hyperlink.createExternal('https://body.com', 'Body'));

    // Table hyperlink
    const table = doc.createTable(1, 1);
    const cell = table.getCell(0, 0);
    cell?.createParagraph().addHyperlink(Hyperlink.createExternal('https://table.com', 'Table'));

    // Header hyperlink
    const header = Header.create();
    header.addParagraph().addHyperlink(Hyperlink.createExternal('https://header.com', 'Header'));
    doc.setHeader(header);

    // Footer hyperlink
    const footer = Footer.create();
    footer.addParagraph().addHyperlink(Hyperlink.createExternal('https://footer.com', 'Footer'));
    doc.setFooter(footer);

    // Extract
    const processor = new DocXMLaterProcessor();
    const hyperlinks = await processor.extractHyperlinks(doc);

    // Verify all 4 hyperlinks found
    expect(hyperlinks).toHaveLength(4);
    expect(hyperlinks.map(h => h.url).sort()).toEqual([
      'https://body.com',
      'https://footer.com',
      'https://header.com',
      'https://table.com',
    ]);
  });

  it('should update URLs across all document parts in one operation', async () => {
    // Create document with hyperlinks in multiple locations
    const doc = Document.create();
    doc.createParagraph().addHyperlink(Hyperlink.createExternal('https://old1.com', 'Link 1'));
    doc.createParagraph().addHyperlink(Hyperlink.createExternal('https://old2.com', 'Link 2'));

    const table = doc.createTable(1, 1);
    const cell = table.getCell(0, 0);
    cell?.createParagraph().addHyperlink(Hyperlink.createExternal('https://old3.com', 'Link 3'));

    // Update all at once
    const processor = new DocXMLaterProcessor();
    const result = await processor.modifyHyperlinks(doc, (url) => url.replace('old', 'new'));

    // Verify all updated
    expect(result.success).toBe(true);
    expect(result.data?.modifiedHyperlinks).toBe(3);

    // Extract and verify all URLs changed
    const hyperlinks = await processor.extractHyperlinks(doc);
    expect(hyperlinks.every(h => h.url?.includes('new'))).toBe(true);
    expect(hyperlinks.every(h => !h.url?.includes('old'))).toBe(true);
  });
});
```

### 5. Performance Benchmarks

```typescript
describe('DocXMLaterProcessor - Performance', () => {
  it('should be faster than manual extraction for large documents', async () => {
    // Create document with 500 hyperlinks
    const doc = Document.create();
    for (let i = 0; i < 500; i++) {
      doc.createParagraph().addHyperlink(
        Hyperlink.createExternal(`https://example${i}.com`, `Link ${i}`)
      );
    }

    const processor = new DocXMLaterProcessor();

    // Measure extraction time
    const start = performance.now();
    const hyperlinks = await processor.extractHyperlinks(doc);
    const duration = performance.now() - start;

    // Verify
    expect(hyperlinks).toHaveLength(500);
    expect(duration).toBeLessThan(200); // Should be faster than 200ms
  });

  it('should be faster than manual updates for large documents', async () => {
    // Create document with 500 hyperlinks
    const doc = Document.create();
    for (let i = 0; i < 500; i++) {
      doc.createParagraph().addHyperlink(
        Hyperlink.createExternal(`https://old${i}.com`, `Link ${i}`)
      );
    }

    const processor = new DocXMLaterProcessor();

    // Measure update time
    const start = performance.now();
    const result = await processor.modifyHyperlinks(doc, (url) => url.replace('old', 'new'));
    const duration = performance.now() - start;

    // Verify
    expect(result.success).toBe(true);
    expect(result.data?.modifiedHyperlinks).toBe(500);
    expect(duration).toBeLessThan(250); // Should be faster than 250ms
  });
});
```

### 6. Error Handling

```typescript
describe('DocXMLaterProcessor - Error Handling', () => {
  it('should handle transform errors gracefully', async () => {
    const doc = Document.create();
    doc.createParagraph().addHyperlink(Hyperlink.createExternal('https://valid.com', 'Link'));

    const processor = new DocXMLaterProcessor();
    const result = await processor.modifyHyperlinks(doc, (url) => {
      throw new Error('Transform failed');
    });

    // Verify error handled
    expect(result.success).toBe(false);
    expect(result.error).toContain('Failed to modify hyperlinks');
  });

  it('should preserve document if URL update fails', async () => {
    const doc = Document.create();
    doc.createParagraph().addHyperlink(Hyperlink.createExternal('https://original.com', 'Link'));

    const processor = new DocXMLaterProcessor();

    // Try to update with failing transform
    await processor.modifyHyperlinks(doc, (url) => {
      throw new Error('Transform failed');
    });

    // Verify original URL preserved
    const hyperlinks = await processor.extractHyperlinks(doc);
    expect(hyperlinks[0].url).toBe('https://original.com');
  });
});
```

## Test Implementation Priority

1. **High Priority:**
   - Comprehensive coverage test (all document parts)
   - Table hyperlinks extraction/update
   - Header/footer hyperlinks extraction/update

2. **Medium Priority:**
   - Performance benchmarks
   - Error handling tests

3. **Low Priority:**
   - Edge cases (nested tables, multiple headers/footers)
   - Stress tests (very large documents)

## Notes

- These tests require docxmlater v1.15.0 or later
- Test infrastructure needs to be set up (jest/vitest configuration)
- Real document testing should be done with integration tests
- Performance benchmarks are estimates and may vary by system

## Related Files

- Implementation: `src/services/document/DocXMLaterProcessor.ts`
- Existing tests: `src/services/document/__tests__/WordDocumentProcessor.test.ts`
- Integration tests: `src/services/document/__tests__/WordDocumentProcessor.integration.test.ts`
