import { useState } from 'react';
import {
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  Bold,
  Italic,
  Underline,
  ChevronDown,
  Check
} from 'lucide-react';
import { cn } from '@/utils/cn';

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
    color: '#000000',
    noSpaceBetweenSame: false
  }
];

const fontSizes = Array.from({ length: 65 }, (_, i) => i + 8); // 8pt to 72pt
const fontFamilies = ['Verdana', 'Arial', 'Times New Roman', 'Calibri', 'Georgia', 'Helvetica'];
const spacingOptions = Array.from({ length: 25 }, (_, i) => i * 3); // 0pt to 72pt in increments of 3

interface StylesEditorProps {
  sessionId: string;
  onStylesChange?: (styles: StyleDefinition[]) => void;
}

export function StylesEditor({ sessionId, onStylesChange }: StylesEditorProps) {
  const [styles, setStyles] = useState<StyleDefinition[]>(defaultStyles);

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

  return (
    <div className="space-y-4">
      {styles.map(style => renderStyleEditor(style))}
    </div>
  );
}