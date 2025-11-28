/**
 * DocumentEditor - ContentEditable-based document editor
 *
 * Renders document paragraphs and tables as editable elements,
 * syncing changes back to docxmlater Document objects.
 *
 * Features:
 * - Paragraph editing with contentEditable
 * - Run formatting preservation
 * - Text selection tracking
 * - Table rendering with TableEditor integration
 * - Undo/redo support via action callbacks
 */

import {
  useState,
  useCallback,
  useRef,
  useEffect,
  useMemo,
  forwardRef,
  useImperativeHandle,
} from 'react';
import { cn } from '@/utils/cn';
import type {
  EditorSelection,
  CellSelection,
  EditorAction,
  QuickActionId,
} from '@/types/editor';

// Types for document structure (matching docxmlater)
interface RunData {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean | string;
  strike?: boolean;
  color?: string;
  font?: string;
  size?: number;
  highlight?: string;
}

interface ParagraphData {
  text: string;
  runs: RunData[];
  alignment?: 'left' | 'center' | 'right' | 'justify';
  style?: string;
  isHeading?: boolean;
  headingLevel?: number;
}

interface TableCellData {
  paragraphs: ParagraphData[];
  shading?: string;
  verticalMerge?: 'restart' | 'continue';
  columnSpan?: number;
}

interface TableRowData {
  cells: TableCellData[];
}

interface TableData {
  rows: TableRowData[];
}

interface BodyElement {
  type: 'paragraph' | 'table';
  paragraph?: ParagraphData;
  table?: TableData;
}

export interface DocumentEditorProps {
  /** Document body elements (paragraphs and tables) */
  bodyElements: BodyElement[];
  /** Callback when content changes */
  onChange: (elements: BodyElement[], action: EditorAction) => void;
  /** Callback when selection changes */
  onSelectionChange: (selection: EditorSelection | null) => void;
  /** Callback when table cell is selected */
  onTableSelectionChange: (selection: CellSelection | null, tableIndex: number | null) => void;
  /** Current text selection */
  selection: EditorSelection | null;
  /** Current table selection */
  tableSelection: CellSelection | null;
  /** Currently selected table index */
  selectedTableIndex: number | null;
  /** Quick action to apply */
  activeQuickAction: QuickActionId | null;
  /** Table shading settings */
  tableShadingSettings?: {
    header2Shading: string;
    otherShading: string;
  };
  /** Whether editor is read-only */
  readOnly?: boolean;
}

export interface DocumentEditorRef {
  /** Apply formatting to current selection */
  applyFormatting: (formatting: Partial<RunData>) => void;
  /** Apply paragraph style */
  applyParagraphStyle: (style: string) => void;
  /** Get current selection text */
  getSelectionText: () => string;
  /** Focus the editor */
  focus: () => void;
}

/**
 * Get CSS styles for a run
 */
function getRunStyles(run: RunData): React.CSSProperties {
  const styles: React.CSSProperties = {};

  if (run.bold) styles.fontWeight = 'bold';
  if (run.italic) styles.fontStyle = 'italic';
  if (run.underline) styles.textDecoration = 'underline';
  if (run.strike) {
    styles.textDecoration = styles.textDecoration
      ? `${styles.textDecoration} line-through`
      : 'line-through';
  }
  if (run.color) styles.color = `#${run.color}`;
  if (run.font) styles.fontFamily = run.font;
  if (run.size) styles.fontSize = `${run.size}pt`;
  if (run.highlight) {
    const highlightColors: Record<string, string> = {
      yellow: '#FFFF00',
      green: '#00FF00',
      cyan: '#00FFFF',
      magenta: '#FF00FF',
      blue: '#0000FF',
      red: '#FF0000',
      darkBlue: '#000080',
      darkCyan: '#008080',
      darkGreen: '#008000',
      darkMagenta: '#800080',
      darkRed: '#800000',
      darkYellow: '#808000',
      darkGray: '#808080',
      lightGray: '#C0C0C0',
      black: '#000000',
    };
    styles.backgroundColor = highlightColors[run.highlight] || run.highlight;
  }

  return styles;
}

/**
 * Get CSS classes for paragraph alignment
 */
function getParagraphAlignmentClass(alignment?: string): string {
  switch (alignment) {
    case 'center':
      return 'text-center';
    case 'right':
      return 'text-right';
    case 'justify':
      return 'text-justify';
    default:
      return 'text-left';
  }
}

/**
 * Editable paragraph component
 */
function EditableParagraph({
  paragraph,
  paragraphIndex,
  isSelected,
  onSelect,
  onChange,
  onKeyDown,
  readOnly,
}: {
  paragraph: ParagraphData;
  paragraphIndex: number;
  isSelected: boolean;
  onSelect: () => void;
  onChange: (text: string) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  readOnly?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [localText, setLocalText] = useState(paragraph.text);

  // Sync local text with paragraph prop
  useEffect(() => {
    setLocalText(paragraph.text);
  }, [paragraph.text]);

  // Handle blur - save changes
  const handleBlur = useCallback(() => {
    if (localText !== paragraph.text) {
      onChange(localText);
    }
  }, [localText, paragraph.text, onChange]);

  // Handle input
  const handleInput = useCallback((e: React.FormEvent<HTMLDivElement>) => {
    const newText = e.currentTarget.textContent || '';
    setLocalText(newText);
  }, []);

  // Determine heading styles
  const headingStyles = useMemo(() => {
    if (paragraph.style?.includes('Heading1') || paragraph.headingLevel === 1) {
      return 'text-2xl font-bold';
    }
    if (paragraph.style?.includes('Heading2') || paragraph.headingLevel === 2) {
      return 'text-xl font-semibold';
    }
    if (paragraph.style?.includes('Heading3') || paragraph.headingLevel === 3) {
      return 'text-lg font-medium';
    }
    return '';
  }, [paragraph.style, paragraph.headingLevel]);

  return (
    <div
      ref={ref}
      contentEditable={!readOnly}
      suppressContentEditableWarning
      onClick={onSelect}
      onBlur={handleBlur}
      onInput={handleInput}
      onKeyDown={onKeyDown}
      className={cn(
        'min-h-[1.5em] px-4 py-2 outline-none cursor-text transition-colors',
        'border-l-2 border-transparent',
        getParagraphAlignmentClass(paragraph.alignment),
        headingStyles,
        isSelected && 'bg-primary/5 border-l-primary',
        !isSelected && 'hover:bg-muted/30',
        readOnly && 'cursor-default'
      )}
      data-paragraph-index={paragraphIndex}
    >
      {paragraph.runs && paragraph.runs.length > 0 ? (
        paragraph.runs.map((run, runIndex) => (
          <span
            key={runIndex}
            style={getRunStyles(run)}
            data-run-index={runIndex}
          >
            {run.text}
          </span>
        ))
      ) : (
        <span>{paragraph.text || '\u00A0'}</span>
      )}
    </div>
  );
}

/**
 * Editable table cell component
 */
function EditableTableCell({
  cell,
  rowIndex,
  cellIndex,
  tableIndex,
  isSelected,
  onSelect,
  onChange,
  readOnly,
}: {
  cell: TableCellData;
  rowIndex: number;
  cellIndex: number;
  tableIndex: number;
  isSelected: boolean;
  onSelect: () => void;
  onChange: (text: string, paragraphIndex: number) => void;
  readOnly?: boolean;
}) {
  // Skip cells that are continued from vertical merge
  if (cell.verticalMerge === 'continue') {
    return null;
  }

  return (
    <td
      className={cn(
        'border border-border p-2 align-top',
        isSelected && 'ring-2 ring-primary ring-inset bg-primary/5',
        !isSelected && 'hover:bg-muted/30'
      )}
      style={{
        backgroundColor: cell.shading ? `#${cell.shading}` : undefined,
      }}
      colSpan={cell.columnSpan || 1}
      onClick={onSelect}
      data-table-index={tableIndex}
      data-row-index={rowIndex}
      data-cell-index={cellIndex}
    >
      {cell.paragraphs.map((para, paraIndex) => (
        <div
          key={paraIndex}
          contentEditable={!readOnly}
          suppressContentEditableWarning
          onBlur={(e) => {
            const newText = e.currentTarget.textContent || '';
            if (newText !== para.text) {
              onChange(newText, paraIndex);
            }
          }}
          className={cn(
            'min-h-[1.2em] outline-none',
            getParagraphAlignmentClass(para.alignment)
          )}
        >
          {para.runs && para.runs.length > 0 ? (
            para.runs.map((run, runIndex) => (
              <span key={runIndex} style={getRunStyles(run)}>
                {run.text}
              </span>
            ))
          ) : (
            <span>{para.text || '\u00A0'}</span>
          )}
        </div>
      ))}
    </td>
  );
}

/**
 * Editable table component
 */
function EditableTable({
  table,
  tableIndex,
  selectedCell,
  onCellSelect,
  onCellChange,
  readOnly,
}: {
  table: TableData;
  tableIndex: number;
  selectedCell: { row: number; col: number } | null;
  onCellSelect: (row: number, col: number) => void;
  onCellChange: (row: number, col: number, paragraphIndex: number, text: string) => void;
  readOnly?: boolean;
}) {
  return (
    <div className="my-4 overflow-x-auto">
      <table className="w-full border-collapse border border-border">
        <tbody>
          {table.rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.cells.map((cell, cellIndex) => (
                <EditableTableCell
                  key={cellIndex}
                  cell={cell}
                  rowIndex={rowIndex}
                  cellIndex={cellIndex}
                  tableIndex={tableIndex}
                  isSelected={
                    selectedCell?.row === rowIndex && selectedCell?.col === cellIndex
                  }
                  onSelect={() => onCellSelect(rowIndex, cellIndex)}
                  onChange={(text, paraIndex) =>
                    onCellChange(rowIndex, cellIndex, paraIndex, text)
                  }
                  readOnly={readOnly}
                />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Main DocumentEditor component
 */
export const DocumentEditor = forwardRef<DocumentEditorRef, DocumentEditorProps>(
  function DocumentEditor(
    {
      bodyElements,
      onChange,
      onSelectionChange,
      onTableSelectionChange,
      selection,
      tableSelection,
      selectedTableIndex,
      activeQuickAction,
      tableShadingSettings,
      readOnly = false,
    },
    ref
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [selectedParagraph, setSelectedParagraph] = useState<number | null>(null);
    const [selectedTableCell, setSelectedTableCell] = useState<{
      tableIndex: number;
      row: number;
      col: number;
    } | null>(null);

    // Expose methods via ref
    useImperativeHandle(ref, () => ({
      applyFormatting: (formatting: Partial<RunData>) => {
        // Implementation would apply formatting to selected runs
        console.log('Apply formatting:', formatting);
      },
      applyParagraphStyle: (style: string) => {
        if (selectedParagraph !== null) {
          const newElements = [...bodyElements];
          const element = newElements[selectedParagraph];
          if (element?.type === 'paragraph' && element.paragraph) {
            element.paragraph.style = style;
            onChange(newElements, {
              type: 'formatting',
              timestamp: new Date(),
              undo: () => {},
              redo: () => {},
              description: `Apply ${style} style`,
            });
          }
        }
      },
      getSelectionText: () => {
        const sel = window.getSelection();
        return sel?.toString() || '';
      },
      focus: () => {
        containerRef.current?.focus();
      },
    }));

    // Handle paragraph selection
    const handleParagraphSelect = useCallback(
      (index: number) => {
        setSelectedParagraph(index);
        setSelectedTableCell(null);
        onSelectionChange({
          paragraphIndex: index,
          runStartIndex: 0,
          runEndIndex: 0,
          characterStart: 0,
          characterEnd: 0,
        });
        onTableSelectionChange(null, null);
      },
      [onSelectionChange, onTableSelectionChange]
    );

    // Handle table cell selection
    const handleTableCellSelect = useCallback(
      (tableIndex: number, row: number, col: number) => {
        setSelectedParagraph(null);
        setSelectedTableCell({ tableIndex, row, col });
        onSelectionChange(null);
        onTableSelectionChange(
          {
            startRow: row,
            startCol: col,
            endRow: row,
            endCol: col,
          },
          tableIndex
        );
      },
      [onSelectionChange, onTableSelectionChange]
    );

    // Handle paragraph text change
    const handleParagraphChange = useCallback(
      (paragraphIndex: number, newText: string) => {
        const newElements = [...bodyElements];
        const element = newElements[paragraphIndex];

        if (element?.type === 'paragraph' && element.paragraph) {
          const oldText = element.paragraph.text;
          element.paragraph.text = newText;

          // Update first run text if runs exist
          if (element.paragraph.runs && element.paragraph.runs.length > 0) {
            element.paragraph.runs[0].text = newText;
          }

          onChange(newElements, {
            type: 'text',
            timestamp: new Date(),
            undo: () => {
              element.paragraph!.text = oldText;
              if (element.paragraph!.runs?.[0]) {
                element.paragraph!.runs[0].text = oldText;
              }
            },
            redo: () => {
              element.paragraph!.text = newText;
              if (element.paragraph!.runs?.[0]) {
                element.paragraph!.runs[0].text = newText;
              }
            },
            description: 'Edit text',
          });
        }
      },
      [bodyElements, onChange]
    );

    // Handle table cell text change
    const handleTableCellChange = useCallback(
      (
        tableElementIndex: number,
        rowIndex: number,
        cellIndex: number,
        paragraphIndex: number,
        newText: string
      ) => {
        const newElements = [...bodyElements];
        const element = newElements[tableElementIndex];

        if (element?.type === 'table' && element.table) {
          const cell = element.table.rows[rowIndex]?.cells[cellIndex];
          if (cell && cell.paragraphs[paragraphIndex]) {
            const oldText = cell.paragraphs[paragraphIndex].text;
            cell.paragraphs[paragraphIndex].text = newText;

            onChange(newElements, {
              type: 'text',
              timestamp: new Date(),
              undo: () => {
                cell.paragraphs[paragraphIndex].text = oldText;
              },
              redo: () => {
                cell.paragraphs[paragraphIndex].text = newText;
              },
              description: 'Edit table cell',
            });
          }
        }
      },
      [bodyElements, onChange]
    );

    // Handle keyboard shortcuts
    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent, paragraphIndex: number) => {
        // Enter key - create new paragraph
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          const newElements = [...bodyElements];
          const newParagraph: BodyElement = {
            type: 'paragraph',
            paragraph: {
              text: '',
              runs: [{ text: '' }],
            },
          };
          newElements.splice(paragraphIndex + 1, 0, newParagraph);
          onChange(newElements, {
            type: 'structure',
            timestamp: new Date(),
            undo: () => {
              newElements.splice(paragraphIndex + 1, 1);
            },
            redo: () => {
              newElements.splice(paragraphIndex + 1, 0, newParagraph);
            },
            description: 'Insert paragraph',
          });
          // Focus new paragraph after render
          setTimeout(() => {
            const newPara = containerRef.current?.querySelector(
              `[data-paragraph-index="${paragraphIndex + 1}"]`
            ) as HTMLElement;
            newPara?.focus();
          }, 0);
        }

        // Backspace at beginning - merge with previous paragraph
        if (e.key === 'Backspace') {
          const sel = window.getSelection();
          if (sel && sel.anchorOffset === 0 && paragraphIndex > 0) {
            e.preventDefault();
            const newElements = [...bodyElements];
            const current = newElements[paragraphIndex];
            const previous = newElements[paragraphIndex - 1];

            if (
              current?.type === 'paragraph' &&
              previous?.type === 'paragraph' &&
              current.paragraph &&
              previous.paragraph
            ) {
              const mergedText = previous.paragraph.text + current.paragraph.text;
              previous.paragraph.text = mergedText;
              if (previous.paragraph.runs?.[0]) {
                previous.paragraph.runs[0].text = mergedText;
              }
              newElements.splice(paragraphIndex, 1);
              onChange(newElements, {
                type: 'structure',
                timestamp: new Date(),
                undo: () => {},
                redo: () => {},
                description: 'Merge paragraphs',
              });
            }
          }
        }

        // Arrow up/down navigation
        if (e.key === 'ArrowUp' && paragraphIndex > 0) {
          const prevPara = containerRef.current?.querySelector(
            `[data-paragraph-index="${paragraphIndex - 1}"]`
          ) as HTMLElement;
          if (prevPara) {
            prevPara.focus();
            setSelectedParagraph(paragraphIndex - 1);
          }
        }
        if (e.key === 'ArrowDown' && paragraphIndex < bodyElements.length - 1) {
          const nextPara = containerRef.current?.querySelector(
            `[data-paragraph-index="${paragraphIndex + 1}"]`
          ) as HTMLElement;
          if (nextPara) {
            nextPara.focus();
            setSelectedParagraph(paragraphIndex + 1);
          }
        }
      },
      [bodyElements, onChange]
    );

    // Track table element indices
    let tableCount = 0;

    return (
      <div
        ref={containerRef}
        className="flex-1 overflow-auto bg-white dark:bg-gray-900 p-8"
        onClick={() => {
          // Deselect when clicking empty area
          if (selectedParagraph !== null || selectedTableCell !== null) {
            setSelectedParagraph(null);
            setSelectedTableCell(null);
            onSelectionChange(null);
            onTableSelectionChange(null, null);
          }
        }}
      >
        {/* Document content area */}
        <div
          className="max-w-4xl mx-auto bg-white dark:bg-gray-800 shadow-lg rounded-lg min-h-[800px]"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Simulated page margins */}
          <div className="p-8">
            {bodyElements.map((element, index) => {
              if (element.type === 'paragraph' && element.paragraph) {
                return (
                  <EditableParagraph
                    key={`para-${index}`}
                    paragraph={element.paragraph}
                    paragraphIndex={index}
                    isSelected={selectedParagraph === index}
                    onSelect={() => handleParagraphSelect(index)}
                    onChange={(text) => handleParagraphChange(index, text)}
                    onKeyDown={(e) => handleKeyDown(e, index)}
                    readOnly={readOnly}
                  />
                );
              }

              if (element.type === 'table' && element.table) {
                const currentTableIndex = tableCount;
                tableCount++;
                return (
                  <EditableTable
                    key={`table-${index}`}
                    table={element.table}
                    tableIndex={index}
                    selectedCell={
                      selectedTableCell?.tableIndex === index
                        ? { row: selectedTableCell.row, col: selectedTableCell.col }
                        : null
                    }
                    onCellSelect={(row, col) =>
                      handleTableCellSelect(index, row, col)
                    }
                    onCellChange={(row, col, paraIndex, text) =>
                      handleTableCellChange(index, row, col, paraIndex, text)
                    }
                    readOnly={readOnly}
                  />
                );
              }

              return null;
            })}

            {/* Empty state */}
            {bodyElements.length === 0 && (
              <div className="text-center text-muted-foreground py-16">
                <p>No content to display</p>
                <p className="text-sm mt-2">
                  Click to add your first paragraph
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }
);

export default DocumentEditor;
