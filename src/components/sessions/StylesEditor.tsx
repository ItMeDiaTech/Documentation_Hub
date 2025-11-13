import { useState, memo } from 'react';
import {
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  Bold,
  Italic,
  Underline,
  Check,
  List,
  Table,
  BookOpen,
  Lock
} from 'lucide-react';
import { cn } from '@/utils/cn';
import {
  ListBulletSettings,
  IndentationLevel
} from '@/types/session';

interface StyleDefinition {
  id: string;
  name: string;
  fontSize: number;
  fontFamily: string;
  bold: boolean; // Required: true = apply bold, false = remove bold
  italic: boolean; // Required: true = apply italic, false = remove italic
  underline: boolean; // Required: true = apply underline, false = remove underline
  preserveBold?: boolean; // Optional: true = preserve existing bold (ignore bold property)
  preserveItalic?: boolean; // Optional: true = preserve existing italic (ignore italic property)
  preserveUnderline?: boolean; // Optional: true = preserve existing underline (ignore underline property)
  alignment: 'left' | 'center' | 'right' | 'justify';
  spaceBefore: number;
  spaceAfter: number;
  lineSpacing: number; // 1.0 = single, 1.15 = Word default, 1.5, 2.0 = double
  color: string;
  noSpaceBetweenSame?: boolean;
  indentation?: {
    left?: number;      // Left indent in inches (e.g., 0.25" for bullet position)
    firstLine?: number; // First line indent in inches (e.g., 0.5" for text position)
  };
}

const defaultStyles: StyleDefinition[] = [
  {
    id: 'header1',
    name: 'Header 1',
    fontSize: 18,
    fontFamily: 'Verdana',
    bold: true,
    italic: false,
    underline: false,
    alignment: 'left',
    spaceBefore: 0,
    spaceAfter: 12,
    lineSpacing: 1.0, // Single spacing for headings
    color: '#000000'
  },
  {
    id: 'header2',
    name: 'Header 2',
    fontSize: 14,
    fontFamily: 'Verdana',
    bold: true,
    italic: false,
    underline: false,
    alignment: 'left',
    spaceBefore: 6,
    spaceAfter: 6,
    lineSpacing: 1.0, // Single spacing for headings
    color: '#000000'
  },
  {
    id: 'header3',
    name: 'Header 3',
    fontSize: 12,
    fontFamily: 'Verdana',
    bold: true,
    italic: false,
    underline: false,
    alignment: 'left',
    spaceBefore: 3,
    spaceAfter: 3,
    lineSpacing: 1.0, // Single spacing for headings
    color: '#000000'
  },
  {
    id: 'normal',
    name: 'Normal',
    fontSize: 12,
    fontFamily: 'Verdana',
    bold: false, // Not bold by default
    italic: false, // Not italic by default
    underline: false, // Not underlined by default
    preserveBold: true, // Preserve existing bold formatting (Requirement 5)
    preserveItalic: false, // Apply italic setting (not preserved)
    preserveUnderline: false, // Apply underline setting (not preserved)
    alignment: 'left',
    spaceBefore: 3,
    spaceAfter: 3,
    lineSpacing: 1.0, // Changed from 1.15 to 1.0
    color: '#000000',
    noSpaceBetweenSame: false // Allow spacing between Normal paragraphs (Requirement 5)
  },
  {
    id: 'listParagraph',
    name: 'List Paragraph',
    fontSize: 12,
    fontFamily: 'Verdana',
    bold: false, // Not bold by default
    italic: false, // Not italic by default
    underline: false, // Not underlined by default
    preserveBold: true, // Preserve existing bold formatting (Requirement 6)
    preserveItalic: false, // Apply italic setting (not preserved)
    preserveUnderline: false, // Apply underline setting (not preserved)
    alignment: 'left',
    spaceBefore: 0,
    spaceAfter: 6,
    lineSpacing: 1.0,
    color: '#000000',
    noSpaceBetweenSame: true, // No spacing between list items (Requirement 6)
    indentation: {
      left: 0.25,     // Bullet position at 0.25 inches
      firstLine: 0.5  // Text position at 0.5 inches (0.25 additional from left)
    }
  }
];

const fontSizes = Array.from({ length: 65 }, (_, i) => i + 8); // 8pt to 72pt
const fontFamilies = ['Verdana', 'Arial', 'Times New Roman', 'Calibri', 'Georgia', 'Helvetica'];
const spacingOptions = Array.from({ length: 25 }, (_, i) => i * 3); // 0pt to 72pt in increments of 3
const lineSpacingOptions = [
  { value: 1.0, label: 'Single' },
  { value: 1.15, label: '1.15 (Default)' },
  { value: 1.5, label: '1.5 Lines' },
  { value: 2.0, label: 'Double' }
];

// Default indentation levels based on documentation best practices
// Alternating between closed (•) and open (○) bullets
// Symbol indent: 0.25" per level, Text indent: 0.5" per level
// Using U+F0B7 () for standard bullets (rendered with Calibri in v1.14.0+)
const defaultIndentationLevels: IndentationLevel[] = [
  { level: 1, symbolIndent: 0.25, textIndent: 0.5, bulletChar: '\uF0B7', numberedFormat: '1.' },
  { level: 2, symbolIndent: 0.5, textIndent: 1.0, bulletChar: '○', numberedFormat: 'a.' },
  { level: 3, symbolIndent: 0.75, textIndent: 1.5, bulletChar: '\uF0B7', numberedFormat: 'i.' },
  { level: 4, symbolIndent: 1.0, textIndent: 2.0, bulletChar: '○', numberedFormat: '1)' },
  { level: 5, symbolIndent: 1.25, textIndent: 2.5, bulletChar: '\uF0B7', numberedFormat: 'a)' }
];

const defaultListBulletSettings: ListBulletSettings = {
  enabled: true,
  indentationLevels: defaultIndentationLevels
};

// Note: defaultTableOfContentsSettings removed - TOC managed via Processing Options
// Note: defaultTableUniformitySettings removed - Table settings now in Processing Options

interface StylesEditorProps {
  initialStyles?: any[];
  onStylesChange?: (styles: StyleDefinition[]) => void;
  onListBulletSettingsChange?: (settings: ListBulletSettings) => void;
  tableHeader2Shading?: string;
  tableOtherShading?: string;
  onTableShadingChange?: (header2: string, other: string) => void;
  // Note: Auto-save is now implemented - no renderSaveButton needed
}

// PERFORMANCE: Wrap in memo to prevent re-renders when parent state changes
export const StylesEditor = memo(function StylesEditor({
  initialStyles,
  onStylesChange,
  onListBulletSettingsChange,
  tableHeader2Shading,
  tableOtherShading,
  onTableShadingChange
}: StylesEditorProps) {
  // Convert session styles to StyleDefinition format or use defaults
  const convertToStyleDefinitions = (sessionStyles?: any[]): StyleDefinition[] => {
    if (!sessionStyles || sessionStyles.length === 0) {
      return defaultStyles;
    }

    // Map session styles to style definitions
    return sessionStyles.map(sessionStyle => {
      const defaultStyle = defaultStyles.find(d => d.id === sessionStyle.id) || defaultStyles[0];
      return {
        id: sessionStyle.id || defaultStyle.id,
        name: sessionStyle.name || defaultStyle.name,
        fontFamily: sessionStyle.fontFamily || defaultStyle.fontFamily,
        fontSize: sessionStyle.fontSize || defaultStyle.fontSize,
        bold: sessionStyle.bold ?? defaultStyle.bold,
        italic: sessionStyle.italic ?? defaultStyle.italic,
        underline: sessionStyle.underline ?? defaultStyle.underline,
        preserveBold: sessionStyle.preserveBold ?? defaultStyle.preserveBold,
        preserveItalic: sessionStyle.preserveItalic ?? defaultStyle.preserveItalic,
        preserveUnderline: sessionStyle.preserveUnderline ?? defaultStyle.preserveUnderline,
        alignment: sessionStyle.alignment || defaultStyle.alignment,
        color: sessionStyle.color || defaultStyle.color,
        spaceBefore: sessionStyle.spaceBefore ?? defaultStyle.spaceBefore,
        spaceAfter: sessionStyle.spaceAfter ?? defaultStyle.spaceAfter,
        lineSpacing: sessionStyle.lineSpacing ?? defaultStyle.lineSpacing,
        noSpaceBetweenSame: sessionStyle.noSpaceBetweenSame ?? defaultStyle.noSpaceBetweenSame,
        indentation: sessionStyle.indentation || defaultStyle.indentation,
      };
    });
  };

  const [styles, setStyles] = useState<StyleDefinition[]>(() => convertToStyleDefinitions(initialStyles));
  const [listBulletSettings, setListBulletSettings] = useState<ListBulletSettings>(defaultListBulletSettings);
  const [localTableHeader2Shading, setLocalTableHeader2Shading] = useState<string>(tableHeader2Shading || '#BFBFBF');
  const [localTableOtherShading, setLocalTableOtherShading] = useState<string>(tableOtherShading || '#E9E9E9');
  // Note: Table of Contents settings removed - managed via Processing Options checkbox
  // Note: showSuccess state removed - no longer needed with auto-save

  const updateStyle = (styleId: string, updates: Partial<StyleDefinition>) => {
    const updatedStyles = styles.map(style =>
      style.id === styleId ? { ...style, ...updates } : style
    );
    setStyles(updatedStyles);
    // Auto-save: immediately call onStylesChange to persist changes
    onStylesChange?.(updatedStyles);
  };

  // Note: updateTableOfContentsSettings removed - TOC settings managed via Processing Options
  // Note: updateTableUniformitySettings removed - Table settings now in Processing Options

  const renderStyleEditor = (style: StyleDefinition) => {
    return (
      <div key={style.id} className="space-y-4 p-4 border border-border rounded-lg">
        <h3 className="font-semibold text-base">{style.name}</h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Font Settings */}
          <div className="space-y-3">
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Font Family</label>
              <select
                value={style.fontFamily}
                onChange={(e) => updateStyle(style.id, { fontFamily: e.target.value })}
                className="w-full px-3 py-1.5 text-sm border border-border rounded-md bg-background"
              >
                {fontFamilies.map(font => (
                  <option key={font} value={font}>{font}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Font Size</label>
              <select
                value={style.fontSize}
                onChange={(e) => updateStyle(style.id, { fontSize: Number(e.target.value) })}
                className="w-full px-3 py-1.5 text-sm border border-border rounded-md bg-background"
              >
                {fontSizes.map(size => (
                  <option key={size} value={size}>{size}pt</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Text Color</label>
              <div className="flex gap-2">
                <input
                  type="color"
                  value={style.color}
                  onChange={(e) => updateStyle(style.id, { color: e.target.value })}
                  className="h-9 w-16 border border-border rounded cursor-pointer"
                />
                <input
                  type="text"
                  value={style.color}
                  onChange={(e) => updateStyle(style.id, { color: e.target.value })}
                  className="flex-1 px-3 py-1.5 text-sm border border-border rounded-md bg-background"
                  placeholder="#000000"
                />
              </div>
            </div>
          </div>

          {/* Formatting Options */}
          <div className="space-y-3">
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Formatting</label>
              {/* Headers: Binary toggles */}
              {(style.id === 'header1' || style.id === 'header2' || style.id === 'header3') && (
                <div className="flex gap-1">
                  <button
                    onClick={() => updateStyle(style.id, { bold: !style.bold })}
                    className={cn(
                      'p-2 rounded transition-all',
                      style.bold
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted hover:bg-muted/80'
                    )}
                  >
                    <Bold className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => updateStyle(style.id, { italic: !style.italic })}
                    className={cn(
                      'p-2 rounded transition-all',
                      style.italic
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted hover:bg-muted/80'
                    )}
                  >
                    <Italic className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => updateStyle(style.id, { underline: !style.underline })}
                    className={cn(
                      'p-2 rounded transition-all',
                      style.underline
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted hover:bg-muted/80'
                    )}
                  >
                    <Underline className="w-4 h-4" />
                  </button>
                </div>
              )}
              {/* Normal & ListParagraph: Dual toggles */}
              {(style.id === 'normal' || style.id === 'listParagraph') && (
                <div className="space-y-2">
                  {/* Row 1: Format toggles */}
                  <div className="flex gap-1">
                    <button
                      onClick={() => updateStyle(style.id, { bold: !style.bold })}
                      disabled={style.preserveBold}
                      className={cn(
                        'p-2 rounded transition-all',
                        style.preserveBold
                          ? 'opacity-50 cursor-not-allowed bg-muted'
                          : style.bold
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted hover:bg-muted/80'
                      )}
                      title={style.preserveBold ? 'Bold formatting is preserved' : style.bold ? 'Bold enabled' : 'Bold disabled'}
                    >
                      <Bold className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => updateStyle(style.id, { italic: !style.italic })}
                      disabled={style.preserveItalic}
                      className={cn(
                        'p-2 rounded transition-all',
                        style.preserveItalic
                          ? 'opacity-50 cursor-not-allowed bg-muted'
                          : style.italic
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted hover:bg-muted/80'
                      )}
                      title={style.preserveItalic ? 'Italic formatting is preserved' : style.italic ? 'Italic enabled' : 'Italic disabled'}
                    >
                      <Italic className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => updateStyle(style.id, { underline: !style.underline })}
                      disabled={style.preserveUnderline}
                      className={cn(
                        'p-2 rounded transition-all',
                        style.preserveUnderline
                          ? 'opacity-50 cursor-not-allowed bg-muted'
                          : style.underline
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted hover:bg-muted/80'
                      )}
                      title={style.preserveUnderline ? 'Underline formatting is preserved' : style.underline ? 'Underline enabled' : 'Underline disabled'}
                    >
                      <Underline className="w-4 h-4" />
                    </button>
                  </div>
                  {/* Row 2: Preserve toggles */}
                  <div className="flex gap-2 text-xs">
                    <button
                      onClick={() => updateStyle(style.id, { preserveBold: !style.preserveBold })}
                      className={cn(
                        'flex items-center gap-1 px-2 py-1 rounded transition-all',
                        style.preserveBold
                          ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400'
                          : 'bg-muted hover:bg-muted/80 text-muted-foreground'
                      )}
                      title={style.preserveBold ? 'Preserve existing bold formatting' : 'Apply bold setting'}
                    >
                      <Lock className="w-3 h-3" />
                      <span>Bold</span>
                    </button>
                    <button
                      onClick={() => updateStyle(style.id, { preserveItalic: !style.preserveItalic })}
                      className={cn(
                        'flex items-center gap-1 px-2 py-1 rounded transition-all',
                        style.preserveItalic
                          ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400'
                          : 'bg-muted hover:bg-muted/80 text-muted-foreground'
                      )}
                      title={style.preserveItalic ? 'Preserve existing italic formatting' : 'Apply italic setting'}
                    >
                      <Lock className="w-3 h-3" />
                      <span>Italic</span>
                    </button>
                    <button
                      onClick={() => updateStyle(style.id, { preserveUnderline: !style.preserveUnderline })}
                      className={cn(
                        'flex items-center gap-1 px-2 py-1 rounded transition-all',
                        style.preserveUnderline
                          ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400'
                          : 'bg-muted hover:bg-muted/80 text-muted-foreground'
                      )}
                      title={style.preserveUnderline ? 'Preserve existing underline formatting' : 'Apply underline setting'}
                    >
                      <Lock className="w-3 h-3" />
                      <span>Underline</span>
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Alignment</label>
              <div className="flex gap-1">
                <button
                  onClick={() => updateStyle(style.id, { alignment: 'left' })}
                  className={cn(
                    'p-2 rounded transition-all',
                    style.alignment === 'left'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted hover:bg-muted/80'
                  )}
                >
                  <AlignLeft className="w-4 h-4" />
                </button>
                <button
                  onClick={() => updateStyle(style.id, { alignment: 'center' })}
                  className={cn(
                    'p-2 rounded transition-all',
                    style.alignment === 'center'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted hover:bg-muted/80'
                  )}
                >
                  <AlignCenter className="w-4 h-4" />
                </button>
                <button
                  onClick={() => updateStyle(style.id, { alignment: 'right' })}
                  className={cn(
                    'p-2 rounded transition-all',
                    style.alignment === 'right'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted hover:bg-muted/80'
                  )}
                >
                  <AlignRight className="w-4 h-4" />
                </button>
                <button
                  onClick={() => updateStyle(style.id, { alignment: 'justify' })}
                  className={cn(
                    'p-2 rounded transition-all',
                    style.alignment === 'justify'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted hover:bg-muted/80'
                  )}
                >
                  <AlignJustify className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="flex gap-2">
              <div className="flex-1">
                <label className="text-sm text-muted-foreground mb-1 block">Space Before</label>
                <select
                  value={style.spaceBefore}
                  onChange={(e) => updateStyle(style.id, { spaceBefore: Number(e.target.value) })}
                  className="w-full px-3 py-1.5 text-sm border border-border rounded-md bg-background"
                >
                  {spacingOptions.map(space => (
                    <option key={space} value={space}>{space}pt</option>
                  ))}
                </select>
              </div>

              <div className="flex-1">
                <label className="text-sm text-muted-foreground mb-1 block">Space After</label>
                <select
                  value={style.spaceAfter}
                  onChange={(e) => updateStyle(style.id, { spaceAfter: Number(e.target.value) })}
                  className="w-full px-3 py-1.5 text-sm border border-border rounded-md bg-background"
                >
                  {spacingOptions.map(space => (
                    <option key={space} value={space}>{space}pt</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Line Spacing</label>
              <select
                value={style.lineSpacing}
                onChange={(e) => updateStyle(style.id, { lineSpacing: Number(e.target.value) })}
                className="w-full px-3 py-1.5 text-sm border border-border rounded-md bg-background"
              >
                {lineSpacingOptions.map(option => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Style-specific options: Normal and List Paragraph */}
        {(style.id === 'normal' || style.id === 'listParagraph') && (
          <label className="flex items-center gap-3 cursor-pointer">
            <div className="relative">
              <input
                type="checkbox"
                checked={style.noSpaceBetweenSame}
                onChange={() => updateStyle(style.id, { noSpaceBetweenSame: !style.noSpaceBetweenSame })}
                className="sr-only"
              />
              <div className={cn(
                'w-5 h-5 rounded border-2 flex items-center justify-center transition-all',
                style.noSpaceBetweenSame
                  ? 'bg-primary border-primary checkbox-checked'
                  : 'border-border'
              )}>
                {style.noSpaceBetweenSame && (
                  <Check className="w-3 h-3 text-white checkbox-checkmark" />
                )}
              </div>
            </div>
            <span className="text-sm">Don't add space between paragraphs of the same style</span>
          </label>
        )}

        {/* List Paragraph indentation controls */}
        {style.id === 'listParagraph' && (
          <div className="border-t border-border pt-4 mt-4">
            <h4 className="text-sm font-medium mb-3">Indentation Settings</h4>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm text-muted-foreground mb-1 block">Bullet Position (inches)</label>
                <input
                  type="number"
                  value={style.indentation?.left ?? 0.25}
                  onChange={(e) => updateStyle(style.id, {
                    indentation: {
                      ...style.indentation,
                      left: Number(e.target.value)
                    }
                  })}
                  className="w-full px-3 py-1.5 text-sm border border-border rounded-md bg-background"
                  min="0"
                  max="2"
                  step="0.25"
                />
              </div>
              <div>
                <label className="text-sm text-muted-foreground mb-1 block">Text Position (inches)</label>
                <input
                  type="number"
                  value={style.indentation?.firstLine ?? 0.5}
                  onChange={(e) => updateStyle(style.id, {
                    indentation: {
                      ...style.indentation,
                      firstLine: Number(e.target.value)
                    }
                  })}
                  className="w-full px-3 py-1.5 text-sm border border-border rounded-md bg-background"
                  min="0"
                  max="2"
                  step="0.25"
                />
              </div>
            </div>
          </div>
        )}

        {/* Preview */}
        <div className="p-3 bg-white rounded-md border border-border">
          <div
            style={{
              fontSize: `${style.fontSize}pt`,
              fontFamily: style.fontFamily,
              fontWeight: style.bold === undefined ? 'normal' : style.bold ? 'bold' : 'normal',
              fontStyle: style.italic === undefined ? 'normal' : style.italic ? 'italic' : 'normal',
              textDecoration: style.underline === undefined ? 'none' : style.underline ? 'underline' : 'none',
              textAlign: style.alignment,
              color: style.color
            }}
          >
            Sample text for {style.name} style
            {(style.bold === undefined || style.italic === undefined || style.underline === undefined) && (
              <span className="text-xs text-muted-foreground ml-2">(preview only - actual formatting preserved)</span>
            )}
          </div>
        </div>
      </div>
    );
  };

  // Note: handleSaveStyles function removed - auto-save is now implemented
  // All changes are persisted immediately via the update helper functions

  const renderListBulletSettings = () => {
    return (
      <div className="space-y-4 p-4 border border-border rounded-lg">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <List className="w-5 h-5 text-primary" />
            <h3 className="font-semibold text-base">Lists & Bullets Uniformity</h3>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <span className="text-sm text-muted-foreground">Enable</span>
            <div className="relative">
              <input
                type="checkbox"
                checked={listBulletSettings.enabled}
                onChange={(e) => {
                  const newSettings = { ...listBulletSettings, enabled: e.target.checked };
                  setListBulletSettings(newSettings);
                  // Auto-save: immediately persist changes
                  onListBulletSettingsChange?.(newSettings);
                }}
                className="sr-only"
              />
              <div className={cn(
                'w-5 h-5 rounded border-2 flex items-center justify-center transition-all',
                listBulletSettings.enabled
                  ? 'bg-primary border-primary checkbox-checked'
                  : 'border-border'
              )}>
                {listBulletSettings.enabled && (
                  <Check className="w-3 h-3 text-white checkbox-checkmark" />
                )}
              </div>
            </div>
          </label>
        </div>

        {listBulletSettings.enabled && (
          <>
            <div className="space-y-3">
              <h4 className="text-sm font-medium text-muted-foreground">Indentation Increments (Auto-applies to all 5 levels)</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">
                    Symbol Position Increment (inches)
                    <span className="text-xxs block text-muted-foreground/60">Bullet/number position per level</span>
                  </label>
                  <input
                    type="number"
                    value={listBulletSettings.indentationLevels[0]?.symbolIndent || 0.25}
                    onChange={(e) => {
                      const increment = Number(e.target.value);
                      const newLevels: IndentationLevel[] = [
                        { level: 1, symbolIndent: increment * 1, textIndent: (listBulletSettings.indentationLevels[0]?.textIndent / listBulletSettings.indentationLevels[0]?.symbolIndent) * increment * 1, bulletChar: '\uF0B7', numberedFormat: '1.' },
                        { level: 2, symbolIndent: increment * 2, textIndent: (listBulletSettings.indentationLevels[0]?.textIndent / listBulletSettings.indentationLevels[0]?.symbolIndent) * increment * 2, bulletChar: '○', numberedFormat: 'a.' },
                        { level: 3, symbolIndent: increment * 3, textIndent: (listBulletSettings.indentationLevels[0]?.textIndent / listBulletSettings.indentationLevels[0]?.symbolIndent) * increment * 3, bulletChar: '\uF0B7', numberedFormat: 'i.' },
                        { level: 4, symbolIndent: increment * 4, textIndent: (listBulletSettings.indentationLevels[0]?.textIndent / listBulletSettings.indentationLevels[0]?.symbolIndent) * increment * 4, bulletChar: '○', numberedFormat: '1)' },
                        { level: 5, symbolIndent: increment * 5, textIndent: (listBulletSettings.indentationLevels[0]?.textIndent / listBulletSettings.indentationLevels[0]?.symbolIndent) * increment * 5, bulletChar: '\uF0B7', numberedFormat: 'a)' }
                      ];
                      const newSettings = { ...listBulletSettings, indentationLevels: newLevels };
                      setListBulletSettings(newSettings);
                      onListBulletSettingsChange?.(newSettings);
                    }}
                    className="w-full px-3 py-1.5 text-sm border border-border rounded-md bg-background"
                    min="0"
                    max="2"
                    step="0.25"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">
                    Text Position Increment (inches)
                    <span className="text-xxs block text-muted-foreground/60">Text start position per level</span>
                  </label>
                  <input
                    type="number"
                    value={listBulletSettings.indentationLevels[0]?.textIndent || 0.5}
                    onChange={(e) => {
                      const increment = Number(e.target.value);
                      const newLevels: IndentationLevel[] = [
                        { level: 1, symbolIndent: listBulletSettings.indentationLevels[0]?.symbolIndent || 0.25, textIndent: increment * 1, bulletChar: '\uF0B7', numberedFormat: '1.' },
                        { level: 2, symbolIndent: listBulletSettings.indentationLevels[1]?.symbolIndent || 0.5, textIndent: increment * 2, bulletChar: '○', numberedFormat: 'a.' },
                        { level: 3, symbolIndent: listBulletSettings.indentationLevels[2]?.symbolIndent || 0.75, textIndent: increment * 3, bulletChar: '\uF0B7', numberedFormat: 'i.' },
                        { level: 4, symbolIndent: listBulletSettings.indentationLevels[3]?.symbolIndent || 1.0, textIndent: increment * 4, bulletChar: '○', numberedFormat: '1)' },
                        { level: 5, symbolIndent: listBulletSettings.indentationLevels[4]?.symbolIndent || 1.25, textIndent: increment * 5, bulletChar: '\uF0B7', numberedFormat: 'a)' }
                      ];
                      const newSettings = { ...listBulletSettings, indentationLevels: newLevels };
                      setListBulletSettings(newSettings);
                      onListBulletSettingsChange?.(newSettings);
                    }}
                    className="w-full px-3 py-1.5 text-sm border border-border rounded-md bg-background"
                    min="0"
                    max="4"
                    step="0.25"
                  />
                </div>
              </div>

              {/* Preview of calculated levels */}
              <div className="p-3 bg-muted/20 rounded-md">
                <div className="text-xs text-muted-foreground mb-2">Calculated Indentations:</div>
                <div className="grid grid-cols-5 gap-2 text-xxs">
                  {listBulletSettings.indentationLevels.map((level) => (
                    <div key={level.level} className="text-center">
                      <div className="font-medium">L{level.level}</div>
                      <div className="text-muted-foreground">{level.symbolIndent.toFixed(2)}" / {level.textIndent.toFixed(2)}"</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Bullet Points Format */}
            <div className="space-y-3">
              <h4 className="text-sm font-medium text-muted-foreground">Bullet Points Format</h4>
              <div className="text-xs text-muted-foreground mb-2">
                Select bullet symbols for the first 3 levels. Levels 4-5 will alternate between Level 2 and Level 3 symbols.
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {/* Level 1 */}
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Level 1</label>
                  <select
                    value={listBulletSettings.indentationLevels[0]?.bulletChar || '\uF0B7'}
                    onChange={(e) => {
                      const newLevels = [...listBulletSettings.indentationLevels];
                      newLevels[0] = { ...newLevels[0], bulletChar: e.target.value };
                      const newSettings = { ...listBulletSettings, indentationLevels: newLevels };
                      setListBulletSettings(newSettings);
                      onListBulletSettingsChange?.(newSettings);
                    }}
                    className="w-full px-3 py-1.5 text-sm border border-border rounded-md bg-background"
                  >
                    <option value={'\uF0B7'}>{'\uF0B7'} Bullet (Calibri)</option>
                    <option value="○">○ Open Circle</option>
                    <option value="■">■ Closed Square</option>
                    <option value="□">□ Open Square</option>
                    <option value="▪">▪ Small Square</option>
                    <option value="▫">▫ Small Open Square</option>
                    <option value="◆">◆ Diamond</option>
                    <option value="►">► Triangle</option>
                    <option value="✓">✓ Checkmark</option>
                    <option value="-">− Dash</option>
                  </select>
                </div>
                {/* Level 2 */}
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Level 2</label>
                  <select
                    value={listBulletSettings.indentationLevels[1]?.bulletChar || '○'}
                    onChange={(e) => {
                      const newLevels = [...listBulletSettings.indentationLevels];
                      newLevels[1] = { ...newLevels[1], bulletChar: e.target.value };
                      // Update Level 4 to match Level 2 (alternating pattern)
                      newLevels[3] = { ...newLevels[3], bulletChar: e.target.value };
                      const newSettings = { ...listBulletSettings, indentationLevels: newLevels };
                      setListBulletSettings(newSettings);
                      onListBulletSettingsChange?.(newSettings);
                    }}
                    className="w-full px-3 py-1.5 text-sm border border-border rounded-md bg-background"
                  >
                    <option value={'\uF0B7'}>{'\uF0B7'} Bullet (Calibri)</option>
                    <option value="○">○ Open Circle</option>
                    <option value="■">■ Closed Square</option>
                    <option value="□">□ Open Square</option>
                    <option value="▪">▪ Small Square</option>
                    <option value="▫">▫ Small Open Square</option>
                    <option value="◆">◆ Diamond</option>
                    <option value="►">► Triangle</option>
                    <option value="✓">✓ Checkmark</option>
                    <option value="-">− Dash</option>
                  </select>
                </div>
                {/* Level 3 */}
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Level 3</label>
                  <select
                    value={listBulletSettings.indentationLevels[2]?.bulletChar || '\uF0B7'}
                    onChange={(e) => {
                      const newLevels = [...listBulletSettings.indentationLevels];
                      newLevels[2] = { ...newLevels[2], bulletChar: e.target.value };
                      // Update Level 5 to match Level 3 (alternating pattern)
                      newLevels[4] = { ...newLevels[4], bulletChar: e.target.value };
                      const newSettings = { ...listBulletSettings, indentationLevels: newLevels };
                      setListBulletSettings(newSettings);
                      onListBulletSettingsChange?.(newSettings);
                    }}
                    className="w-full px-3 py-1.5 text-sm border border-border rounded-md bg-background"
                  >
                    <option value={'\uF0B7'}>{'\uF0B7'} Bullet (Calibri)</option>
                    <option value="○">○ Open Circle</option>
                    <option value="■">■ Closed Square</option>
                    <option value="□">□ Open Square</option>
                    <option value="▪">▪ Small Square</option>
                    <option value="▫">▫ Small Open Square</option>
                    <option value="◆">◆ Diamond</option>
                    <option value="►">► Triangle</option>
                    <option value="✓">✓ Checkmark</option>
                    <option value="-">− Dash</option>
                  </select>
                </div>
              </div>
              {/* Preview of bullet pattern */}
              <div className="p-3 bg-muted/20 rounded-md">
                <div className="text-xs text-muted-foreground mb-2">Bullet Pattern Preview:</div>
                <div className="grid grid-cols-5 gap-2 text-sm">
                  {listBulletSettings.indentationLevels.map((level) => (
                    <div key={level.level} className="text-center">
                      <div className="font-medium text-xs text-muted-foreground">L{level.level}</div>
                      <div className="text-lg">{level.bulletChar}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    );
  };

  // Table Shading Settings - moved from Processing Options to Styles for better organization
  const renderTableShadingSettings = () => {
    const handleHeader2ShadingChange = (value: string) => {
      setLocalTableHeader2Shading(value);
      onTableShadingChange?.(value, localTableOtherShading);
    };

    const handleOtherShadingChange = (value: string) => {
      setLocalTableOtherShading(value);
      onTableShadingChange?.(localTableHeader2Shading, value);
    };

    return (
      <div className="space-y-4 p-4 border border-border rounded-lg">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-base">Table Shading Colors</span>
        </div>
        <p className="text-sm text-muted-foreground">
          Configure default shading colors for table cells
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-sm text-muted-foreground mb-2 block">Header 2 Table Shading</label>
            <div className="flex gap-2">
              <input
                type="color"
                value={localTableHeader2Shading}
                onChange={(e) => handleHeader2ShadingChange(e.target.value)}
                className="h-9 w-16 border border-border rounded cursor-pointer"
              />
              <input
                type="text"
                value={localTableHeader2Shading}
                onChange={(e) => handleHeader2ShadingChange(e.target.value)}
                className="flex-1 px-3 py-1.5 text-sm border border-border rounded-md bg-background"
                placeholder="#BFBFBF"
              />
            </div>
          </div>

          <div>
            <label className="text-sm text-muted-foreground mb-2 block">Other Table Shading</label>
            <div className="flex gap-2">
              <input
                type="color"
                value={localTableOtherShading}
                onChange={(e) => handleOtherShadingChange(e.target.value)}
                className="h-9 w-16 border border-border rounded cursor-pointer"
              />
              <input
                type="text"
                value={localTableOtherShading}
                onChange={(e) => handleOtherShadingChange(e.target.value)}
                className="flex-1 px-3 py-1.5 text-sm border border-border rounded-md bg-background"
                placeholder="#E9E9E9"
              />
            </div>
          </div>
        </div>
      </div>
    );
  };

  // Note: Table of Contents settings removed - TOC is now managed automatically via "Update Table of Contents Hyperlinks" checkbox in Processing Options

  return (
    <div className="space-y-4">
      {/* Note: Save button removed - all changes auto-save immediately */}

      {/* Document Uniformity Settings */}
      {renderListBulletSettings()}

      {/* Table Shading Colors */}
      {renderTableShadingSettings()}

      {/* Divider */}
      <div className="relative py-4">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-border"></div>
        </div>
        <div className="relative flex justify-center">
          <span className="bg-background px-4 text-sm text-muted-foreground">Paragraph Styles</span>
        </div>
      </div>

      {/* Individual Style Editors */}
      {styles.map(style => renderStyleEditor(style))}
    </div>
  );
});