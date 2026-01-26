import { IndentationLevel, ListBulletSettings } from '@/types/session';
import { cn } from '@/utils/cn';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Check,
  Italic,
  List,
  Lock,
  Underline,
} from 'lucide-react';
import { memo, useEffect, useState } from 'react';

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
  preserveCenterAlignment?: boolean; // Optional: true = preserve center alignment if paragraph is already centered
  alignment: 'left' | 'center' | 'right' | 'justify';
  spaceBefore: number;
  spaceAfter: number;
  lineSpacing: number; // 1.0 = single, 1.15 = Word default, 1.5, 2.0 = double
  color: string;
  noSpaceBetweenSame?: boolean;
  indentation?: {
    left?: number; // Left indent in inches (e.g., 0.25" for bullet position)
    firstLine?: number; // First line indent in inches (e.g., 0.5" for text position)
  };
}

const defaultStyles: StyleDefinition[] = [
  {
    id: 'header1',
    name: 'Heading 1',
    fontSize: 18,
    fontFamily: 'Verdana',
    bold: true,
    italic: false,
    underline: false,
    alignment: 'left',
    spaceBefore: 0,
    spaceAfter: 12,
    lineSpacing: 1.0, // Single spacing for headings
    color: '#000000',
  },
  {
    id: 'header2',
    name: 'Heading 2',
    fontSize: 14,
    fontFamily: 'Verdana',
    bold: true,
    italic: false,
    underline: false,
    alignment: 'left',
    spaceBefore: 6,
    spaceAfter: 6,
    lineSpacing: 1.0, // Single spacing for headings
    color: '#000000',
  },
  {
    id: 'header3',
    name: 'Heading 3',
    fontSize: 12,
    fontFamily: 'Verdana',
    bold: true,
    italic: false,
    underline: false,
    alignment: 'left',
    spaceBefore: 3,
    spaceAfter: 3,
    lineSpacing: 1.0, // Single spacing for headings
    color: '#000000',
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
    preserveCenterAlignment: true, // Preserve center alignment if paragraph is already centered
    alignment: 'left',
    spaceBefore: 3,
    spaceAfter: 3,
    lineSpacing: 1.0, // Changed from 1.15 to 1.0
    color: '#000000',
    noSpaceBetweenSame: false, // Allow spacing between Normal paragraphs (Requirement 5)
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
      left: 0.25, // Bullet position at 0.25 inches
      firstLine: 0.5, // Text position at 0.5 inches (0.25 additional from left)
    },
  },
];

const fontSizes = Array.from({ length: 65 }, (_, i) => i + 8); // 8pt to 72pt
const fontFamilies = ['Verdana', 'Arial', 'Times New Roman', 'Calibri', 'Georgia', 'Helvetica'];
const spacingOptions = Array.from({ length: 25 }, (_, i) => i * 3); // 0pt to 72pt in increments of 3
const lineSpacingOptions = [
  { value: 1.0, label: 'Single' },
  { value: 1.15, label: '1.15 (Default)' },
  { value: 1.5, label: '1.5 Lines' },
  { value: 2.0, label: 'Double' },
];

// Default indentation levels based on documentation best practices
// Using closed bullet (•) for all levels for consistency
// Symbol indent: 0.25" base with 0.25" increments per level
// Text indent: symbol indent + 0.25" hanging indent
// NOTE: Levels are 0-based (0-8) per DOCX standard
// NOTE: Using Unicode bullets instead of Wingdings private-use characters for reliable rendering
const defaultIndentationLevels: IndentationLevel[] = [
  { level: 0, symbolIndent: 0.25, textIndent: 0.5, bulletChar: '•', numberedFormat: '1.' },
  { level: 1, symbolIndent: 0.5, textIndent: 0.75, bulletChar: '○', numberedFormat: 'a.' },
  { level: 2, symbolIndent: 0.75, textIndent: 1.0, bulletChar: '•', numberedFormat: 'i.' },
  { level: 3, symbolIndent: 1.0, textIndent: 1.25, bulletChar: '○', numberedFormat: '1)' },
  { level: 4, symbolIndent: 1.25, textIndent: 1.5, bulletChar: '•', numberedFormat: 'a)' },
];

const defaultListBulletSettings: ListBulletSettings = {
  enabled: true,
  indentationLevels: defaultIndentationLevels,
};

// Note: defaultTableOfContentsSettings removed - TOC managed via Processing Options
// Note: defaultTableUniformitySettings removed - Table settings now in Processing Options

/**
 * Convert session styles to StyleDefinition format or use defaults.
 * MOVED OUTSIDE COMPONENT: This is a pure function that doesn't depend on component state,
 * so moving it outside fixes the useEffect dependency warning and improves performance.
 */
const convertToStyleDefinitions = (
  sessionStyles?: Partial<StyleDefinition>[]
): StyleDefinition[] => {
  if (!sessionStyles || sessionStyles.length === 0) {
    return defaultStyles;
  }

  // Map session styles to style definitions
  return sessionStyles.map((sessionStyle) => {
    const defaultStyle = defaultStyles.find((d) => d.id === sessionStyle.id) || defaultStyles[0];
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
      preserveCenterAlignment:
        sessionStyle.preserveCenterAlignment ?? defaultStyle.preserveCenterAlignment,
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

interface TablePaddingSettings {
  padding1x1Top: number;
  padding1x1Bottom: number;
  padding1x1Left: number;
  padding1x1Right: number;
  paddingOtherTop: number;
  paddingOtherBottom: number;
  paddingOtherLeft: number;
  paddingOtherRight: number;
  cellBorderThickness?: number;
}

interface StylesEditorProps {
  initialStyles?: Partial<StyleDefinition>[];
  initialListBulletSettings?: ListBulletSettings;
  onStylesChange?: (styles: StyleDefinition[]) => void;
  onListBulletSettingsChange?: (settings: ListBulletSettings) => void;
  tableHeader2Shading?: string;
  tableOtherShading?: string;
  imageBorderWidth?: number;
  // Table padding props (in inches)
  padding1x1Top?: number;
  padding1x1Bottom?: number;
  padding1x1Left?: number;
  padding1x1Right?: number;
  paddingOtherTop?: number;
  paddingOtherBottom?: number;
  paddingOtherLeft?: number;
  paddingOtherRight?: number;
  cellBorderThickness?: number;
  onTableShadingChange?: (
    header2: string,
    other: string,
    imageBorderWidth?: number,
    paddingSettings?: TablePaddingSettings
  ) => void;
}

// PERFORMANCE: Wrap in memo to prevent re-renders when parent state changes
export const StylesEditor = memo(function StylesEditor({
  initialStyles,
  initialListBulletSettings,
  onStylesChange,
  onListBulletSettingsChange,
  tableHeader2Shading,
  tableOtherShading,
  imageBorderWidth,
  padding1x1Top,
  padding1x1Bottom,
  padding1x1Left,
  padding1x1Right,
  paddingOtherTop,
  paddingOtherBottom,
  paddingOtherLeft,
  paddingOtherRight,
  cellBorderThickness,
  onTableShadingChange,
}: StylesEditorProps) {
  // NOTE: convertToStyleDefinitions is now defined outside component for better performance
  // and to fix useEffect dependency warning

  const [styles, setStyles] = useState<StyleDefinition[]>(() =>
    convertToStyleDefinitions(initialStyles)
  );
  const [listBulletSettings, setListBulletSettings] = useState<ListBulletSettings>(
    initialListBulletSettings || defaultListBulletSettings
  );
  const [localTableHeader2Shading, setLocalTableHeader2Shading] = useState<string>(
    tableHeader2Shading || '#BFBFBF'
  );
  const [localTableOtherShading, setLocalTableOtherShading] = useState<string>(
    tableOtherShading || '#DFDFDF'
  );
  const [localImageBorderWidth, setLocalImageBorderWidth] = useState<number>(
    imageBorderWidth ?? 1.0
  );
  // Clamp padding value to valid range (0-1 inch)
  const clampPadding = (value: number | undefined, defaultValue: number): number => {
    if (value === undefined) return defaultValue;
    return Math.max(0, Math.min(1, value));
  };

  // Table padding state (in inches) - values clamped to 0-1 inch range
  const [localPadding1x1Top, setLocalPadding1x1Top] = useState<number>(clampPadding(padding1x1Top, 0));
  const [localPadding1x1Bottom, setLocalPadding1x1Bottom] = useState<number>(clampPadding(padding1x1Bottom, 0));
  const [localPadding1x1Left, setLocalPadding1x1Left] = useState<number>(clampPadding(padding1x1Left, 0.08));
  const [localPadding1x1Right, setLocalPadding1x1Right] = useState<number>(clampPadding(padding1x1Right, 0.08));
  const [localPaddingOtherTop, setLocalPaddingOtherTop] = useState<number>(clampPadding(paddingOtherTop, 0));
  const [localPaddingOtherBottom, setLocalPaddingOtherBottom] = useState<number>(clampPadding(paddingOtherBottom, 0));
  const [localPaddingOtherLeft, setLocalPaddingOtherLeft] = useState<number>(clampPadding(paddingOtherLeft, 0.08));
  const [localPaddingOtherRight, setLocalPaddingOtherRight] = useState<number>(clampPadding(paddingOtherRight, 0.08));
  const [localCellBorderThickness, setLocalCellBorderThickness] = useState<number>(cellBorderThickness ?? 0.5);

  // Sync internal state when external props change
  // This fixes the issue where useState initializer only runs once
  useEffect(() => {
    if (initialStyles) {
      setStyles(convertToStyleDefinitions(initialStyles));
    }
  }, [initialStyles]);

  useEffect(() => {
    if (initialListBulletSettings) {
      setListBulletSettings(initialListBulletSettings);
    }
  }, [initialListBulletSettings]);

  useEffect(() => {
    if (tableHeader2Shading !== undefined) {
      setLocalTableHeader2Shading(tableHeader2Shading);
    }
  }, [tableHeader2Shading]);

  useEffect(() => {
    if (tableOtherShading !== undefined) {
      setLocalTableOtherShading(tableOtherShading);
    }
  }, [tableOtherShading]);

  useEffect(() => {
    if (imageBorderWidth !== undefined) {
      setLocalImageBorderWidth(imageBorderWidth);
    }
  }, [imageBorderWidth]);

  useEffect(() => {
    if (cellBorderThickness !== undefined) {
      setLocalCellBorderThickness(cellBorderThickness);
    }
  }, [cellBorderThickness]);

  // Sync all padding props when they change (single effect for better reliability)
  useEffect(() => {
    if (padding1x1Top !== undefined) setLocalPadding1x1Top(clampPadding(padding1x1Top, 0));
    if (padding1x1Bottom !== undefined) setLocalPadding1x1Bottom(clampPadding(padding1x1Bottom, 0));
    if (padding1x1Left !== undefined) setLocalPadding1x1Left(clampPadding(padding1x1Left, 0.08));
    if (padding1x1Right !== undefined) setLocalPadding1x1Right(clampPadding(padding1x1Right, 0.08));
    if (paddingOtherTop !== undefined) setLocalPaddingOtherTop(clampPadding(paddingOtherTop, 0));
    if (paddingOtherBottom !== undefined) setLocalPaddingOtherBottom(clampPadding(paddingOtherBottom, 0));
    if (paddingOtherLeft !== undefined) setLocalPaddingOtherLeft(clampPadding(paddingOtherLeft, 0.08));
    if (paddingOtherRight !== undefined) setLocalPaddingOtherRight(clampPadding(paddingOtherRight, 0.08));
  }, [
    padding1x1Top, padding1x1Bottom, padding1x1Left, padding1x1Right,
    paddingOtherTop, paddingOtherBottom, paddingOtherLeft, paddingOtherRight
  ]);

  const updateStyle = (styleId: string, updates: Partial<StyleDefinition>) => {
    const updatedStyles = styles.map((style) =>
      style.id === styleId ? { ...style, ...updates } : style
    );
    setStyles(updatedStyles);
    // Auto-save: immediately call onStylesChange to persist changes
    onStylesChange?.(updatedStyles);
  };

  const renderStyleEditor = (style: StyleDefinition) => {
    return (
      <div key={style.id} className="space-y-4 p-4 border border-border rounded-lg">
        <h3 className="font-semibold text-base">{style.name}</h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Font Settings */}
          <div className="space-y-3">
            <div>
              <label
                htmlFor={`${style.id}-font-family`}
                className="text-sm text-muted-foreground mb-1 block"
              >
                Font Family
              </label>
              <select
                id={`${style.id}-font-family`}
                value={style.fontFamily}
                onChange={(e) => updateStyle(style.id, { fontFamily: e.target.value })}
                className="w-full px-3 py-1.5 text-sm border border-border rounded-md bg-background"
              >
                {fontFamilies.map((font) => (
                  <option key={font} value={font}>
                    {font}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor={`${style.id}-font-size`}
                className="text-sm text-muted-foreground mb-1 block"
              >
                Font Size
              </label>
              <select
                id={`${style.id}-font-size`}
                value={style.fontSize}
                onChange={(e) => updateStyle(style.id, { fontSize: Number(e.target.value) })}
                className="w-full px-3 py-1.5 text-sm border border-border rounded-md bg-background"
              >
                {fontSizes.map((size) => (
                  <option key={size} value={size}>
                    {size}pt
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor={`${style.id}-text-color`}
                className="text-sm text-muted-foreground mb-1 block"
              >
                Text Color
              </label>
              <div className="flex gap-2">
                <input
                  id={`${style.id}-text-color`}
                  type="color"
                  value={style.color}
                  onChange={(e) => updateStyle(style.id, { color: e.target.value })}
                  className="h-9 w-16 border border-border rounded cursor-pointer"
                  aria-label={`${style.name} text color picker`}
                />
                <input
                  type="text"
                  value={style.color}
                  onChange={(e) => updateStyle(style.id, { color: e.target.value })}
                  className="flex-1 px-3 py-1.5 text-sm border border-border rounded-md bg-background"
                  placeholder="#000000"
                  aria-label={`${style.name} text color hex value`}
                />
              </div>
            </div>
          </div>

          {/* Formatting Options */}
          <div className="space-y-3">
            <div>
              <span className="text-sm text-muted-foreground mb-1 block" id={`${style.id}-formatting-label`}>
                Formatting
              </span>
              {/* Headers: Binary toggles */}
              {(style.id === 'header1' || style.id === 'header2' || style.id === 'header3') && (
                <div className="flex gap-1" role="group" aria-labelledby={`${style.id}-formatting-label`}>
                  <button
                    onClick={() => updateStyle(style.id, { bold: !style.bold })}
                    className={cn(
                      'p-2 rounded transition-all',
                      style.bold
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted hover:bg-muted/80'
                    )}
                    aria-label={`Toggle bold for ${style.name}`}
                    aria-pressed={style.bold}
                  >
                    <Bold className="w-4 h-4" aria-hidden="true" />
                  </button>
                  <button
                    onClick={() => updateStyle(style.id, { italic: !style.italic })}
                    className={cn(
                      'p-2 rounded transition-all',
                      style.italic
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted hover:bg-muted/80'
                    )}
                    aria-label={`Toggle italic for ${style.name}`}
                    aria-pressed={style.italic}
                  >
                    <Italic className="w-4 h-4" aria-hidden="true" />
                  </button>
                  <button
                    onClick={() => updateStyle(style.id, { underline: !style.underline })}
                    className={cn(
                      'p-2 rounded transition-all',
                      style.underline
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted hover:bg-muted/80'
                    )}
                    aria-label={`Toggle underline for ${style.name}`}
                    aria-pressed={style.underline}
                  >
                    <Underline className="w-4 h-4" aria-hidden="true" />
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
                      title={
                        style.preserveBold
                          ? 'Bold formatting is preserved'
                          : style.bold
                            ? 'Bold enabled'
                            : 'Bold disabled'
                      }
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
                      title={
                        style.preserveItalic
                          ? 'Italic formatting is preserved'
                          : style.italic
                            ? 'Italic enabled'
                            : 'Italic disabled'
                      }
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
                      title={
                        style.preserveUnderline
                          ? 'Underline formatting is preserved'
                          : style.underline
                            ? 'Underline enabled'
                            : 'Underline disabled'
                      }
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
                      title={
                        style.preserveBold
                          ? 'Preserve existing bold formatting'
                          : 'Apply bold setting'
                      }
                    >
                      <Lock className="w-3 h-3" />
                      <span>Bold</span>
                    </button>
                    <button
                      onClick={() =>
                        updateStyle(style.id, { preserveItalic: !style.preserveItalic })
                      }
                      className={cn(
                        'flex items-center gap-1 px-2 py-1 rounded transition-all',
                        style.preserveItalic
                          ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400'
                          : 'bg-muted hover:bg-muted/80 text-muted-foreground'
                      )}
                      title={
                        style.preserveItalic
                          ? 'Preserve existing italic formatting'
                          : 'Apply italic setting'
                      }
                    >
                      <Lock className="w-3 h-3" />
                      <span>Italic</span>
                    </button>
                    <button
                      onClick={() =>
                        updateStyle(style.id, { preserveUnderline: !style.preserveUnderline })
                      }
                      className={cn(
                        'flex items-center gap-1 px-2 py-1 rounded transition-all',
                        style.preserveUnderline
                          ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400'
                          : 'bg-muted hover:bg-muted/80 text-muted-foreground'
                      )}
                      title={
                        style.preserveUnderline
                          ? 'Preserve existing underline formatting'
                          : 'Apply underline setting'
                      }
                    >
                      <Lock className="w-3 h-3" />
                      <span>Underline</span>
                    </button>
                    {style.id === 'normal' && (
                      <button
                        onClick={() =>
                          updateStyle(style.id, {
                            preserveCenterAlignment: !(style.preserveCenterAlignment ?? true),
                          })
                        }
                        className={cn(
                          'flex items-center gap-1 px-2 py-1 rounded transition-all',
                          (style.preserveCenterAlignment ?? true)
                            ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400'
                            : 'bg-muted hover:bg-muted/80 text-muted-foreground'
                        )}
                        title={
                          (style.preserveCenterAlignment ?? true)
                            ? 'Preserve center alignment if paragraph is centered'
                            : 'Apply alignment setting to all paragraphs'
                        }
                      >
                        <Lock className="w-3 h-3" />
                        <span>Center</span>
                      </button>
                    )}
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
                  {spacingOptions.map((space) => (
                    <option key={space} value={space}>
                      {space}pt
                    </option>
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
                  {spacingOptions.map((space) => (
                    <option key={space} value={space}>
                      {space}pt
                    </option>
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
                {lineSpacingOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
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
                onChange={() =>
                  updateStyle(style.id, { noSpaceBetweenSame: !style.noSpaceBetweenSame })
                }
                className="sr-only"
              />
              <div
                className={cn(
                  'w-5 h-5 rounded border-2 flex items-center justify-center transition-all',
                  style.noSpaceBetweenSame
                    ? 'bg-primary border-primary checkbox-checked'
                    : 'border-border'
                )}
              >
                {style.noSpaceBetweenSame && (
                  <Check className="w-3 h-3 text-white checkbox-checkmark" />
                )}
              </div>
            </div>
            <span className="text-sm">Don't add space between paragraphs of the same style</span>
          </label>
        )}

        {/* Preview */}
        <div className="p-3 bg-white rounded-md border border-border">
          <div
            style={{
              fontSize: `${style.fontSize}pt`,
              fontFamily: style.fontFamily,
              fontWeight: style.bold === undefined ? 'normal' : style.bold ? 'bold' : 'normal',
              fontStyle: style.italic === undefined ? 'normal' : style.italic ? 'italic' : 'normal',
              textDecoration:
                style.underline === undefined ? 'none' : style.underline ? 'underline' : 'none',
              textAlign: style.alignment,
              color: style.color,
            }}
          >
            Sample text for {style.name} style
            {(style.bold === undefined ||
              style.italic === undefined ||
              style.underline === undefined) && (
              <span className="text-xs text-muted-foreground ml-2">
                (preview only - actual formatting preserved)
              </span>
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
        <div className="flex items-center gap-2">
          <List className="w-5 h-5 text-primary" />
          <h3 className="font-semibold text-base">Lists & Bullets Uniformity</h3>
        </div>

        <div className="space-y-3">
          <h4 className="text-sm font-medium text-muted-foreground">
            Indentation Settings
          </h4>
          <p className="text-xs text-muted-foreground">
            Adjust symbol position per level. Text follows with 0.25" hanging indent.
          </p>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs text-muted-foreground">
                Symbol Position Increment
              </label>
              <span className="text-sm font-medium tabular-nums">
                {(listBulletSettings.indentationLevels[0]?.symbolIndent || 0.5).toFixed(2)}"
              </span>
            </div>
            <input
              type="range"
              value={listBulletSettings.indentationLevels[0]?.symbolIndent || 0.5}
              onChange={(e) => {
                const increment = Number(e.target.value);
                const hangingIndent = 0.25; // Fixed hanging indent
                // Default pattern: closed, open, closed, open, closed
                const newLevels: IndentationLevel[] = [
                  {
                    level: 0,
                    symbolIndent: increment * 1,
                    textIndent: increment * 1 + hangingIndent,
                    bulletChar: listBulletSettings.indentationLevels[0]?.bulletChar || '•',
                    numberedFormat: '1.',
                  },
                  {
                    level: 1,
                    symbolIndent: increment * 2,
                    textIndent: increment * 2 + hangingIndent,
                    bulletChar: listBulletSettings.indentationLevels[1]?.bulletChar || '○',
                    numberedFormat: 'a.',
                  },
                  {
                    level: 2,
                    symbolIndent: increment * 3,
                    textIndent: increment * 3 + hangingIndent,
                    bulletChar: listBulletSettings.indentationLevels[2]?.bulletChar || '•',
                    numberedFormat: 'i.',
                  },
                  {
                    level: 3,
                    symbolIndent: increment * 4,
                    textIndent: increment * 4 + hangingIndent,
                    bulletChar: listBulletSettings.indentationLevels[3]?.bulletChar || '○',
                    numberedFormat: '1)',
                  },
                  {
                    level: 4,
                    symbolIndent: increment * 5,
                    textIndent: increment * 5 + hangingIndent,
                    bulletChar: listBulletSettings.indentationLevels[4]?.bulletChar || '•',
                    numberedFormat: 'a)',
                  },
                ];
                // Only update local state for visual feedback during drag
                setListBulletSettings({ ...listBulletSettings, indentationLevels: newLevels });
              }}
              onPointerUp={() => {
                // Save to parent only on release
                onListBulletSettingsChange?.(listBulletSettings);
              }}
              onMouseUp={() => {
                // Fallback for non-pointer devices
                onListBulletSettingsChange?.(listBulletSettings);
              }}
              className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
              min="0.25"
              max="1.5"
              step="0.25"
            />
            <div className="flex justify-between text-xxs text-muted-foreground">
              <span>0.25"</span>
              <span>1.5"</span>
            </div>
          </div>

              {/* Preview of calculated levels */}
              <div className="p-3 bg-muted/20 rounded-md">
                <div className="text-xs text-muted-foreground mb-2">Calculated Indentations:</div>
                <div className="grid grid-cols-5 gap-2 text-xxs">
                  {listBulletSettings.indentationLevels.map((level: IndentationLevel) => (
                    <div key={level.level} className="text-center">
                      <div className="font-medium">L{level.level}</div>
                      <div className="text-muted-foreground">
                        {level.symbolIndent.toFixed(2)}" / {level.textIndent.toFixed(2)}"
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Bullet Points Format */}
            <div className="space-y-3">
              <h4 className="text-sm font-medium text-muted-foreground">Bullet Points Format</h4>
              <div className="text-xs text-muted-foreground mb-2">
                Configure bullet symbols for each of the 5 indentation levels.
              </div>
              <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                {/* Level 0 - Default: Closed */}
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Level 0</label>
                  <select
                    value={listBulletSettings.indentationLevels[0]?.bulletChar || '•'}
                    onChange={(e) => {
                      const newLevels = [...listBulletSettings.indentationLevels];
                      newLevels[0] = { ...newLevels[0], bulletChar: e.target.value };
                      const newSettings = { ...listBulletSettings, indentationLevels: newLevels };
                      setListBulletSettings(newSettings);
                      onListBulletSettingsChange?.(newSettings);
                    }}
                    className="w-full px-3 py-1.5 text-sm border border-border rounded-md bg-background"
                  >
                    <option value="•">• Closed Bullet</option>
                    <option value="○">○ Open Bullet</option>
                    <option value="■">■ Closed Square</option>
                  </select>
                </div>
                {/* Level 1 - Default: Open */}
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Level 1</label>
                  <select
                    value={listBulletSettings.indentationLevels[1]?.bulletChar || '○'}
                    onChange={(e) => {
                      const newLevels = [...listBulletSettings.indentationLevels];
                      newLevels[1] = { ...newLevels[1], bulletChar: e.target.value };
                      const newSettings = { ...listBulletSettings, indentationLevels: newLevels };
                      setListBulletSettings(newSettings);
                      onListBulletSettingsChange?.(newSettings);
                    }}
                    className="w-full px-3 py-1.5 text-sm border border-border rounded-md bg-background"
                  >
                    <option value="•">• Closed Bullet</option>
                    <option value="○">○ Open Bullet</option>
                    <option value="■">■ Closed Square</option>
                  </select>
                </div>
                {/* Level 2 - Default: Closed */}
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Level 2</label>
                  <select
                    value={listBulletSettings.indentationLevels[2]?.bulletChar || '•'}
                    onChange={(e) => {
                      const newLevels = [...listBulletSettings.indentationLevels];
                      newLevels[2] = { ...newLevels[2], bulletChar: e.target.value };
                      const newSettings = { ...listBulletSettings, indentationLevels: newLevels };
                      setListBulletSettings(newSettings);
                      onListBulletSettingsChange?.(newSettings);
                    }}
                    className="w-full px-3 py-1.5 text-sm border border-border rounded-md bg-background"
                  >
                    <option value="•">• Closed Bullet</option>
                    <option value="○">○ Open Bullet</option>
                    <option value="■">■ Closed Square</option>
                  </select>
                </div>
                {/* Level 3 - Default: Open */}
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Level 3</label>
                  <select
                    value={listBulletSettings.indentationLevels[3]?.bulletChar || '○'}
                    onChange={(e) => {
                      const newLevels = [...listBulletSettings.indentationLevels];
                      newLevels[3] = { ...newLevels[3], bulletChar: e.target.value };
                      const newSettings = { ...listBulletSettings, indentationLevels: newLevels };
                      setListBulletSettings(newSettings);
                      onListBulletSettingsChange?.(newSettings);
                    }}
                    className="w-full px-3 py-1.5 text-sm border border-border rounded-md bg-background"
                  >
                    <option value="•">• Closed Bullet</option>
                    <option value="○">○ Open Bullet</option>
                    <option value="■">■ Closed Square</option>
                  </select>
                </div>
                {/* Level 4 - Default: Closed */}
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Level 4</label>
                  <select
                    value={listBulletSettings.indentationLevels[4]?.bulletChar || '•'}
                    onChange={(e) => {
                      const newLevels = [...listBulletSettings.indentationLevels];
                      newLevels[4] = { ...newLevels[4], bulletChar: e.target.value };
                      const newSettings = { ...listBulletSettings, indentationLevels: newLevels };
                      setListBulletSettings(newSettings);
                      onListBulletSettingsChange?.(newSettings);
                    }}
                    className="w-full px-3 py-1.5 text-sm border border-border rounded-md bg-background"
                  >
                    <option value="•">• Closed Bullet</option>
                    <option value="○">○ Open Bullet</option>
                    <option value="■">■ Closed Square</option>
                  </select>
                </div>
              </div>
              {/* Preview of bullet pattern */}
              <div className="p-3 bg-muted/20 rounded-md">
                <div className="text-xs text-muted-foreground mb-2">Bullet Pattern Preview:</div>
                <div className="grid grid-cols-5 gap-2 text-sm">
                  {listBulletSettings.indentationLevels.map((level: IndentationLevel) => (
                    <div key={level.level} className="text-center">
                      <div className="font-medium text-xs text-muted-foreground">
                        L{level.level}
                      </div>
                      <div className="text-lg">
                        {level.bulletChar}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
      </div>
    );
  };

  // Table Shading Settings - moved from Processing Options to Styles for better organization
  const renderTableShadingSettings = () => {
    // Helper to get current padding settings (and border thickness)
    const getCurrentPaddingSettings = (): TablePaddingSettings => ({
      padding1x1Top: localPadding1x1Top,
      padding1x1Bottom: localPadding1x1Bottom,
      padding1x1Left: localPadding1x1Left,
      padding1x1Right: localPadding1x1Right,
      paddingOtherTop: localPaddingOtherTop,
      paddingOtherBottom: localPaddingOtherBottom,
      paddingOtherLeft: localPaddingOtherLeft,
      paddingOtherRight: localPaddingOtherRight,
      cellBorderThickness: localCellBorderThickness,
    });

    const handleHeader2ShadingChange = (value: string) => {
      setLocalTableHeader2Shading(value);
      onTableShadingChange?.(value, localTableOtherShading, localImageBorderWidth, getCurrentPaddingSettings());
    };

    const handleOtherShadingChange = (value: string) => {
      setLocalTableOtherShading(value);
      onTableShadingChange?.(localTableHeader2Shading, value, localImageBorderWidth, getCurrentPaddingSettings());
    };

    const handleImageBorderWidthChange = (value: string) => {
      const numValue = parseFloat(value);
      if (!isNaN(numValue) && numValue >= 0.5 && numValue <= 10) {
        setLocalImageBorderWidth(numValue);
        onTableShadingChange?.(localTableHeader2Shading, localTableOtherShading, numValue, getCurrentPaddingSettings());
      }
    };

    // Handle padding changes - update local state and call parent callback
    const handlePaddingChange = (
      field: keyof TablePaddingSettings,
      value: string,
      setter: React.Dispatch<React.SetStateAction<number>>
    ) => {
      const numValue = parseFloat(value);
      if (!isNaN(numValue) && numValue >= 0 && numValue <= 1) {
        setter(numValue);
        const updatedPadding = { ...getCurrentPaddingSettings(), [field]: numValue };
        onTableShadingChange?.(localTableHeader2Shading, localTableOtherShading, localImageBorderWidth, updatedPadding);
      }
    };

    const handleCellBorderThicknessChange = (value: string) => {
      const numValue = parseFloat(value);
      if (!isNaN(numValue)) {
        setLocalCellBorderThickness(numValue);
        const updatedPadding = { ...getCurrentPaddingSettings(), cellBorderThickness: numValue };
        onTableShadingChange?.(localTableHeader2Shading, localTableOtherShading, localImageBorderWidth, updatedPadding);
      }
    };

    // Cell border thickness options in points
    const borderThicknessOptions = [
      { value: 0.25, label: '0.25 pt' },
      { value: 0.5, label: '0.5 pt (Default)' },
      { value: 0.75, label: '0.75 pt' },
      { value: 1, label: '1 pt' },
      { value: 1.5, label: '1.5 pt' },
      { value: 2, label: '2 pt' },
      { value: 2.25, label: '2.25 pt' },
      { value: 3, label: '3 pt' },
    ];

    return (
      <div className="space-y-4 p-4 border border-border rounded-lg">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-base">Table & Image Settings</span>
        </div>
        <p className="text-sm text-muted-foreground">
          Configure default shading colors for table cells, image border width, and cell padding
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="text-sm text-muted-foreground mb-2 block">
              Header 2 Table Shading
            </label>
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
                placeholder="#DFDFDF"
              />
            </div>
          </div>

          <div>
            <label className="text-sm text-muted-foreground mb-2 block">Image Border Width</label>
            <div className="flex gap-2 items-center">
              <input
                type="number"
                step="0.5"
                min="0.5"
                max="10"
                value={localImageBorderWidth}
                onChange={(e) => handleImageBorderWidthChange(e.target.value)}
                className="w-24 px-3 py-1.5 text-sm border border-border rounded-md bg-background"
              />
              <span className="text-sm text-muted-foreground">pt</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Border thickness for centered images (0.5 - 10pt)
            </p>
          </div>
        </div>

        {/* Cell Border Thickness Section */}
        <div className="pt-4 border-t border-border">
          <h4 className="text-sm font-medium mb-3">Cell Border Thickness</h4>
          <p className="text-xs text-muted-foreground mb-4">
            Set the border thickness for all table cells. Borders with color #FFC000 will preserve their color.
          </p>
          <div className="flex gap-2 items-center">
            <select
              value={localCellBorderThickness}
              onChange={(e) => handleCellBorderThicknessChange(e.target.value)}
              className="w-48 px-3 py-1.5 text-sm border border-border rounded-md bg-background"
            >
              {borderThicknessOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Table Cell Padding Section */}
        <div className="pt-4 border-t border-border">
          <h4 className="text-sm font-medium mb-3">Table Cell Padding</h4>
          <p className="text-xs text-muted-foreground mb-4">
            Set cell padding for 1x1 tables and other tables. Values are in inches.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* 1x1 Tables Padding */}
            <div className="space-y-3">
              <h5 className="text-sm font-medium text-muted-foreground">1x1 Tables</h5>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Top</label>
                  <div className="flex gap-1 items-center">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      max="1"
                      value={localPadding1x1Top}
                      onChange={(e) => handlePaddingChange('padding1x1Top', e.target.value, setLocalPadding1x1Top)}
                      className="w-20 px-2 py-1 text-sm border border-border rounded-md bg-background"
                    />
                    <span className="text-xs text-muted-foreground">"</span>
                  </div>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Bottom</label>
                  <div className="flex gap-1 items-center">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      max="1"
                      value={localPadding1x1Bottom}
                      onChange={(e) => handlePaddingChange('padding1x1Bottom', e.target.value, setLocalPadding1x1Bottom)}
                      className="w-20 px-2 py-1 text-sm border border-border rounded-md bg-background"
                    />
                    <span className="text-xs text-muted-foreground">"</span>
                  </div>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Left</label>
                  <div className="flex gap-1 items-center">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      max="1"
                      value={localPadding1x1Left}
                      onChange={(e) => handlePaddingChange('padding1x1Left', e.target.value, setLocalPadding1x1Left)}
                      className="w-20 px-2 py-1 text-sm border border-border rounded-md bg-background"
                    />
                    <span className="text-xs text-muted-foreground">"</span>
                  </div>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Right</label>
                  <div className="flex gap-1 items-center">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      max="1"
                      value={localPadding1x1Right}
                      onChange={(e) => handlePaddingChange('padding1x1Right', e.target.value, setLocalPadding1x1Right)}
                      className="w-20 px-2 py-1 text-sm border border-border rounded-md bg-background"
                    />
                    <span className="text-xs text-muted-foreground">"</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Other Tables Padding */}
            <div className="space-y-3">
              <h5 className="text-sm font-medium text-muted-foreground">Other Tables</h5>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Top</label>
                  <div className="flex gap-1 items-center">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      max="1"
                      value={localPaddingOtherTop}
                      onChange={(e) => handlePaddingChange('paddingOtherTop', e.target.value, setLocalPaddingOtherTop)}
                      className="w-20 px-2 py-1 text-sm border border-border rounded-md bg-background"
                    />
                    <span className="text-xs text-muted-foreground">"</span>
                  </div>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Bottom</label>
                  <div className="flex gap-1 items-center">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      max="1"
                      value={localPaddingOtherBottom}
                      onChange={(e) => handlePaddingChange('paddingOtherBottom', e.target.value, setLocalPaddingOtherBottom)}
                      className="w-20 px-2 py-1 text-sm border border-border rounded-md bg-background"
                    />
                    <span className="text-xs text-muted-foreground">"</span>
                  </div>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Left</label>
                  <div className="flex gap-1 items-center">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      max="1"
                      value={localPaddingOtherLeft}
                      onChange={(e) => handlePaddingChange('paddingOtherLeft', e.target.value, setLocalPaddingOtherLeft)}
                      className="w-20 px-2 py-1 text-sm border border-border rounded-md bg-background"
                    />
                    <span className="text-xs text-muted-foreground">"</span>
                  </div>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Right</label>
                  <div className="flex gap-1 items-center">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      max="1"
                      value={localPaddingOtherRight}
                      onChange={(e) => handlePaddingChange('paddingOtherRight', e.target.value, setLocalPaddingOtherRight)}
                      className="w-20 px-2 py-1 text-sm border border-border rounded-md bg-background"
                    />
                    <span className="text-xs text-muted-foreground">"</span>
                  </div>
                </div>
              </div>
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
      {styles.map((style) => renderStyleEditor(style))}
    </div>
  );
});
