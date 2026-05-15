/**
 * Flatten the Table of Contents indent when only one heading level is present.
 *
 * Word's default TOC paragraph styles (TOC1, TOC2, TOC3, …) carry a baked-in
 * `<w:ind w:left>` value: TOC1 is flush left, TOC2 is ~0.15", TOC3 is ~0.3",
 * and so on. The intent is to visually rank nested headings.
 *
 * When a user inserts a TOC that only includes one heading level (e.g.
 * "Heading 2"), every TOC entry inherits the *same* TOC style (TOC2 in that
 * case) and therefore the *same* non-zero indent. The list looks like it was
 * shifted right for no reason, because there's no Heading 1 row sitting at
 * the actual left margin to anchor it.
 *
 * This helper detects that "only one distinct TOC style is used" condition
 * and explicitly sets `setLeftIndent(0)` on every TOC entry, overriding the
 * style-inherited value. Multi-level TOCs are left alone — their stair-step
 * indentation is intentional.
 */
import { Document, Paragraph } from "docxmlater";

export interface TocFlattenResult {
  /** Was a single-level TOC detected and flattened? */
  flattened: boolean;
  /** Number of TOC paragraphs touched. */
  paragraphs: number;
  /** The TOC style that was flattened (e.g. "TOC2"), or null. */
  flattenedStyle: string | null;
}

const TOC_STYLE_RE = /^toc\s?\d+$/i;

export function flattenSingleLevelToc(doc: Document): TocFlattenResult {
  const tocParas: { para: Paragraph; style: string }[] = [];
  const distinctStyles = new Set<string>();

  for (const para of doc.getAllParagraphs()) {
    const styleId = para.getStyle();
    if (!styleId) continue;
    if (!TOC_STYLE_RE.test(styleId)) continue;
    tocParas.push({ para, style: styleId });
    distinctStyles.add(styleId);
  }

  // Need at least two TOC entries before we say "this is a TOC" — single
  // stray paragraph that happens to have a TOC style isn't a TOC at all.
  if (tocParas.length < 2) {
    return { flattened: false, paragraphs: 0, flattenedStyle: null };
  }

  if (distinctStyles.size !== 1) {
    return { flattened: false, paragraphs: tocParas.length, flattenedStyle: null };
  }

  const onlyStyle = tocParas[0].style;
  for (const { para } of tocParas) {
    para.setLeftIndent(0);
  }

  return { flattened: true, paragraphs: tocParas.length, flattenedStyle: onlyStyle };
}
