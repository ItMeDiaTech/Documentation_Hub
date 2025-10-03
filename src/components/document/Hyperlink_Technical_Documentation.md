# Hyperlink Management in .docx Files: Technical Documentation

## Architecture Overview

In OpenXML, hyperlinks use a two-part reference system:

- `<w:hyperlink>` element in document.xml contains an `r:id` attribute
- `r:id` references a relationship entry in document.xml.rels with the target URL

```xml
<!-- document.xml -->
<w:hyperlink r:id="rId4" w:history="1">
  <w:r>
    <w:t>Link text</w:t>
  </w:r>
</w:hyperlink>

<!-- document.xml.rels -->
<Relationship
  Id="rId4"
  Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink"
  Target="https://example.com"
  TargetMode="External"/>
```

## TypeScript Implementation

### Basic Hyperlink Manager

```typescript
import { Document, ExternalHyperlink, InternalHyperlink, TextRun, Paragraph } from 'docx';
import JSZip from 'jszip';
import { parseStringPromise, Builder } from 'xml2js';

interface HyperlinkData {
  id: string;
  type: 'external' | 'internal';
  target: string;
  text: string;
  created: Date;
  modified?: Date;
}

export class HyperlinkManager {
  private relationships = new Map<string, HyperlinkData>();
  private nextId = 1;

  createExternal(text: string, url: string): ExternalHyperlink {
    const id = `rId${this.nextId++}`;

    this.relationships.set(id, {
      id,
      type: 'external',
      target: url,
      text,
      created: new Date(),
    });

    return new ExternalHyperlink({
      link: url,
      children: [
        new TextRun({
          text,
          style: 'Hyperlink',
        }),
      ],
    });
  }

  createInternal(text: string, bookmarkId: string): InternalHyperlink {
    const id = `rId${this.nextId++}`;

    this.relationships.set(id, {
      id,
      type: 'internal',
      target: `#${bookmarkId}`,
      text,
      created: new Date(),
    });

    return new InternalHyperlink({
      anchor: bookmarkId,
      children: [
        new TextRun({
          text,
          style: 'Hyperlink',
        }),
      ],
    });
  }

  getRelationships(): HyperlinkData[] {
    return Array.from(this.relationships.values());
  }
}
```

### Modifying Existing Hyperlinks

```typescript
export class HyperlinkModifier {
  async updateUrl(documentPath: string, oldUrl: string, newUrl: string): Promise<UpdateResult> {
    const zip = await JSZip.loadAsync(await fs.readFile(documentPath));
    const changes: Change[] = [];

    // Parse relationships
    const relsFile = zip.file('word/_rels/document.xml.rels');
    if (!relsFile) throw new Error('Relationships file not found');

    const relsXml = await relsFile.async('string');
    const parsed = await parseStringPromise(relsXml);

    // Update matching relationships
    const relationships = parsed.Relationships.Relationship;
    for (const rel of relationships) {
      if (rel.$.Target === oldUrl) {
        changes.push({
          relationshipId: rel.$.Id,
          oldTarget: rel.$.Target,
          newTarget: newUrl,
        });
        rel.$.Target = newUrl;
      }
    }

    // Save changes
    const builder = new Builder();
    const updatedXml = builder.buildObject(parsed);
    zip.file('word/_rels/document.xml.rels', updatedXml);

    const buffer = await zip.generateAsync({ type: 'nodebuffer' });
    await fs.writeFile(documentPath, buffer);

    return { success: true, changes };
  }

  async updateText(documentPath: string, relationshipId: string, newText: string): Promise<void> {
    const zip = await JSZip.loadAsync(await fs.readFile(documentPath));

    const docFile = zip.file('word/document.xml');
    if (!docFile) throw new Error('Document file not found');

    const docXml = await docFile.async('string');
    const parsed = await parseStringPromise(docXml);

    // Find and update hyperlink text
    this.findAndUpdateHyperlink(parsed, relationshipId, newText);

    const builder = new Builder();
    zip.file('word/document.xml', builder.buildObject(parsed));

    const buffer = await zip.generateAsync({ type: 'nodebuffer' });
    await fs.writeFile(documentPath, buffer);
  }

  private findAndUpdateHyperlink(doc: any, relationshipId: string, newText: string): void {
    const traverse = (node: any): void => {
      if (!node || typeof node !== 'object') return;

      if (node['w:hyperlink']) {
        const hyperlinks = Array.isArray(node['w:hyperlink'])
          ? node['w:hyperlink']
          : [node['w:hyperlink']];

        for (const hyperlink of hyperlinks) {
          if (hyperlink.$?.['r:id'] === relationshipId) {
            // Update text in runs
            const runs = hyperlink['w:r'] || [];
            for (const run of runs) {
              if (run['w:t']) {
                run['w:t'] = [newText];
              }
            }
          }
        }
      }

      Object.values(node).forEach((child) => traverse(child));
    };

    traverse(doc);
  }
}
```

## Change Tracking Implementation

Since `docx` library doesn't support native Word track changes, implement custom tracking:

```typescript
interface TrackedChange {
  id: string;
  type: 'insert' | 'delete' | 'modify';
  elementType: 'hyperlink';
  author: string;
  timestamp: Date;
  before?: HyperlinkData;
  after?: HyperlinkData;
}

export class ChangeTracker {
  private changes: TrackedChange[] = [];
  private snapshots = new Map<string, HyperlinkData>();

  async initialize(documentPath: string): Promise<void> {
    const hyperlinks = await this.extractHyperlinks(documentPath);
    hyperlinks.forEach((h) => this.snapshots.set(h.id, { ...h }));
  }

  track(
    operation: 'insert' | 'delete' | 'modify',
    data: {
      id: string;
      before?: HyperlinkData;
      after?: HyperlinkData;
    }
  ): void {
    this.changes.push({
      id: crypto.randomUUID(),
      type: operation,
      elementType: 'hyperlink',
      author: process.env.USER || 'unknown',
      timestamp: new Date(),
      before: data.before,
      after: data.after,
    });

    // Update snapshot
    if (operation === 'delete') {
      this.snapshots.delete(data.id);
    } else if (data.after) {
      this.snapshots.set(data.id, data.after);
    }
  }

  getChanges(): TrackedChange[] {
    return [...this.changes];
  }

  async exportReport(outputPath: string): Promise<void> {
    const doc = new Document({
      sections: [
        {
          children: [
            new Paragraph({
              text: 'Change History',
              heading: HeadingLevel.HEADING_1,
            }),
            ...this.changes.map(
              (change) =>
                new Paragraph({
                  text: `${change.timestamp.toISOString()}: ${change.type} by ${change.author}`,
                  bullet: { level: 0 },
                })
            ),
          ],
        },
      ],
    });

    const buffer = await Packer.toBuffer(doc);
    await fs.writeFile(outputPath, buffer);
  }
}
```

## Helper Utilities

```typescript
export class HyperlinkUtils {
  // Remove orphaned relationships
  static async cleanupOrphaned(documentPath: string): Promise<number> {
    const zip = await JSZip.loadAsync(await fs.readFile(documentPath));

    // Get used relationship IDs from document
    const docXml = await zip.file('word/document.xml')?.async('string');
    const usedIds = this.extractUsedRelationshipIds(docXml);

    // Get all relationship IDs
    const relsXml = await zip.file('word/_rels/document.xml.rels')?.async('string');
    const parsed = await parseStringPromise(relsXml);

    // Remove orphaned
    let removed = 0;
    parsed.Relationships.Relationship = parsed.Relationships.Relationship.filter((rel: any) => {
      if (!usedIds.has(rel.$.Id)) {
        removed++;
        return false;
      }
      return true;
    });

    if (removed > 0) {
      const builder = new Builder();
      zip.file('word/_rels/document.xml.rels', builder.buildObject(parsed));
      const buffer = await zip.generateAsync({ type: 'nodebuffer' });
      await fs.writeFile(documentPath, buffer);
    }

    return removed;
  }

  // Consolidate duplicate URLs
  static async consolidateDuplicates(documentPath: string): Promise<ConsolidationResult> {
    const zip = await JSZip.loadAsync(await fs.readFile(documentPath));
    const relsXml = await zip.file('word/_rels/document.xml.rels')?.async('string');
    const parsed = await parseStringPromise(relsXml);

    const urlMap = new Map<string, string[]>();

    // Group by URL
    for (const rel of parsed.Relationships.Relationship) {
      const url = rel.$.Target;
      const ids = urlMap.get(url) || [];
      ids.push(rel.$.Id);
      urlMap.set(url, ids);
    }

    const consolidations: Array<{ url: string; kept: string; removed: string[] }> = [];

    // Process duplicates
    for (const [url, ids] of urlMap.entries()) {
      if (ids.length > 1) {
        const [kept, ...removed] = ids;
        consolidations.push({ url, kept, removed });

        // Update document references
        await this.updateReferences(zip, removed, kept);

        // Remove duplicate relationships
        parsed.Relationships.Relationship = parsed.Relationships.Relationship.filter(
          (rel: any) => !removed.includes(rel.$.Id)
        );
      }
    }

    if (consolidations.length > 0) {
      const builder = new Builder();
      zip.file('word/_rels/document.xml.rels', builder.buildObject(parsed));
      const buffer = await zip.generateAsync({ type: 'nodebuffer' });
      await fs.writeFile(documentPath, buffer);
    }

    return { consolidations, saved: consolidations.length };
  }

  // Validate all hyperlinks
  static async validate(documentPath: string): Promise<ValidationResult> {
    const issues: ValidationIssue[] = [];
    const zip = await JSZip.loadAsync(await fs.readFile(documentPath));

    const relsXml = await zip.file('word/_rels/document.xml.rels')?.async('string');
    const parsed = await parseStringPromise(relsXml);

    for (const rel of parsed.Relationships.Relationship) {
      if (rel.$.Type?.includes('hyperlink')) {
        // Check URL validity
        try {
          new URL(rel.$.Target);
        } catch {
          issues.push({
            id: rel.$.Id,
            type: 'invalid_url',
            message: `Invalid URL: ${rel.$.Target}`,
          });
        }

        // Check for broken internal links
        if (rel.$.Target?.startsWith('#')) {
          const bookmarkId = rel.$.Target.substring(1);
          if (!(await this.bookmarkExists(zip, bookmarkId))) {
            issues.push({
              id: rel.$.Id,
              type: 'broken_bookmark',
              message: `Bookmark not found: ${bookmarkId}`,
            });
          }
        }
      }
    }

    return {
      valid: issues.length === 0,
      issues,
    };
  }
}
```

## Performance Optimization

```typescript
export class HyperlinkProcessor {
  private cache = new Map<string, HyperlinkData>();

  async processBatch(documentPath: string, operations: Operation[]): Promise<BatchResult> {
    const zip = await JSZip.loadAsync(await fs.readFile(documentPath));
    const results: OperationResult[] = [];

    // Batch all changes before writing
    for (const op of operations) {
      try {
        await this.applyOperation(zip, op);
        results.push({ success: true, operation: op });
      } catch (error) {
        results.push({
          success: false,
          operation: op,
          error: error.message,
        });
      }
    }

    // Write once
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });
    await fs.writeFile(documentPath, buffer);

    return {
      total: operations.length,
      successful: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      results,
    };
  }

  // Stream processing for large documents
  async *streamHyperlinks(documentPath: string): AsyncGenerator<HyperlinkData> {
    const zip = await JSZip.loadAsync(await fs.readFile(documentPath));
    const docXml = await zip.file('word/document.xml')?.async('string');

    // Parse in chunks to avoid memory issues
    const chunks = this.splitIntoChunks(docXml, 1000);

    for (const chunk of chunks) {
      const hyperlinks = this.extractHyperlinksFromChunk(chunk);
      for (const hyperlink of hyperlinks) {
        yield hyperlink;
      }
    }
  }
}
```

## Best Practices Summary

1. **Always preserve relationship IDs** when modifying hyperlinks
2. **Track all changes** for audit trails
3. **Validate URLs** before saving
4. **Batch operations** to minimize file I/O
5. **Cache frequently accessed data** for performance
6. **Use TypeScript strict mode** for type safety

## Limitations

- `docx` library cannot create native Word tracked changes
- Real-time collaboration requires server infrastructure
- Complex field codes require low-level XML manipulation
- Digital signatures need special handling after modifications

## Complete Example

```typescript
async function processDocument(inputPath: string, outputPath: string) {
  const manager = new HyperlinkManager();
  const modifier = new HyperlinkModifier();
  const tracker = new ChangeTracker();

  // Initialize tracking
  await tracker.initialize(inputPath);

  // Update URL
  const result = await modifier.updateUrl(inputPath, 'http://old-url.com', 'https://new-url.com');

  // Track changes
  result.changes.forEach((change) => {
    tracker.track('modify', {
      id: change.relationshipId,
      before: { target: change.oldTarget },
      after: { target: change.newTarget },
    });
  });

  // Cleanup orphaned relationships
  const removed = await HyperlinkUtils.cleanupOrphaned(inputPath);
  console.log(`Removed ${removed} orphaned relationships`);

  // Validate
  const validation = await HyperlinkUtils.validate(inputPath);
  if (!validation.valid) {
    console.error('Validation issues:', validation.issues);
  }

  // Export change report
  await tracker.exportReport(outputPath);
}
```
