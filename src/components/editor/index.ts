/**
 * Editor Components - Document editing and tracked changes
 *
 * Exports:
 * - DocumentEditorModal: Fullscreen modal for document editing
 * - EditorToolbar: Toolbar with save, undo/redo, formatting buttons
 * - EditorQuickActions: Sidebar with quick action buttons
 * - DocumentEditor: Main content editable document editor
 * - TableEditor: Full table editing component with cell selection
 */

export { DocumentEditorModal } from './DocumentEditorModal';
export { EditorToolbar } from './EditorToolbar';
export { EditorQuickActions } from './EditorQuickActions';
export { DocumentEditor } from './DocumentEditor';
export type { DocumentEditorRef, DocumentEditorProps } from './DocumentEditor';
export { TableEditor } from './TableEditor';
export type { TableEditorRef, TableEditorProps } from './TableEditor';
