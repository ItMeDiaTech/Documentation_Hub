/**
 * Type definitions for DOCX processing abstraction layer
 */

// ========== Document Operations ==========

export enum DocumentOperation {
  CREATE = 'create',
  READ = 'read',
  MODIFY = 'modify',
  MODIFY_TEMPLATE = 'modify_template',
  MODIFY_XML = 'modify_xml',
}

// ========== Style Definitions ==========

export interface TextStyle {
  fontFamily?: string;
  fontSize?: number; // in points
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  preserveBold?: boolean; // Optional: true = preserve existing bold (ignore bold property)
  preserveItalic?: boolean; // Optional: true = preserve existing italic (ignore italic property)
  preserveUnderline?: boolean; // Optional: true = preserve existing underline (ignore underline property)
  color?: string; // hex color (e.g., "FF0000")
  highlight?: string; // highlight color
}

export interface ParagraphStyle {
  alignment?: 'left' | 'center' | 'right' | 'justify';
  indentLeft?: number; // in twips (1/20th of a point)
  indentRight?: number;
  indentFirstLine?: number;
  spaceBefore?: number;
  spaceAfter?: number;
  lineSpacing?: number;
  keepNext?: boolean;
  keepLines?: boolean;
}

export interface NumberingStyle {
  level: number; // 0-8 (9 levels)
  format: 'bullet' | 'decimal' | 'lowerLetter' | 'upperLetter' | 'lowerRoman' | 'upperRoman';
  text?: string; // for bullets, the character to use
  alignment?: 'left' | 'center' | 'right';
  indentLeft?: number;
  indentHanging?: number;
}

// ========== Document Structure ==========

export interface DocxDocument {
  styles: DocxStyles;
  numbering: DocxNumbering;
  fonts: DocxFonts;
  content: DocxContent;
}

export interface DocxStyles {
  paragraphStyles: Map<string, ParagraphStyle>;
  characterStyles: Map<string, TextStyle>;
  defaultParagraphStyle?: ParagraphStyle;
  defaultCharacterStyle?: TextStyle;
}

export interface DocxNumbering {
  abstractNumberings: Map<string, NumberingDefinition>;
  numberingInstances: Map<string, string>; // instanceId -> abstractNumId
}

export interface NumberingDefinition {
  id: string;
  levels: NumberingStyle[];
}

export interface DocxFonts {
  fonts: Map<string, FontDefinition>;
}

export interface FontDefinition {
  name: string;
  charset?: string;
  family?: string;
  pitch?: string;
}

export interface DocxContent {
  paragraphs: Paragraph[];
  tables?: Table[];
  sections?: Section[];
}

export interface Paragraph {
  text: string;
  style?: string; // style name
  numbering?: {
    id: string;
    level: number;
  };
  runs?: Run[];
}

export interface Run {
  text: string;
  style?: TextStyle;
}

export interface Table {
  rows: TableRow[];
  style?: string;
}

export interface TableRow {
  cells: TableCell[];
}

export interface TableCell {
  text: string;              // Combined text from all paragraphs (for quick access)
  colspan: number;           // Column span (1 = no merge, >1 = merged cells)
  rowspan: number;           // Row span (1 = no merge, >1 = merged cells)
  paragraphs: Paragraph[];   // Detailed paragraph structure within cell
  style?: any;               // Cell style (deprecated, kept for compatibility)
}

export interface Section {
  properties: SectionProperties;
  content: Paragraph[];
}

export interface SectionProperties {
  pageSize?: {
    width: number;
    height: number;
  };
  pageMargins?: {
    top: number;
    bottom: number;
    left: number;
    right: number;
  };
  columns?: number;
}

// ========== Processing Options ==========

export interface DocumentReadOptions {
  parseStyles?: boolean;
  parseNumbering?: boolean;
  parseFonts?: boolean;
  parseContent?: boolean;
}

export interface DocumentModifyOptions {
  operation: DocumentOperation;
  preserveFormatting?: boolean;
  updateStyles?: boolean;
  updateNumbering?: boolean;
}

export interface TemplateData {
  [key: string]: any;
}

// ========== Style Application ==========

export interface StyleApplication {
  target: 'all' | 'pattern' | 'indices';
  styleId: string;
  pattern?: string | RegExp;
  indices?: number[];
}

export interface StyleApplicationResult {
  appliedCount: number;
  skippedCount: number;
  paragraphsModified: number[];
  totalParagraphs: number;
}

export interface DefineAndApplyStyleOptions {
  styleId: string;
  styleName: string;
  properties: TextStyle & ParagraphStyle;
  application: StyleApplication;
}

// ========== Processor Results ==========

export interface ProcessorResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  warnings?: string[];
}

export interface DocumentReadResult extends ProcessorResult {
  data?: DocxDocument;
}

export interface DocumentModifyResult extends ProcessorResult {
  data?: Buffer; // Modified DOCX file as buffer
}

// ========== XML Structure Types ==========

export interface DocumentXml {
  'w:document': {
    'w:body': {
      'w:p': ParagraphXml[];
      'w:tbl'?: TableXml[];
      'w:sectPr'?: SectionXml;
    };
  };
}

export interface ParagraphXml {
  'w:pPr'?: {
    'w:pStyle'?: { '@_w:val': string };
    'w:numPr'?: {
      'w:ilvl': { '@_w:val': string };
      'w:numId': { '@_w:val': string };
    };
    [key: string]: any; // Allow other properties
  };
  'w:r'?: RunXml | RunXml[];
  'w:hyperlink'?: any | any[];
  [key: string]: any; // Allow other children (bookmarks, etc.)
}

export interface RunXml {
  'w:rPr'?: any;
  'w:t'?: { '#text': string } | string;
}

export interface TableXml {
  'w:tblPr'?: any;
  'w:tr'?: any[];
}

export interface SectionXml {
  'w:pgSz'?: any;
  'w:pgMar'?: any;
}

export interface StylesXml {
  'w:styles': {
    'w:style': StyleXml[];
    'w:docDefaults'?: any;
  };
}

export interface StyleXml {
  '@_w:type': 'paragraph' | 'character' | 'table';
  '@_w:styleId': string;
  'w:name'?: { '@_w:val': string };
  'w:basedOn'?: { '@_w:val': string };
  'w:pPr'?: any;
  'w:rPr'?: any;
}

export interface NumberingXml {
  'w:numbering': {
    'w:abstractNum'?: AbstractNumXml[];
    'w:num'?: NumXml[];
  };
}

export interface AbstractNumXml {
  '@_w:abstractNumId': string;
  'w:lvl': LevelXml[];
}

export interface LevelXml {
  '@_w:ilvl': string;
  'w:start'?: { '@_w:val': string };
  'w:numFmt'?: { '@_w:val': string };
  'w:lvlText'?: { '@_w:val': string };
  'w:lvlJc'?: { '@_w:val': string };
  'w:pPr'?: any;
  'w:rPr'?: any;
}

export interface NumXml {
  '@_w:numId': string;
  'w:abstractNumId': { '@_w:val': string };
}

// ========== Error Types ==========

export class DocxProcessingError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: any
  ) {
    super(message);
    this.name = 'DocxProcessingError';
  }
}

export enum ErrorCode {
  INVALID_DOCX = 'INVALID_DOCX',
  FILE_NOT_FOUND = 'FILE_NOT_FOUND',
  PARSE_ERROR = 'PARSE_ERROR',
  XML_ERROR = 'XML_ERROR',
  STYLE_NOT_FOUND = 'STYLE_NOT_FOUND',
  NUMBERING_NOT_FOUND = 'NUMBERING_NOT_FOUND',
  UNSUPPORTED_OPERATION = 'UNSUPPORTED_OPERATION',
}
