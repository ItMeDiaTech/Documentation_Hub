import { useState } from 'react';
import {
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  Bold,
  Italic,
  Underline,
  Check,
  Save,
  List,
  Table,
  BookOpen
} from 'lucide-react';
import { cn } from '@/utils/cn';
import { Button } from '@/components/common/Button';
import {
  ListBulletSettings,
  TableUniformitySettings,
  TableOfContentsSettings,
  IndentationLevel
} from '@/types/session';

interface StyleDefinition {
  id: string;
  name: string;
  fontSize: number;
  fontFamily: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  alignment: 'left' | 'center' | 'right' | 'justify';
  spaceBefore: number;
  spaceAfter: number;
  lineSpacing: number; // 1.0 = single, 1.15 = Word default, 1.5, 2.0 = double
  color: string;
  noSpaceBetweenSame?: boolean;
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
    id: 'normal',
    name: 'Normal',
    fontSize: 12,
    fontFamily: 'Verdana',
    bold: false,
    italic: false,
    underline: false,
    alignment: 'left',
    spaceBefore: 3,
    spaceAfter: 3,
    lineSpacing: 1.15, // Word default
    color: '#000000',
    noSpaceBetweenSame: false
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
const defaultIndentationLevels: IndentationLevel[] = [
  { level: 1, indentation: 0, bulletChar: '•', numberedFormat: '1.' },
  { level: 2, indentation: 36, bulletChar: '○', numberedFormat: 'a.' },
  { level: 3, indentation: 72, bulletChar: '•', numberedFormat: 'i.' },
  { level: 4, indentation: 108, bulletChar: '○', numberedFormat: '1)' },
  { level: 5, indentation: 144, bulletChar: '•', numberedFormat: 'a)' }
];

const defaultListBulletSettings: ListBulletSettings = {
  enabled: true,
  indentationLevels: defaultIndentationLevels,
  spacingBetweenItems: 3
};

const defaultTableUniformitySettings: TableUniformitySettings = {
  enabled: true,
  borderStyle: 'single',
  borderWidth: 1,
  headerRowBold: true,
  headerRowShaded: true,
  headerRowShadingColor: '#D3D3D3',
  alternatingRowColors: false,
  cellPadding: 4,
  autoFit: 'content',
  // Header 2 in 1x1 table cell settings
  header2In1x1CellShading: '#D3D3D3',
  header2In1x1Alignment: 'left',
  // Large table (>1x1) settings
  largeTableSettings: {
    font: 'Verdana',
    fontSize: 12,
    bold: false,
    italic: false,
    underline: false,
    alignment: 'left',
    cellPadding: 4
  },
  applyToIfThenPattern: true,
  applyToTopRow: true
};

const defaultTableOfContentsSettings: TableOfContentsSettings = {
  enabled: true,
  includeHeadingLevels: [2], // Default to only Level 2
  showPageNumbers: true,
  rightAlignPageNumbers: true,
  useHyperlinks: true,
  tabLeaderStyle: 'none', // Default to none instead of dots
  tocTitle: 'Table of Contents',
  showTocTitle: false, // Option to turn off title (default: off)
  spacingBetweenHyperlinks: 0 // Default spacing
};

interface StylesEditorProps {
  initialStyles?: any[];
  onStylesChange?: (styles: StyleDefinition[]) => void;
  renderSaveButton?: (handleSave: () => void, showSuccess: boolean, onSuccessComplete: () => void) => React.ReactNode;
}

export function StylesEditor({ initialStyles, onStylesChange, renderSaveButton }: StylesEditorProps) {
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
        alignment: sessionStyle.alignment || defaultStyle.alignment,
        color: sessionStyle.color || defaultStyle.color,
        spaceBefore: sessionStyle.spaceBefore ?? defaultStyle.spaceBefore,
        spaceAfter: sessionStyle.spaceAfter ?? defaultStyle.spaceAfter,
        lineSpacing: sessionStyle.lineSpacing ?? defaultStyle.lineSpacing,
        noSpaceBetweenSame: sessionStyle.noSpaceBetweenSame ?? defaultStyle.noSpaceBetweenSame,
      };
    });
  };

  const [styles, setStyles] = useState<StyleDefinition[]>(() => convertToStyleDefinitions(initialStyles));
  const [listBulletSettings, setListBulletSettings] = useState<ListBulletSettings>(defaultListBulletSettings);
  const [tableUniformitySettings, setTableUniformitySettings] = useState<TableUniformitySettings>(defaultTableUniformitySettings);
  const [tableOfContentsSettings, setTableOfContentsSettings] = useState<TableOfContentsSettings>(defaultTableOfContentsSettings);
  const [showSuccess, setShowSuccess] = useState(false);

  const updateStyle = (styleId: string, updates: Partial<StyleDefinition>) => {
    const updatedStyles = styles.map(style =>
      style.id === styleId ? { ...style, ...updates } : style
    );
    setStyles(updatedStyles);
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

        {/* Normal style specific option */}
        {style.id === 'normal' && (
          <label className="flex items-center gap-3 cursor-pointer">
            <div className="relative">
              <input
                type="checkbox"
                checked={!style.noSpaceBetweenSame}
                onChange={() => updateStyle(style.id, { noSpaceBetweenSame: !style.noSpaceBetweenSame })}
                className="sr-only"
              />
              <div className={cn(
                'w-5 h-5 rounded border-2 flex items-center justify-center transition-all',
                !style.noSpaceBetweenSame
                  ? 'bg-primary border-primary'
                  : 'border-border'
              )}>
                {!style.noSpaceBetweenSame && (
                  <Check className="w-3 h-3 text-white" />
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
              fontWeight: style.bold ? 'bold' : 'normal',
              fontStyle: style.italic ? 'italic' : 'normal',
              textDecoration: style.underline ? 'underline' : 'none',
              textAlign: style.alignment,
              color: style.color
            }}
          >
            Sample text for {style.name} style
          </div>
        </div>
      </div>
    );
  };

  const handleSaveStyles = () => {
    // Save styles logic here
    onStylesChange?.(styles);
    setShowSuccess(true);
  };

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
                onChange={(e) => setListBulletSettings({ ...listBulletSettings, enabled: e.target.checked })}
                className="sr-only"
              />
              <div className={cn(
                'w-5 h-5 rounded border-2 flex items-center justify-center transition-all',
                listBulletSettings.enabled
                  ? 'bg-primary border-primary'
                  : 'border-border'
              )}>
                {listBulletSettings.enabled && (
                  <Check className="w-3 h-3 text-white" />
                )}
              </div>
            </div>
          </label>
        </div>

        {listBulletSettings.enabled && (
          <>
            <div className="space-y-3">
              <h4 className="text-sm font-medium text-muted-foreground">Indentation & Bullet Styles by Level</h4>
              {listBulletSettings.indentationLevels.map((level, index) => (
                <div key={level.level} className="grid grid-cols-1 md:grid-cols-4 gap-3 p-3 bg-muted/30 rounded-md">
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Level {level.level}</label>
                    <input
                      type="text"
                      value={`${level.indentation}pt`}
                      disabled
                      className="w-full px-2 py-1 text-sm border border-border rounded-md bg-muted/50"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Indentation (pt)</label>
                    <input
                      type="number"
                      value={level.indentation}
                      onChange={(e) => {
                        const newLevels = [...listBulletSettings.indentationLevels];
                        newLevels[index] = { ...newLevels[index], indentation: Number(e.target.value) };
                        setListBulletSettings({ ...listBulletSettings, indentationLevels: newLevels });
                      }}
                      className="w-full px-2 py-1 text-sm border border-border rounded-md bg-background"
                      min="0"
                      max="288"
                      step="12"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Bullet Character</label>
                    <input
                      type="text"
                      value={level.bulletChar || ''}
                      onChange={(e) => {
                        const newLevels = [...listBulletSettings.indentationLevels];
                        newLevels[index] = { ...newLevels[index], bulletChar: e.target.value };
                        setListBulletSettings({ ...listBulletSettings, indentationLevels: newLevels });
                      }}
                      className="w-full px-2 py-1 text-sm border border-border rounded-md bg-background text-center"
                      maxLength={1}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Numbered Format</label>
                    <select
                      value={level.numberedFormat || '1.'}
                      onChange={(e) => {
                        const newLevels = [...listBulletSettings.indentationLevels];
                        newLevels[index] = { ...newLevels[index], numberedFormat: e.target.value };
                        setListBulletSettings({ ...listBulletSettings, indentationLevels: newLevels });
                      }}
                      className="w-full px-2 py-1 text-sm border border-border rounded-md bg-background"
                    >
                      <option value="1.">1.</option>
                      <option value="a.">a.</option>
                      <option value="A.">A.</option>
                      <option value="i.">i.</option>
                      <option value="I.">I.</option>
                      <option value="1)">1)</option>
                      <option value="a)">a)</option>
                      <option value="A)">A)</option>
                    </select>
                  </div>
                </div>
              ))}
            </div>

            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Spacing Between Items (pt)</label>
              <input
                type="number"
                value={listBulletSettings.spacingBetweenItems}
                onChange={(e) => setListBulletSettings({ ...listBulletSettings, spacingBetweenItems: Number(e.target.value) })}
                className="w-full px-3 py-1.5 text-sm border border-border rounded-md bg-background max-w-xs"
                min="0"
                max="24"
                step="1"
              />
            </div>
          </>
        )}
      </div>
    );
  };

  const renderTableUniformitySettings = () => {
    return (
      <div className="space-y-4 p-4 border border-border rounded-lg">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Table className="w-5 h-5 text-primary" />
            <h3 className="font-semibold text-base">Table Uniformity</h3>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <span className="text-sm text-muted-foreground">Enable</span>
            <div className="relative">
              <input
                type="checkbox"
                checked={tableUniformitySettings.enabled}
                onChange={(e) => setTableUniformitySettings({ ...tableUniformitySettings, enabled: e.target.checked })}
                className="sr-only"
              />
              <div className={cn(
                'w-5 h-5 rounded border-2 flex items-center justify-center transition-all',
                tableUniformitySettings.enabled
                  ? 'bg-primary border-primary'
                  : 'border-border'
              )}>
                {tableUniformitySettings.enabled && (
                  <Check className="w-3 h-3 text-white" />
                )}
              </div>
            </div>
          </label>
        </div>

        {tableUniformitySettings.enabled && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Border Style</label>
              <select
                value={tableUniformitySettings.borderStyle}
                onChange={(e) => setTableUniformitySettings({ ...tableUniformitySettings, borderStyle: e.target.value as any })}
                className="w-full px-3 py-1.5 text-sm border border-border rounded-md bg-background"
              >
                <option value="none">None</option>
                <option value="single">Single</option>
                <option value="double">Double</option>
                <option value="dashed">Dashed</option>
              </select>
            </div>

            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Border Width (pt)</label>
              <input
                type="number"
                value={tableUniformitySettings.borderWidth}
                onChange={(e) => setTableUniformitySettings({ ...tableUniformitySettings, borderWidth: Number(e.target.value) })}
                className="w-full px-3 py-1.5 text-sm border border-border rounded-md bg-background"
                min="0.5"
                max="3"
                step="0.5"
              />
            </div>

            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Cell Padding (pt)</label>
              <input
                type="number"
                value={tableUniformitySettings.cellPadding}
                onChange={(e) => setTableUniformitySettings({ ...tableUniformitySettings, cellPadding: Number(e.target.value) })}
                className="w-full px-3 py-1.5 text-sm border border-border rounded-md bg-background"
                min="2"
                max="12"
                step="1"
              />
            </div>

            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Auto-Fit</label>
              <select
                value={tableUniformitySettings.autoFit}
                onChange={(e) => setTableUniformitySettings({ ...tableUniformitySettings, autoFit: e.target.value as any })}
                className="w-full px-3 py-1.5 text-sm border border-border rounded-md bg-background"
              >
                <option value="content">Fit to Content</option>
                <option value="window">Fit to Window</option>
              </select>
            </div>

            <div className="col-span-full space-y-2">
              <label className="flex items-center gap-3 cursor-pointer">
                <div className="relative">
                  <input
                    type="checkbox"
                    checked={tableUniformitySettings.headerRowBold}
                    onChange={(e) => setTableUniformitySettings({ ...tableUniformitySettings, headerRowBold: e.target.checked })}
                    className="sr-only"
                  />
                  <div className={cn(
                    'w-5 h-5 rounded border-2 flex items-center justify-center transition-all',
                    tableUniformitySettings.headerRowBold
                      ? 'bg-primary border-primary'
                      : 'border-border'
                  )}>
                    {tableUniformitySettings.headerRowBold && (
                      <Check className="w-3 h-3 text-white" />
                    )}
                  </div>
                </div>
                <span className="text-sm">Bold header row</span>
              </label>

              <label className="flex items-center gap-3 cursor-pointer">
                <div className="relative">
                  <input
                    type="checkbox"
                    checked={tableUniformitySettings.headerRowShaded}
                    onChange={(e) => setTableUniformitySettings({ ...tableUniformitySettings, headerRowShaded: e.target.checked })}
                    className="sr-only"
                  />
                  <div className={cn(
                    'w-5 h-5 rounded border-2 flex items-center justify-center transition-all',
                    tableUniformitySettings.headerRowShaded
                      ? 'bg-primary border-primary'
                      : 'border-border'
                  )}>
                    {tableUniformitySettings.headerRowShaded && (
                      <Check className="w-3 h-3 text-white" />
                    )}
                  </div>
                </div>
                <span className="text-sm">Shaded header row background</span>
              </label>

              {tableUniformitySettings.headerRowShaded && (
                <div className="pl-8">
                  <label className="text-sm text-muted-foreground mb-1 block">Header Row Shading Color</label>
                  <div className="flex gap-2">
                    <input
                      type="color"
                      value={tableUniformitySettings.headerRowShadingColor}
                      onChange={(e) => setTableUniformitySettings({ ...tableUniformitySettings, headerRowShadingColor: e.target.value })}
                      className="h-9 w-16 border border-border rounded cursor-pointer"
                    />
                    <input
                      type="text"
                      value={tableUniformitySettings.headerRowShadingColor}
                      onChange={(e) => setTableUniformitySettings({ ...tableUniformitySettings, headerRowShadingColor: e.target.value })}
                      className="flex-1 px-3 py-1.5 text-sm border border-border rounded-md bg-background max-w-xs"
                      placeholder="#D3D3D3"
                    />
                  </div>
                </div>
              )}

              <label className="flex items-center gap-3 cursor-pointer">
                <div className="relative">
                  <input
                    type="checkbox"
                    checked={tableUniformitySettings.alternatingRowColors}
                    onChange={(e) => setTableUniformitySettings({ ...tableUniformitySettings, alternatingRowColors: e.target.checked })}
                    className="sr-only"
                  />
                  <div className={cn(
                    'w-5 h-5 rounded border-2 flex items-center justify-center transition-all',
                    tableUniformitySettings.alternatingRowColors
                      ? 'bg-primary border-primary'
                      : 'border-border'
                  )}>
                    {tableUniformitySettings.alternatingRowColors && (
                      <Check className="w-3 h-3 text-white" />
                    )}
                  </div>
                </div>
                <span className="text-sm">Alternating row colors</span>
              </label>
            </div>

            {/* Divider */}
            <div className="col-span-full border-t border-border my-2"></div>

            {/* Header 2 in 1x1 Table Settings */}
            <div className="col-span-full">
              <h4 className="text-sm font-medium mb-3">Header 2 in 1x1 Table Cell</h4>
            </div>

            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Cell Shading Color</label>
              <div className="flex gap-2">
                <input
                  type="color"
                  value={tableUniformitySettings.header2In1x1CellShading}
                  onChange={(e) => setTableUniformitySettings({ ...tableUniformitySettings, header2In1x1CellShading: e.target.value })}
                  className="h-9 w-16 border border-border rounded cursor-pointer"
                />
                <input
                  type="text"
                  value={tableUniformitySettings.header2In1x1CellShading}
                  onChange={(e) => setTableUniformitySettings({ ...tableUniformitySettings, header2In1x1CellShading: e.target.value })}
                  className="flex-1 px-3 py-1.5 text-sm border border-border rounded-md bg-background"
                  placeholder="#D3D3D3"
                />
              </div>
            </div>

            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Alignment</label>
              <div className="flex gap-1">
                <button
                  onClick={() => setTableUniformitySettings({ ...tableUniformitySettings, header2In1x1Alignment: 'left' })}
                  className={cn(
                    'p-2 rounded transition-all',
                    tableUniformitySettings.header2In1x1Alignment === 'left'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted hover:bg-muted/80'
                  )}
                >
                  <AlignLeft className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setTableUniformitySettings({ ...tableUniformitySettings, header2In1x1Alignment: 'center' })}
                  className={cn(
                    'p-2 rounded transition-all',
                    tableUniformitySettings.header2In1x1Alignment === 'center'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted hover:bg-muted/80'
                  )}
                >
                  <AlignCenter className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setTableUniformitySettings({ ...tableUniformitySettings, header2In1x1Alignment: 'right' })}
                  className={cn(
                    'p-2 rounded transition-all',
                    tableUniformitySettings.header2In1x1Alignment === 'right'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted hover:bg-muted/80'
                  )}
                >
                  <AlignRight className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setTableUniformitySettings({ ...tableUniformitySettings, header2In1x1Alignment: 'justify' })}
                  className={cn(
                    'p-2 rounded transition-all',
                    tableUniformitySettings.header2In1x1Alignment === 'justify'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted hover:bg-muted/80'
                  )}
                >
                  <AlignJustify className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Divider */}
            <div className="col-span-full border-t border-border my-2"></div>

            {/* Large Table Settings */}
            <div className="col-span-full">
              <h4 className="text-sm font-medium mb-3">Large Tables (&gt;1x1) - Conditional Formatting</h4>
            </div>

            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Font Family</label>
              <select
                value={tableUniformitySettings.largeTableSettings.font}
                onChange={(e) => setTableUniformitySettings({
                  ...tableUniformitySettings,
                  largeTableSettings: { ...tableUniformitySettings.largeTableSettings, font: e.target.value }
                })}
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
                value={tableUniformitySettings.largeTableSettings.fontSize}
                onChange={(e) => setTableUniformitySettings({
                  ...tableUniformitySettings,
                  largeTableSettings: { ...tableUniformitySettings.largeTableSettings, fontSize: Number(e.target.value) }
                })}
                className="w-full px-3 py-1.5 text-sm border border-border rounded-md bg-background"
              >
                {fontSizes.map(size => (
                  <option key={size} value={size}>{size}pt</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Formatting</label>
              <div className="flex gap-1">
                <button
                  onClick={() => setTableUniformitySettings({
                    ...tableUniformitySettings,
                    largeTableSettings: { ...tableUniformitySettings.largeTableSettings, bold: !tableUniformitySettings.largeTableSettings.bold }
                  })}
                  className={cn(
                    'p-2 rounded transition-all',
                    tableUniformitySettings.largeTableSettings.bold
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted hover:bg-muted/80'
                  )}
                >
                  <Bold className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setTableUniformitySettings({
                    ...tableUniformitySettings,
                    largeTableSettings: { ...tableUniformitySettings.largeTableSettings, italic: !tableUniformitySettings.largeTableSettings.italic }
                  })}
                  className={cn(
                    'p-2 rounded transition-all',
                    tableUniformitySettings.largeTableSettings.italic
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted hover:bg-muted/80'
                  )}
                >
                  <Italic className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setTableUniformitySettings({
                    ...tableUniformitySettings,
                    largeTableSettings: { ...tableUniformitySettings.largeTableSettings, underline: !tableUniformitySettings.largeTableSettings.underline }
                  })}
                  className={cn(
                    'p-2 rounded transition-all',
                    tableUniformitySettings.largeTableSettings.underline
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted hover:bg-muted/80'
                  )}
                >
                  <Underline className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Alignment</label>
              <div className="flex gap-1">
                <button
                  onClick={() => setTableUniformitySettings({
                    ...tableUniformitySettings,
                    largeTableSettings: { ...tableUniformitySettings.largeTableSettings, alignment: 'left' }
                  })}
                  className={cn(
                    'p-2 rounded transition-all',
                    tableUniformitySettings.largeTableSettings.alignment === 'left'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted hover:bg-muted/80'
                  )}
                >
                  <AlignLeft className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setTableUniformitySettings({
                    ...tableUniformitySettings,
                    largeTableSettings: { ...tableUniformitySettings.largeTableSettings, alignment: 'center' }
                  })}
                  className={cn(
                    'p-2 rounded transition-all',
                    tableUniformitySettings.largeTableSettings.alignment === 'center'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted hover:bg-muted/80'
                  )}
                >
                  <AlignCenter className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setTableUniformitySettings({
                    ...tableUniformitySettings,
                    largeTableSettings: { ...tableUniformitySettings.largeTableSettings, alignment: 'right' }
                  })}
                  className={cn(
                    'p-2 rounded transition-all',
                    tableUniformitySettings.largeTableSettings.alignment === 'right'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted hover:bg-muted/80'
                  )}
                >
                  <AlignRight className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setTableUniformitySettings({
                    ...tableUniformitySettings,
                    largeTableSettings: { ...tableUniformitySettings.largeTableSettings, alignment: 'justify' }
                  })}
                  className={cn(
                    'p-2 rounded transition-all',
                    tableUniformitySettings.largeTableSettings.alignment === 'justify'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted hover:bg-muted/80'
                  )}
                >
                  <AlignJustify className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Cell Padding (pt)</label>
              <input
                type="number"
                value={tableUniformitySettings.largeTableSettings.cellPadding}
                onChange={(e) => setTableUniformitySettings({
                  ...tableUniformitySettings,
                  largeTableSettings: { ...tableUniformitySettings.largeTableSettings, cellPadding: Number(e.target.value) }
                })}
                className="w-full px-3 py-1.5 text-sm border border-border rounded-md bg-background"
                min="2"
                max="12"
                step="1"
              />
            </div>

            <div className="col-span-full space-y-2 mt-2">
              <label className="flex items-center gap-3 cursor-pointer">
                <div className="relative">
                  <input
                    type="checkbox"
                    checked={tableUniformitySettings.applyToIfThenPattern}
                    onChange={(e) => setTableUniformitySettings({ ...tableUniformitySettings, applyToIfThenPattern: e.target.checked })}
                    className="sr-only"
                  />
                  <div className={cn(
                    'w-5 h-5 rounded border-2 flex items-center justify-center transition-all',
                    tableUniformitySettings.applyToIfThenPattern
                      ? 'bg-primary border-primary'
                      : 'border-border'
                  )}>
                    {tableUniformitySettings.applyToIfThenPattern && (
                      <Check className="w-3 h-3 text-white" />
                    )}
                  </div>
                </div>
                <span className="text-sm">Apply to cells with "If...Then" pattern</span>
              </label>

              <label className="flex items-center gap-3 cursor-pointer">
                <div className="relative">
                  <input
                    type="checkbox"
                    checked={tableUniformitySettings.applyToTopRow}
                    onChange={(e) => setTableUniformitySettings({ ...tableUniformitySettings, applyToTopRow: e.target.checked })}
                    className="sr-only"
                  />
                  <div className={cn(
                    'w-5 h-5 rounded border-2 flex items-center justify-center transition-all',
                    tableUniformitySettings.applyToTopRow
                      ? 'bg-primary border-primary'
                      : 'border-border'
                  )}>
                    {tableUniformitySettings.applyToTopRow && (
                      <Check className="w-3 h-3 text-white" />
                    )}
                  </div>
                </div>
                <span className="text-sm">Apply to top row (if not 1x1)</span>
              </label>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderTableOfContentsSettings = () => {
    return (
      <div className="space-y-4 p-4 border border-border rounded-lg">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-primary" />
            <h3 className="font-semibold text-base">Table of Contents</h3>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <span className="text-sm text-muted-foreground">Enable</span>
            <div className="relative">
              <input
                type="checkbox"
                checked={tableOfContentsSettings.enabled}
                onChange={(e) => setTableOfContentsSettings({ ...tableOfContentsSettings, enabled: e.target.checked })}
                className="sr-only"
              />
              <div className={cn(
                'w-5 h-5 rounded border-2 flex items-center justify-center transition-all',
                tableOfContentsSettings.enabled
                  ? 'bg-primary border-primary'
                  : 'border-border'
              )}>
                {tableOfContentsSettings.enabled && (
                  <Check className="w-3 h-3 text-white" />
                )}
              </div>
            </div>
          </label>
        </div>

        {tableOfContentsSettings.enabled && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">TOC Title</label>
              <input
                type="text"
                value={tableOfContentsSettings.tocTitle}
                onChange={(e) => setTableOfContentsSettings({ ...tableOfContentsSettings, tocTitle: e.target.value })}
                disabled={!tableOfContentsSettings.showTocTitle}
                className={cn(
                  "w-full px-3 py-1.5 text-sm border border-border rounded-md transition-all",
                  tableOfContentsSettings.showTocTitle
                    ? "bg-background"
                    : "bg-muted/50 opacity-50 cursor-not-allowed"
                )}
                placeholder="Table of Contents"
              />
            </div>

            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Tab Leader Style</label>
              <select
                value={tableOfContentsSettings.tabLeaderStyle}
                onChange={(e) => setTableOfContentsSettings({ ...tableOfContentsSettings, tabLeaderStyle: e.target.value as any })}
                className="w-full px-3 py-1.5 text-sm border border-border rounded-md bg-background"
              >
                <option value="none">None</option>
                <option value="dots">Dots (...)</option>
                <option value="dashes">Dashes (---)</option>
                <option value="underline">Underline (___)</option>
              </select>
            </div>

            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Spacing Between Hyperlinks (pt)</label>
              <input
                type="number"
                value={tableOfContentsSettings.spacingBetweenHyperlinks}
                onChange={(e) => setTableOfContentsSettings({ ...tableOfContentsSettings, spacingBetweenHyperlinks: Number(e.target.value) })}
                className="w-full px-3 py-1.5 text-sm border border-border rounded-md bg-background"
                min="0"
                max="24"
                step="1"
              />
            </div>

            <div className="col-span-full">
              <label className="flex items-center gap-3 cursor-pointer">
                <div className="relative">
                  <input
                    type="checkbox"
                    checked={tableOfContentsSettings.showTocTitle}
                    onChange={(e) => setTableOfContentsSettings({ ...tableOfContentsSettings, showTocTitle: e.target.checked })}
                    className="sr-only"
                  />
                  <div className={cn(
                    'w-5 h-5 rounded border-2 flex items-center justify-center transition-all',
                    tableOfContentsSettings.showTocTitle
                      ? 'bg-primary border-primary'
                      : 'border-border'
                  )}>
                    {tableOfContentsSettings.showTocTitle && (
                      <Check className="w-3 h-3 text-white" />
                    )}
                  </div>
                </div>
                <span className="text-sm">Show TOC Title</span>
              </label>
            </div>

            <div className="col-span-full">
              <label className="text-sm text-muted-foreground mb-2 block">Include Heading Levels</label>
              <div className="flex gap-2 flex-wrap">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(level => (
                  <button
                    key={level}
                    onClick={() => {
                      const currentLevels = tableOfContentsSettings.includeHeadingLevels;
                      const newLevels = currentLevels.includes(level)
                        ? currentLevels.filter(l => l !== level)
                        : [...currentLevels, level].sort((a, b) => a - b);
                      setTableOfContentsSettings({ ...tableOfContentsSettings, includeHeadingLevels: newLevels });
                    }}
                    className={cn(
                      'px-3 py-1.5 rounded text-sm transition-all',
                      tableOfContentsSettings.includeHeadingLevels.includes(level)
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted hover:bg-muted/80'
                    )}
                  >
                    Level {level}
                  </button>
                ))}
              </div>
            </div>

            <div className="col-span-full space-y-2">
              <label className="flex items-center gap-3 cursor-pointer">
                <div className="relative">
                  <input
                    type="checkbox"
                    checked={tableOfContentsSettings.showPageNumbers}
                    onChange={(e) => setTableOfContentsSettings({ ...tableOfContentsSettings, showPageNumbers: e.target.checked })}
                    className="sr-only"
                  />
                  <div className={cn(
                    'w-5 h-5 rounded border-2 flex items-center justify-center transition-all',
                    tableOfContentsSettings.showPageNumbers
                      ? 'bg-primary border-primary'
                      : 'border-border'
                  )}>
                    {tableOfContentsSettings.showPageNumbers && (
                      <Check className="w-3 h-3 text-white" />
                    )}
                  </div>
                </div>
                <span className="text-sm">Show page numbers</span>
              </label>

              <label className="flex items-center gap-3 cursor-pointer">
                <div className="relative">
                  <input
                    type="checkbox"
                    checked={tableOfContentsSettings.rightAlignPageNumbers}
                    onChange={(e) => setTableOfContentsSettings({ ...tableOfContentsSettings, rightAlignPageNumbers: e.target.checked })}
                    className="sr-only"
                    disabled={!tableOfContentsSettings.showPageNumbers}
                  />
                  <div className={cn(
                    'w-5 h-5 rounded border-2 flex items-center justify-center transition-all',
                    tableOfContentsSettings.rightAlignPageNumbers && tableOfContentsSettings.showPageNumbers
                      ? 'bg-primary border-primary'
                      : 'border-border',
                    !tableOfContentsSettings.showPageNumbers && 'opacity-50'
                  )}>
                    {tableOfContentsSettings.rightAlignPageNumbers && tableOfContentsSettings.showPageNumbers && (
                      <Check className="w-3 h-3 text-white" />
                    )}
                  </div>
                </div>
                <span className={cn(
                  'text-sm',
                  !tableOfContentsSettings.showPageNumbers && 'opacity-50'
                )}>Right-align page numbers</span>
              </label>

              <label className="flex items-center gap-3 cursor-pointer">
                <div className="relative">
                  <input
                    type="checkbox"
                    checked={tableOfContentsSettings.useHyperlinks}
                    onChange={(e) => setTableOfContentsSettings({ ...tableOfContentsSettings, useHyperlinks: e.target.checked })}
                    className="sr-only"
                  />
                  <div className={cn(
                    'w-5 h-5 rounded border-2 flex items-center justify-center transition-all',
                    tableOfContentsSettings.useHyperlinks
                      ? 'bg-primary border-primary'
                      : 'border-border'
                  )}>
                    {tableOfContentsSettings.useHyperlinks && (
                      <Check className="w-3 h-3 text-white" />
                    )}
                  </div>
                </div>
                <span className="text-sm">Use hyperlinks for navigation</span>
              </label>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Only show button here if renderSaveButton is not provided (backward compatibility) */}
      {!renderSaveButton && (
        <div className="flex justify-end">
          <Button
            variant="default"
            size="sm"
            icon={<Save className="w-4 h-4" />}
            onClick={handleSaveStyles}
            showSuccess={showSuccess}
            onSuccess={() => setShowSuccess(false)}
          >
            Save Styles
          </Button>
        </div>
      )}

      {/* Render the button via callback if provided */}
      {renderSaveButton && renderSaveButton(handleSaveStyles, showSuccess, () => setShowSuccess(false))}

      {/* Document Uniformity Settings */}
      {renderListBulletSettings()}
      {renderTableUniformitySettings()}
      {renderTableOfContentsSettings()}

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
}