import {
  Hyperlink,
  isHyperlink,
  isRevision,
  Paragraph,
  type ParagraphContent,
  Run,
} from "docxmlater";

/**
 * Collect runs that live inside w:del / w:moveFrom revisions on this paragraph.
 *
 * docxmlater's Revision.getContent() returns Run | ImageRun | Hyperlink — there
 * is no nested ComplexField path through Revision content, and Hyperlink/
 * ComplexField don't expose a child Revision via a public getContent() API. So
 * walking Revision content one level deep is sufficient; we just need to recover
 * hyperlink-child runs that Revision.getRuns() filters out (isRunContent).
 */
function collectDeletedRuns(
  content: readonly ParagraphContent[],
  out: Set<Run>
): void {
  for (const item of content) {
    if (!isRevision(item)) continue;
    const type = item.getType();
    if (type !== "delete" && type !== "moveFrom") continue;

    for (const r of item.getRuns()) {
      out.add(r);
    }
    // Revision.getRuns() excludes hyperlink runs (isRunContent filter); pull
    // them in explicitly so a deleted hyperlink's run isn't mistakenly formatted.
    for (const revItem of item.getContent()) {
      if (isHyperlink(revItem as unknown as ParagraphContent)) {
        const hRun = (revItem as Hyperlink).getRun();
        if (hRun) out.add(hRun);
      }
    }
  }
}

/**
 * Returns para.getRuns() minus runs inside w:del/w:moveFrom revisions, including
 * hyperlink-child runs nested inside those revisions.
 *
 * Modifying deleted-revision runs corrupts XML, causing deleted text to reappear.
 *
 * INCLUDES hyperlink-child runs (outside revisions) — use when a formatting
 * pass needs to touch everything visible to Word.
 */
export function getVisibleRuns(para: Paragraph): Run[] {
  const content = para.getContent();
  const deleted = new Set<Run>();
  collectDeletedRuns(content, deleted);

  const all = para.getRuns();
  if (deleted.size === 0) return all;
  return all.filter((r) => !deleted.has(r));
}

/**
 * Returns paragraph runs minus deleted-revision runs AND minus hyperlink-child
 * runs. Matches the semantics of the legacy getAllRunsFromParagraph(): direct
 * paragraph runs plus runs inside insert/moveTo revisions, but never hyperlink
 * children (which are formatted separately so they retain their blue color and
 * underline).
 */
export function getBodyRuns(para: Paragraph): Run[] {
  const visible = getVisibleRuns(para);
  if (visible.length === 0) return visible;

  const content = para.getContent();
  const hyperlinkRuns = new Set<Run>();
  for (const item of content) {
    if (isHyperlink(item)) {
      const r = item.getRun();
      if (r) hyperlinkRuns.add(r);
    }
  }

  if (hyperlinkRuns.size === 0) return visible;
  return visible.filter((r) => !hyperlinkRuns.has(r));
}
