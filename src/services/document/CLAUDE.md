# Document Processing Services

This directory contains the core document processing services for handling .docx files with sophisticated hyperlink management, following TypeScript 2025 best practices.

## Services Overview

### DocumentProcessor.ts

Main document processing engine

- Orchestrates all document processing operations
- Implements async/await patterns with robust error handling
- Features:
  - Multi-phase processing with operations queue
  - Automatic backup creation and restoration
  - Batch processing with controlled concurrency
  - Progress tracking and cancellation support
  - Comprehensive error recovery with rollback

### WordDocumentProcessor.ts (NEW)

Advanced Word document processor with direct .docx manipulation

- Direct manipulation of Word documents using JSZip
- Features:
  - Stream processing for large documents (>100MB limit)
  - Memory-efficient processing with chunking
  - Batch processing with concurrent execution (3 files at once)
  - Automatic backup creation with timestamp
  - XML parsing using fast-xml-parser for performance
  - Hyperlink extraction from all document parts (main, headers, footers)
  - Content ID appending based on URL patterns
  - Relationship management in OpenXML structure
  - Progress tracking with abort capability

### HyperlinkManager.ts

Manages all hyperlink operations

- Implements the two-part OpenXML reference system (element + relationship)
- Features:
  - Scan and extract all hyperlinks from documents
  - Append Content IDs to theSource URLs (pattern matching)
  - Update/replace hyperlinks based on patterns
  - Validate hyperlink integrity and URLs
  - Remove orphaned relationships
  - Consolidate duplicate URLs
  - Update hyperlink display text
- Pattern Recognition (ENHANCED):
  - ContentId: `([TC][SM][RS]C?-[A-Za-z0-9]+-\d{6})` - Improved accuracy
  - DocumentId: `docid=([A-Za-z0-9\-]+)(?:[^A-Za-z0-9\-]|$)` - Better edge case handling
  - TheSource domain validation with content anchor checking

### BackupService.ts

Document backup and restoration

- Safe backup strategies with automatic cleanup
- Features:
  - Timestamped backups with checksums
  - Automatic cleanup of old backups (7-day default)
  - Maximum backups per document limit (5 default)
  - Integrity verification with SHA-256
  - Metadata tracking for each backup
  - Storage management and reporting
  - Atomic backup/restore operations

### ValidationEngine.ts

Document validation and integrity checking

- Comprehensive validation of document structure
- Features:
  - Structure validation (required/optional parts)
  - Relationship validation (orphaned/missing)
  - Style validation with suggestions
  - Hyperlink validation
  - Image format and size validation
  - Metadata validation
  - Strict mode for additional checks
  - Quality scoring (0-100)
  - Auto-fix capabilities for common issues

## Architecture Patterns

### Error Handling

- Either pattern for operation results
- Graceful degradation for non-critical operations
- Automatic rollback on critical failures
- Detailed error tracking with recovery suggestions

### Performance Optimization

- Stream processing for large documents
- Chunked operations to control memory usage
- Parallel processing with semaphore control
- Caching of frequently accessed data
- Lazy loading of document parts

### Type Safety

- Strict TypeScript with advanced type features
- Template literal types for document parts
- Conditional types for operation results
- Deep readonly for immutable structures
- Discriminated unions for operations

## Usage Example

```typescript
import { DocumentProcessor } from '@/services/document/DocumentProcessor';
import { HyperlinkProcessingOptions } from '@/types/hyperlink';

const processor = new DocumentProcessor();

// Define operations
const operations = [
  {
    id: 'fix-hyperlinks',
    type: 'hyperlink' as const,
    action: 'append' as const,
    description: 'Append Content IDs to theSource URLs',
    contentId: '#content',
    critical: true,
    priority: 1,
  },
];

// Process document
const result = await processor.processDocument(documentPath, operations, {
  createBackup: true,
  validateBeforeProcessing: true,
  maxRetries: 3,
});

if (result.success) {
  console.log('Processing completed:', result.statistics);
} else {
  console.error('Processing failed:', result.errors);
}
```

## Key Features

### Hyperlink Content ID Appending

The system automatically identifies theSource URLs that match specific patterns and appends Content IDs:

1. Scans all hyperlinks in document (main, headers, footers)
2. Identifies URLs matching ContentId or DocumentId patterns
3. Appends `#content` to matching URLs
4. Preserves existing Content IDs (no duplicates)
5. Updates relationship files correctly

### Backup Strategy

- Automatic backups before processing
- Timestamped with document hash
- Configurable retention policy
- Automatic cleanup of old backups
- Integrity verification on restore

### Validation Levels

1. **Basic**: Structure and required parts
2. **Standard**: + Relationships and hyperlinks
3. **Comprehensive**: + Styles, images, metadata
4. **Strict**: All checks with recommendations

## Integration with UI

These services integrate with the UI components:

- `DocumentUploader`: Initiates processing
- `ProcessingProgress`: Shows real-time progress
- `HyperlinkPreview`: Displays changes before applying
- `ProcessingResults`: Shows final statistics
- `ProcessingOptions`: NEW batch processing UI with:
  - Multi-file selection dialog
  - Individual file status tracking
  - Progress bars with percentage
  - Success/failure indicators
  - Animated file list with remove capability

## Error Recovery

The services implement multiple levels of error recovery:

1. **Operation retry**: Failed operations retry with exponential backoff
2. **Partial recovery**: Non-critical operations can fail without stopping
3. **Full rollback**: Critical failures trigger complete restoration
4. **Manual recovery**: Backup restoration available through UI

## Performance Considerations

- Documents > 10MB processed in chunks
- Batch operations process up to 4 documents concurrently
- XML parsing uses streaming where possible
- Relationship lookups cached during processing
- Memory cleanup after each operation

## Recent Enhancements (December 2024)

- [x] PowerAutomate API Integration:
  - 4-phase processing pipeline (ID Extraction → API Communication → URL Reconstruction → Display Text Rules)
  - Batch API requests with Lookup_ID array
  - Retry logic with exponential backoff
  - Result caching for O(1) lookups
  - Automatic Document_ID URL construction
  - Content_ID appending with last 6 digits extraction
  - Status indicators (Expired, Not Found)

- [x] Electron IPC Security:
  - Context isolation enforcement
  - Path validation and sanitization
  - File size limits (100MB)
  - Type-safe IPC channels
  - AbortController for cancellation
  - Timeout protection (60 seconds)

- [x] Batch Processing:
  - Concurrent processing with semaphore control
  - Progress reporting with event emitters
  - File validation before processing
  - Error aggregation and reporting
  - Success/failure tracking per file

## Future Enhancements

- [ ] Real-time collaboration support
- [ ] Cloud backup integration
- [ ] Advanced pattern recognition with ML
- [ ] Document comparison and merging
- [ ] Template-based processing
- [x] API integration for external validation (PowerAutomate completed)
