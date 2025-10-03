# Document Processing Components

This directory contains UI components for document processing, hyperlink management, and results visualization in the Documentation Hub application.

## Components

### DocumentUploader.tsx

#### Drag-and-drop document upload interface

- Features:
  - Drag & drop support with visual feedback
  - Multiple file selection (configurable limit)
  - File type validation (.docx, .doc)
  - Real-time upload status display
  - Document list with processing status
  - Quick statistics (processed, processing, links fixed)
  - Error handling with user feedback
- Visual Elements:
  - Animated drop zone with scale effects
  - Status icons (pending, processing, completed, error)
  - Progress indicator for processing documents
  - File size formatting
  - Remove document functionality

### ProcessingProgress.tsx

Real-time document processing progress display

- Features:
  - Overall progress bar with percentage
  - Step-by-step processing visualization
  - Processing statistics grid
  - Time tracking (elapsed and estimated remaining)
  - Cancellation support
  - Error and warning display
- Processing Steps:
  1. Creating Backup
  2. Validating Document
  3. Scanning Hyperlinks
  4. Processing Hyperlinks
  5. Saving Document
- Animations:
  - Smooth progress bar transitions
  - Rotating spinner for active steps
  - Shimmer effect on progress bar
  - Step completion animations

### HyperlinkPreview.tsx

Preview and approve hyperlink changes before applying

- Features:
  - List of all proposed hyperlink changes
  - Change types: append, update, remove, validate
  - Approval/rejection workflow
  - Bulk approve/reject actions
  - Search and filter functionality
  - Expandable context view
  - External link preview
- Visual Indicators:
  - Color-coded change types
  - Status badges (pending, approved, rejected, applied)
  - Content ID append indicators
  - URL truncation for readability
- Filtering Options:
  - By change type
  - By status
  - Text search across URLs and display text

### ProcessingResults.tsx

Comprehensive processing results display

- Features:
  - Success/failure status display
  - Processing statistics grid
  - Detailed change list
  - Backup information
  - Error reporting
  - Duration tracking
  - Export/share options
- Statistics Shown:
  - Hyperlinks processed
  - Links modified
  - Content IDs appended
  - Processing time
- Actions:
  - Download processed document
  - Share results
  - View backup
  - Reprocess document
- Visual Effects:
  - Success animation overlay
  - Staggered statistics animation
  - Color-coded change types

## Integration with Document Processing Services

These components work with the document processing services:

### Data Flow

1. **DocumentUploader** → Accepts files and triggers processing
2. **ProcessingProgress** → Shows real-time status from DocumentProcessor
3. **HyperlinkPreview** → Displays changes from HyperlinkManager for approval
4. **ProcessingResults** → Shows final statistics and allows download

### Service Integration

```typescript
// Example integration in CurrentSession component
import { DocumentProcessor } from '@/services/document/DocumentProcessor';
import { DocumentUploader } from '@/components/document/DocumentUploader';

// Handle document upload
const handleDocumentsAdded = async (files: File[]) => {
  const processor = new DocumentProcessor();

  for (const file of files) {
    const operations = buildOperationsFromSessionOptions(session.processingOptions);
    const result = await processor.processDocument(file.path, operations, { createBackup: true });

    // Update UI with results
    updateDocumentStatus(file.name, result);
  }
};
```

## State Management

The components integrate with:

- **SessionContext**: For session-level processing options
- **Document state**: Tracking individual document processing status
- **Processing queue**: Managing multiple document processing

## Animations & Performance

- **Framer Motion**: Smooth animations and transitions
- **Staggered animations**: Sequential reveal for lists
- **Progress indicators**: Real-time feedback during processing
- **Optimized re-renders**: Using React.memo where appropriate
- **Virtual scrolling ready**: For long lists of changes

## Accessibility

- Proper ARIA labels for all interactive elements
- Keyboard navigation support
- Focus management in modals
- Screen reader friendly status updates
- Color contrast compliant indicators

## Error Handling

Each component implements comprehensive error handling:

- User-friendly error messages
- Recovery suggestions
- Backup restoration options
- Retry mechanisms
- Graceful degradation

## Usage Example

```tsx
import { useState } from 'react';
import { DocumentUploader } from '@/components/document/DocumentUploader';
import { ProcessingProgress } from '@/components/document/ProcessingProgress';
import { HyperlinkPreview } from '@/components/document/HyperlinkPreview';
import { ProcessingResults } from '@/components/document/ProcessingResults';

function DocumentProcessingFlow() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [currentStep, setCurrentStep] = useState<'upload' | 'preview' | 'processing' | 'results'>(
    'upload'
  );
  const [processingProgress, setProcessingProgress] = useState(0);
  const [changes, setChanges] = useState<HyperlinkChange[]>([]);

  return (
    <>
      {currentStep === 'upload' && (
        <DocumentUploader
          sessionId={sessionId}
          onDocumentsAdded={handleDocumentsAdded}
          documents={documents}
        />
      )}

      {currentStep === 'preview' && (
        <HyperlinkPreview
          changes={changes}
          onApproveAll={handleApproveAll}
          onApply={startProcessing}
        />
      )}

      {currentStep === 'processing' && (
        <ProcessingProgress
          documentName={currentDocument.name}
          progress={processingProgress}
          onCancel={handleCancel}
        />
      )}

      {currentStep === 'results' && (
        <ProcessingResults
          document={currentDocument}
          onDownload={handleDownload}
          onReprocess={handleReprocess}
        />
      )}
    </>
  );
}
```

## Future Enhancements

- [ ] Batch processing UI for multiple documents
- [ ] Drag to reorder processing queue
- [ ] Live collaboration indicators
- [ ] Processing history timeline
- [ ] Advanced filtering in results
- [ ] Export results to various formats
