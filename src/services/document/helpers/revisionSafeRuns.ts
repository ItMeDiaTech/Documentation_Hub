import { Paragraph, Run, Revision, Hyperlink } from "docxmlater";

/**
 * Returns para.getRuns() minus runs inside w:del/w:moveFrom revisions.
 * Modifying deleted revision runs corrupts XML, causing deleted text to reappear.
 *
 * Unlike getAllRunsFromParagraph(), this INCLUDES hyperlink runs — use when
 * methods need to format all visible runs including those inside hyperlinks.
 */
export function getVisibleRuns(para: Paragraph): Run[] {
  const content = para.getContent();

  // Quick check: if no Revision items, no filtering needed
  if (!content.some((item) => item instanceof Revision)) {
    return para.getRuns();
  }

  // Build set of runs inside deleted/moveFrom revisions
  const deletedRuns = new Set<Run>();
  for (const item of content) {
    if (!(item instanceof Revision)) continue;
    const type = item.getType();
    if (type !== "delete" && type !== "moveFrom") continue;

    // Collect direct runs from the revision
    for (const run of item.getRuns()) {
      deletedRuns.add(run);
    }
    // Revision.getRuns() excludes hyperlink runs (isRunContent filter),
    // so also collect hyperlink runs within the deleted revision
    for (const revItem of item.getContent()) {
      if (revItem instanceof Hyperlink) {
        const hRun = revItem.getRun();
        if (hRun) deletedRuns.add(hRun);
      }
    }
  }

  if (deletedRuns.size === 0) return para.getRuns();
  return para.getRuns().filter((run) => !deletedRuns.has(run));
}
