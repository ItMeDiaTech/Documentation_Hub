/**
 * applyRunFmtPreservingHyperlink — single-pass run formatter that preserves
 * Hyperlink-style coloring after font/size/bold writes.
 *
 * Per CLAUDE.md docxmlater gotcha: setFont/setSize/setBold can drop existing
 * <w:color> and <w:u> elements. Detect-then-restore must happen on every
 * Hyperlink-styled run touched by these setters. setColor('auto') is invalid
 * — restore uses the explicit canonical blue (0000FF).
 *
 * Field-level diffing: every property write is gated by an equality check
 * against the cached getFormatting() snapshot. In table-heavy documents where
 * cells are visited repeatedly this avoids redundant XML mutations and the
 * allocation churn of setter calls.
 */
import type { Run } from "docxmlater";

export interface ApplyRunFmtOpts {
  bold?: boolean;
  italic?: boolean;
}

/**
 * Applies font + size (and optional bold/italic) to a run, preserving
 * Hyperlink-style coloring and underline. Hyperlink detection matches either
 * the `characterStyle === "Hyperlink"` direct style check or the canonical hex
 * hyperlink colors written by earlier pipeline steps (0000FF, 0563C1).
 *
 * The hyperlink-restoration branch fires whenever the run is hyperlink-styled,
 * regardless of which property changed — any of the setters (setFont, setSize,
 * setBold, setItalic) can drop <w:color>/<w:u> per docxmlater gotchas.
 */
export function applyRunFmtPreservingHyperlink(
  run: Run,
  font: string,
  size: number,
  opts: ApplyRunFmtOpts = {}
): void {
  const fmt = run.getFormatting();
  const color = fmt.color?.toUpperCase();
  const isHyperlink =
    fmt.characterStyle === "Hyperlink" || color === "0000FF" || color === "0563C1";

  if (fmt.font !== font) run.setFont(font);
  if (fmt.size !== size) run.setSize(size);
  if (opts.bold !== undefined && fmt.bold !== opts.bold) run.setBold(opts.bold);
  if (opts.italic !== undefined && fmt.italic !== opts.italic) run.setItalic(opts.italic);

  if (isHyperlink) {
    if (color !== "0000FF") run.setColor("0000FF");
    if (fmt.underline !== "single") run.setUnderline("single");
  }
}
