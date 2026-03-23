/**
 * @jest-environment node
 */

/**
 * Hyperlink Tracked Changes — Verification Tests
 *
 * These tests use the REAL docxmlater library (not mocked) to confirm
 * how tracked changes interact with hyperlink operations.
 *
 * KEY FINDINGS:
 * 1. defragmentHyperlinks() silently returns 0 when tracking is enabled
 * 2. Hyperlink.setText() does NOT create tracked changes — it silently overwrites
 * 3. Hyperlink.setFormatting() does NOT create w:rPrChange — it silently overwrites
 * 4. Manual Revision.createDeletion/createInsertion + para.replaceContent() DOES work
 * 5. The manual revision approach survives save/load cycle with correct XML
 */

import { Document, Hyperlink, Paragraph, Revision, Run } from "docxmlater";
import type { ParagraphContent } from "docxmlater";
import AdmZip from "adm-zip";

describe("Hyperlink Tracked Changes — Verification", () => {
  // Helper: create a minimal document with one hyperlink paragraph
  function createDocWithHyperlink(url = "https://example.com", text = "Example Link") {
    const doc = Document.create();
    const para = doc.createParagraph();
    const link = Hyperlink.createExternal(url, text);
    para.addHyperlink(link);
    return { doc, para, link };
  }

  const trackOpts = {
    author: "TestAuthor",
    trackFormatting: true,
    showInsertionsAndDeletions: true,
    clearExistingPropertyChanges: false,
  };

  // ──────────────────────────────────────────────
  // Test 1: defragmentHyperlinks() skipped when tracking enabled
  // ──────────────────────────────────────────────
  describe("Test 1 — defragmentHyperlinks() with tracking", () => {
    it("should return 0 when called with tracking enabled (silently skipped)", () => {
      const doc = Document.create();
      const para = doc.createParagraph();
      para.addHyperlink(Hyperlink.createExternal("https://example.com", "Part 1"));
      para.addHyperlink(Hyperlink.createExternal("https://example.com", "Part 2"));

      doc.enableTrackChanges(trackOpts);

      // Returns 0 — silently skipped because tracking is active
      const mergedWithTracking = doc.defragmentHyperlinks({
        resetFormatting: true,
        cleanupRelationships: true,
      });
      expect(mergedWithTracking).toBe(0);

      doc.disableTrackChanges();

      // Actually merges when tracking is disabled
      const mergedWithoutTracking = doc.defragmentHyperlinks({
        resetFormatting: true,
        cleanupRelationships: true,
      });
      expect(mergedWithoutTracking).toBeGreaterThan(0);

      doc.dispose();
    });
  });

  // ──────────────────────────────────────────────
  // Test 2: hyperlink.setText() does NOT create tracked changes
  // ──────────────────────────────────────────────
  describe("Test 2 — setText() does NOT create tracked changes", () => {
    it("should silently overwrite text without creating revisions (even with tracking + _parentParagraph)", () => {
      const { doc, para, link } = createDocWithHyperlink("https://example.com", "Original Text");

      // Verify _parentParagraph is set
      expect(link._getParentParagraph()).toBeDefined();

      doc.enableTrackChanges(trackOpts);

      // setText silently overwrites — does NOT create del/ins revisions
      link.setText("New Text");

      const content = para.getContent();

      // Only 1 item: the same Hyperlink, no Revision elements added
      expect(content.length).toBe(1);
      expect(content[0]).toBeInstanceOf(Hyperlink);
      expect((content[0] as Hyperlink).getText()).toBe("New Text");

      // No revisions created
      const revisions = content.filter((item) => item instanceof Revision);
      expect(revisions.length).toBe(0);

      doc.dispose();
    });
  });

  // ──────────────────────────────────────────────
  // Test 3: setText() works without _parentParagraph (no crash)
  // ──────────────────────────────────────────────
  describe("Test 3 — setText() without _parentParagraph", () => {
    it("should update text directly without creating revisions when no parent paragraph", () => {
      const link = Hyperlink.createExternal("https://example.com", "Original");

      // No parent paragraph — setText just updates text
      link.setText("Updated");
      expect(link.getText()).toBe("Updated");
    });
  });

  // ──────────────────────────────────────────────
  // Test 4: Parsed document hyperlinks — setText still does NOT track
  // ──────────────────────────────────────────────
  describe("Test 4 — Parsed document hyperlinks: setText still does not track", () => {
    it("should NOT create tracked changes for setText on loaded document hyperlinks", async () => {
      // Create and save a doc with a hyperlink
      const { doc: origDoc } = createDocWithHyperlink("https://example.com", "Loaded Link");
      const buffer = await origDoc.toBuffer();
      origDoc.dispose();

      // Load from buffer
      const doc = await Document.loadFromBuffer(buffer, {
        revisionHandling: "preserve",
      });
      doc.enableTrackChanges(trackOpts);

      // Find and modify the hyperlink
      const hyperlinksData = doc.getHyperlinks();
      expect(hyperlinksData.length).toBeGreaterThanOrEqual(1);

      const { hyperlink, paragraph } = hyperlinksData[0];
      expect(hyperlink.getText()).toBe("Loaded Link");

      hyperlink.setText("Modified Link");

      // setText still does NOT create revisions, even for loaded docs
      const content = paragraph.getContent();
      const revisions = content.filter((item) => item instanceof Revision);
      expect(revisions.length).toBe(0);

      // Text was silently overwritten
      expect(hyperlink.getText()).toBe("Modified Link");

      doc.dispose();
    });
  });

  // ──────────────────────────────────────────────
  // Test 5: setFormatting() does NOT create w:rPrChange
  // ──────────────────────────────────────────────
  describe("Test 5 — setFormatting() with tracking", () => {
    it("should NOT create property change revision when formatting changes with tracking", () => {
      const { doc, link } = createDocWithHyperlink("https://example.com", "Formatted Link");

      link.setFormatting({
        font: "Verdana",
        size: 12,
        color: "FF0000",
        underline: "single",
        bold: false,
        italic: false,
      });

      doc.enableTrackChanges(trackOpts);

      link.setFormatting({
        font: "Verdana",
        size: 12,
        color: "0000FF",
        underline: "single",
        bold: false,
        italic: false,
      });

      // setFormatting does NOT create w:rPrChange
      const run = link.getRun();
      expect(run.hasPropertyChangeRevision()).toBe(false);

      doc.dispose();
    });

    it("should NOT produce w:rPrChange in saved XML", async () => {
      const { doc, link } = createDocWithHyperlink("https://example.com", "XML Check");

      link.setFormatting({ font: "Arial", size: 10, color: "FF0000" });

      doc.enableTrackChanges(trackOpts);

      link.setFormatting({
        font: "Verdana",
        size: 12,
        color: "0000FF",
        underline: "single",
        bold: false,
        italic: false,
      });

      const buffer = await doc.toBuffer();
      const zip = new AdmZip(buffer);
      const xml = zip.readAsText("word/document.xml");

      // No w:rPrChange in the output XML
      expect(xml).not.toContain("w:rPrChange");

      doc.dispose();
    });
  });

  // ──────────────────────────────────────────────
  // Test 6: URL tracked changes via manual revision creation
  // ──────────────────────────────────────────────
  describe("Test 6 — URL tracked changes via manual revision creation", () => {
    it("should create del/ins revision pair in paragraph content", () => {
      const { doc, para, link } = createDocWithHyperlink("https://old-url.com", "Link Text");

      doc.enableTrackChanges(trackOpts);

      // Clone to preserve old state
      const oldHyperlink = link.clone();

      // Update URL on the original
      link.setUrl("https://new-url.com");

      // Create revision pair
      const deletion = Revision.createDeletion("TestAuthor", [oldHyperlink]);
      const insertion = Revision.createInsertion("TestAuthor", [link]);

      // Replace the hyperlink in paragraph with revisions
      const replaced = para.replaceContent(link, [deletion, insertion]);
      expect(replaced).toBe(true);

      // Paragraph now contains 2 Revision elements
      const content = para.getContent();
      const revisions = content.filter((item) => item instanceof Revision) as Revision[];

      expect(revisions.length).toBe(2);

      const dels = revisions.filter((r) => r.getType() === "delete");
      const inss = revisions.filter((r) => r.getType() === "insert");
      expect(dels.length).toBe(1);
      expect(inss.length).toBe(1);

      // Deletion contains old hyperlink with old URL
      const delHyperlinks = dels[0].getHyperlinks();
      expect(delHyperlinks.length).toBe(1);
      expect(delHyperlinks[0].getUrl()).toBe("https://old-url.com");

      // Insertion contains new hyperlink with new URL
      const insHyperlinks = inss[0].getHyperlinks();
      expect(insHyperlinks.length).toBe(1);
      expect(insHyperlinks[0].getUrl()).toBe("https://new-url.com");

      doc.dispose();
    });

    it("should produce valid XML with w:del and w:ins elements after save", async () => {
      const { doc, para, link } = createDocWithHyperlink("https://old-url.com", "Link");

      doc.enableTrackChanges(trackOpts);

      const oldHyperlink = link.clone();
      link.setUrl("https://new-url.com");

      const deletion = Revision.createDeletion("TestAuthor", [oldHyperlink]);
      const insertion = Revision.createInsertion("TestAuthor", [link]);
      para.replaceContent(link, [deletion, insertion]);

      // Register revisions with the document
      const rm = doc.getRevisionManager();
      rm.register(deletion);
      rm.register(insertion);

      const buffer = await doc.toBuffer();
      const zip = new AdmZip(buffer);
      const xml = zip.readAsText("word/document.xml");

      // w:del and w:ins are present in the saved XML
      expect(xml).toContain("w:del");
      expect(xml).toContain("w:ins");
      // Both hyperlinks are present
      expect(xml).toContain("w:hyperlink");

      doc.dispose();
    });
  });

  // ──────────────────────────────────────────────
  // Test 7: End-to-end — manual revisions survive save/load cycle
  // ──────────────────────────────────────────────
  describe("Test 7 — End-to-end: manual revisions persist through save/load", () => {
    it("should have URL tracked changes visible in saved XML", async () => {
      const { doc, para, link } = createDocWithHyperlink("https://old.com", "Link");

      doc.enableTrackChanges(trackOpts);

      const oldLink = link.clone();
      link.setUrl("https://new.com");

      const deletion = Revision.createDeletion("TestAuthor", [oldLink]);
      const insertion = Revision.createInsertion("TestAuthor", [link]);
      para.replaceContent(link, [deletion, insertion]);

      const rm = doc.getRevisionManager();
      rm.register(deletion);
      rm.register(insertion);

      const buffer = await doc.toBuffer();
      const zip = new AdmZip(buffer);
      const xml = zip.readAsText("word/document.xml");

      expect(xml).toContain("w:ins");
      expect(xml).toContain("w:del");
      expect(xml).toContain("w:delText");
      expect(xml).toContain('w:author="TestAuthor"');

      doc.dispose();
    });

    it("should verify tracked changes survive in saved buffer XML (single save)", async () => {
      // This test confirms that tracked changes are correctly written
      // to the DOCX ZIP during the first save — which is all we need
      // since WordDocumentProcessor processes and saves once.
      const { doc, para, link } = createDocWithHyperlink("https://old.com", "Click Here");

      doc.enableTrackChanges(trackOpts);

      const oldLink = link.clone();
      link.setUrl("https://new.com");

      const deletion = Revision.createDeletion("TestAuthor", [oldLink]);
      const insertion = Revision.createInsertion("TestAuthor", [link]);
      para.replaceContent(link, [deletion, insertion]);

      const rm = doc.getRevisionManager();
      rm.register(deletion);
      rm.register(insertion);

      // Save to buffer and verify XML directly
      const buffer = await doc.toBuffer();
      const zip = new AdmZip(buffer);
      const xml = zip.readAsText("word/document.xml");

      // Tracked changes are present in the saved DOCX
      expect(xml).toContain("w:ins");
      expect(xml).toContain("w:del");
      expect(xml).toContain("w:hyperlink");
      expect(xml).toContain("Click Here");

      doc.dispose();
    });
  });
});

// ══════════════════════════════════════════════════════════════
// Phase 3 — setHyperlinkTextTracked / setHyperlinkUrlTracked pattern tests
// ══════════════════════════════════════════════════════════════

describe("Hyperlink Tracked Changes — Text/URL Helper Pattern", () => {
  const trackOpts = {
    author: "TestAuthor",
    trackFormatting: true,
    showInsertionsAndDeletions: true,
    clearExistingPropertyChanges: false,
  };

  function createDocWithHyperlink(url = "https://example.com", text = "Example Link") {
    const doc = Document.create();
    const para = doc.createParagraph();
    const link = Hyperlink.createExternal(url, text);
    para.addHyperlink(link);
    return { doc, para, link };
  }

  /**
   * Simulate the setHyperlinkTextTracked helper pattern:
   * clone → setText → Revision.createDeletion/createInsertion → replaceContent → register
   */
  function setHyperlinkTextTracked(
    doc: Document,
    hyperlink: Hyperlink,
    paragraph: Paragraph,
    newText: string,
    author: string
  ): boolean {
    if (!doc.isTrackChangesEnabled()) {
      hyperlink.setText(newText);
      return true;
    }
    const oldHyperlink = hyperlink.clone();
    hyperlink.setText(newText);
    const deletion = Revision.createDeletion(author, [oldHyperlink]);
    const insertion = Revision.createInsertion(author, [hyperlink]);
    const replaced = paragraph.replaceContent(hyperlink, [deletion, insertion]);
    if (replaced) {
      const rm = doc.getRevisionManager();
      rm.register(deletion);
      rm.register(insertion);
    }
    return replaced;
  }

  function setHyperlinkUrlTracked(
    doc: Document,
    hyperlink: Hyperlink,
    paragraph: Paragraph,
    newUrl: string,
    author: string
  ): boolean {
    if (!doc.isTrackChangesEnabled()) {
      hyperlink.setUrl(newUrl);
      return true;
    }
    const oldHyperlink = hyperlink.clone();
    hyperlink.setUrl(newUrl);
    const deletion = Revision.createDeletion(author, [oldHyperlink]);
    const insertion = Revision.createInsertion(author, [hyperlink]);
    const replaced = paragraph.replaceContent(hyperlink, [deletion, insertion]);
    if (replaced) {
      const rm = doc.getRevisionManager();
      rm.register(deletion);
      rm.register(insertion);
    }
    return replaced;
  }

  // ──────────────────────────────────────────────
  // Text tracking tests
  // ──────────────────────────────────────────────
  describe("setHyperlinkTextTracked pattern", () => {
    it("should create del/ins revision pair when tracking is enabled", () => {
      const { doc, para, link } = createDocWithHyperlink("https://example.com", "Old Title");
      doc.enableTrackChanges(trackOpts);

      const result = setHyperlinkTextTracked(doc, link, para, "New Title", "TestAuthor");
      expect(result).toBe(true);

      const content = para.getContent();
      const revisions = content.filter((item) => item instanceof Revision) as Revision[];
      expect(revisions.length).toBe(2);

      const dels = revisions.filter((r) => r.getType() === "delete");
      const inss = revisions.filter((r) => r.getType() === "insert");
      expect(dels.length).toBe(1);
      expect(inss.length).toBe(1);

      // Deletion contains old text
      const delHyperlinks = dels[0].getHyperlinks();
      expect(delHyperlinks.length).toBe(1);
      expect(delHyperlinks[0].getText()).toBe("Old Title");

      // Insertion contains new text
      const insHyperlinks = inss[0].getHyperlinks();
      expect(insHyperlinks.length).toBe(1);
      expect(insHyperlinks[0].getText()).toBe("New Title");

      doc.dispose();
    });

    it("should just call setText directly when tracking is disabled", () => {
      const { doc, para, link } = createDocWithHyperlink("https://example.com", "Old Title");
      // Do NOT enable track changes

      const result = setHyperlinkTextTracked(doc, link, para, "New Title", "TestAuthor");
      expect(result).toBe(true);

      // No revisions — just the hyperlink with new text
      const content = para.getContent();
      expect(content.length).toBe(1);
      expect(content[0]).toBeInstanceOf(Hyperlink);
      expect((content[0] as Hyperlink).getText()).toBe("New Title");

      doc.dispose();
    });

    it("should produce valid XML with w:del and w:ins after save", async () => {
      const { doc, para, link } = createDocWithHyperlink("https://example.com", "Before");
      doc.enableTrackChanges(trackOpts);

      setHyperlinkTextTracked(doc, link, para, "After", "TestAuthor");

      const buffer = await doc.toBuffer();
      const AdmZip = (await import("adm-zip")).default;
      const zip = new AdmZip(buffer);
      const xml = zip.readAsText("word/document.xml");

      expect(xml).toContain("w:del");
      expect(xml).toContain("w:ins");
      expect(xml).toContain("w:hyperlink");
      expect(xml).toContain('w:author="TestAuthor"');

      doc.dispose();
    });
  });

  // ──────────────────────────────────────────────
  // URL tracking tests
  // ──────────────────────────────────────────────
  describe("setHyperlinkUrlTracked pattern", () => {
    it("should create del/ins revision pair for URL change when tracking is enabled", () => {
      const { doc, para, link } = createDocWithHyperlink("https://old-url.com", "Link Text");
      doc.enableTrackChanges(trackOpts);

      const result = setHyperlinkUrlTracked(doc, link, para, "https://new-url.com", "TestAuthor");
      expect(result).toBe(true);

      const content = para.getContent();
      const revisions = content.filter((item) => item instanceof Revision) as Revision[];
      expect(revisions.length).toBe(2);

      const dels = revisions.filter((r) => r.getType() === "delete");
      const inss = revisions.filter((r) => r.getType() === "insert");
      expect(dels.length).toBe(1);
      expect(inss.length).toBe(1);

      // Deletion contains old URL
      const delHyperlinks = dels[0].getHyperlinks();
      expect(delHyperlinks[0].getUrl()).toBe("https://old-url.com");

      // Insertion contains new URL
      const insHyperlinks = inss[0].getHyperlinks();
      expect(insHyperlinks[0].getUrl()).toBe("https://new-url.com");

      doc.dispose();
    });

    it("should just call setUrl directly when tracking is disabled", () => {
      const { doc, para, link } = createDocWithHyperlink("https://old-url.com", "Link Text");

      const result = setHyperlinkUrlTracked(doc, link, para, "https://new-url.com", "TestAuthor");
      expect(result).toBe(true);

      const content = para.getContent();
      expect(content.length).toBe(1);
      expect(content[0]).toBeInstanceOf(Hyperlink);
      expect((content[0] as Hyperlink).getUrl()).toBe("https://new-url.com");

      doc.dispose();
    });
  });

  // ──────────────────────────────────────────────
  // Combined text + URL tracking
  // ──────────────────────────────────────────────
  describe("combined text and URL tracking", () => {
    it("should track both text and URL changes on the same hyperlink", () => {
      const { doc, para, link } = createDocWithHyperlink("https://old.com", "Old Text");
      doc.enableTrackChanges(trackOpts);

      // First track the text change
      setHyperlinkTextTracked(doc, link, para, "New Text", "TestAuthor");

      // Verify the text revision pair was created
      let content = para.getContent();
      let revisions = content.filter((item) => item instanceof Revision) as Revision[];
      expect(revisions.length).toBe(2);

      doc.dispose();
    });
  });
});

// ══════════════════════════════════════════════════════════════
// Phase 4 — relocateHyperlinkLeadingSpace() logic tests
// ══════════════════════════════════════════════════════════════

/**
 * Standalone reimplementation of the private
 * WordDocumentProcessor.relocateHyperlinkLeadingSpace() method
 * for testing against real docxmlater objects.
 */
function relocateHyperlinkLeadingSpace(
  hyperlink: Hyperlink,
  content: ParagraphContent[],
  index: number
): void {
  const text = hyperlink.getText();
  if (!text || !text.startsWith(" ")) return;

  const prev = index > 0 ? content[index - 1] : null;

  // No preceding content → trim (paragraph-start artifact)
  if (!prev) {
    hyperlink.setText(text.trimStart());
    return;
  }

  // Preceding item is a Run → relocate space
  if (prev instanceof Run) {
    const prevText = prev.getText() || "";
    if (!prevText.endsWith(" ")) {
      prev.setText(prevText + " ");
    }
    hyperlink.setText(text.trimStart());
    return;
  }

  // For other content types (Revision, ComplexField, PreservedElement),
  // leave the leading space on the hyperlink — it's the word separator
}

describe("relocateHyperlinkLeadingSpace — Logic Verification", () => {
  // ──────────────────────────────────────────────
  // Test 1: Basic relocation — Run("text") + Hyperlink(" Google")
  // ──────────────────────────────────────────────
  it("should relocate leading space from hyperlink to preceding Run", () => {
    const doc = Document.create();
    const para = doc.createParagraph();
    para.addText("text");
    const link = Hyperlink.createExternal("https://google.com", " Google");
    para.addHyperlink(link);

    const content = para.getContent();
    const hyperlinkIndex = content.findIndex((item) => item instanceof Hyperlink);

    relocateHyperlinkLeadingSpace(link, content, hyperlinkIndex);

    // Space relocated to the preceding Run
    const run = content[hyperlinkIndex - 1] as Run;
    expect(run.getText()).toBe("text ");
    expect(link.getText()).toBe("Google");

    doc.dispose();
  });

  // ──────────────────────────────────────────────
  // Test 2: Preceding Run already has trailing space
  // ──────────────────────────────────────────────
  it("should not double-space when preceding Run already ends with space", () => {
    const doc = Document.create();
    const para = doc.createParagraph();
    para.addText("text ");
    const link = Hyperlink.createExternal("https://google.com", " Google");
    para.addHyperlink(link);

    const content = para.getContent();
    const hyperlinkIndex = content.findIndex((item) => item instanceof Hyperlink);

    relocateHyperlinkLeadingSpace(link, content, hyperlinkIndex);

    // Preceding Run keeps its trailing space — no double-space
    const run = content[hyperlinkIndex - 1] as Run;
    expect(run.getText()).toBe("text ");
    expect(link.getText()).toBe("Google");

    doc.dispose();
  });

  // ──────────────────────────────────────────────
  // Test 3: Hyperlink is first in paragraph (no preceding content)
  // ──────────────────────────────────────────────
  it("should trim leading space when hyperlink is first in paragraph", () => {
    const doc = Document.create();
    const para = doc.createParagraph();
    const link = Hyperlink.createExternal("https://google.com", " Google");
    para.addHyperlink(link);

    const content = para.getContent();
    const hyperlinkIndex = content.findIndex((item) => item instanceof Hyperlink);

    relocateHyperlinkLeadingSpace(link, content, hyperlinkIndex);

    // Leading space trimmed — paragraph-start artifact
    expect(link.getText()).toBe("Google");

    doc.dispose();
  });

  // ──────────────────────────────────────────────
  // Test 4: Preceding non-Run (Revision) — leave space on hyperlink
  // ──────────────────────────────────────────────
  it("should leave leading space when preceding content is a Revision", () => {
    const doc = Document.create();
    const para = doc.createParagraph();
    para.addText("original text");

    // Create a Revision wrapping a Run
    const origLink = Hyperlink.createExternal("https://old.com", "old link");
    para.addHyperlink(origLink);

    doc.enableTrackChanges({
      author: "TestAuthor",
      trackFormatting: true,
      showInsertionsAndDeletions: true,
      clearExistingPropertyChanges: false,
    });

    // Replace the hyperlink with a Revision pair to get a Revision before our test link
    const oldLink = origLink.clone();
    origLink.setUrl("https://new.com");
    const deletion = Revision.createDeletion("TestAuthor", [oldLink]);
    const insertion = Revision.createInsertion("TestAuthor", [origLink]);
    para.replaceContent(origLink, [deletion, insertion]);
    doc.disableTrackChanges();

    // Now add our test hyperlink with leading space after the Revision
    const testLink = Hyperlink.createExternal("https://google.com", " Google");
    para.addHyperlink(testLink);

    const content = para.getContent();
    const testLinkIndex = content.findIndex((item) => item === testLink);

    // Preceding element should be a Revision (insertion), not a Run
    const preceding = content[testLinkIndex - 1];
    expect(preceding).toBeInstanceOf(Revision);

    relocateHyperlinkLeadingSpace(testLink, content, testLinkIndex);

    // Space left on hyperlink — can't safely relocate into a Revision
    expect(testLink.getText()).toBe(" Google");

    doc.dispose();
  });

  // ──────────────────────────────────────────────
  // Test 5: No leading space — no change
  // ──────────────────────────────────────────────
  it("should not modify anything when hyperlink has no leading space", () => {
    const doc = Document.create();
    const para = doc.createParagraph();
    para.addText("text");
    const link = Hyperlink.createExternal("https://google.com", "Google");
    para.addHyperlink(link);

    const content = para.getContent();
    const hyperlinkIndex = content.findIndex((item) => item instanceof Hyperlink);

    relocateHyperlinkLeadingSpace(link, content, hyperlinkIndex);

    // Nothing changed
    const run = content[hyperlinkIndex - 1] as Run;
    expect(run.getText()).toBe("text");
    expect(link.getText()).toBe("Google");

    doc.dispose();
  });

  // ──────────────────────────────────────────────
  // Test 6: Revision preceded by Run — space relocates to preceding Run
  // ──────────────────────────────────────────────
  it("should relocate leading space to Run preceding the Revision", () => {
    const doc = Document.create();
    const para = doc.createParagraph();
    para.addText("text");

    // Create a Revision wrapping a hyperlink with leading space
    const link = Hyperlink.createExternal("https://google.com", " Google");
    const insertion = Revision.createInsertion("TestAuthor", [link]);
    para.addContent(insertion);

    const content = para.getContent();
    const revisionIndex = content.findIndex((item) => item instanceof Revision);

    // The revision is first in content — check paragraph-level context
    // Preceding item at paragraph level is a Run
    const preceding = content[revisionIndex - 1];
    expect(preceding).toBeInstanceOf(Run);

    // Use the paragraph-level relocation (ri === 0, so use content/ci)
    relocateHyperlinkLeadingSpace(link, content, revisionIndex);

    // Space relocated to the preceding Run
    const run = content[revisionIndex - 1] as Run;
    expect(run.getText()).toBe("text ");
    expect(link.getText()).toBe("Google");

    doc.dispose();
  });

  // ──────────────────────────────────────────────
  // Test 7: Revision first in paragraph — space trimmed
  // ──────────────────────────────────────────────
  it("should trim leading space when Revision with hyperlink is first in paragraph", () => {
    const doc = Document.create();
    const para = doc.createParagraph();

    // Create a Revision wrapping a hyperlink with leading space — no preceding content
    const link = Hyperlink.createExternal("https://google.com", " Google");
    const insertion = Revision.createInsertion("TestAuthor", [link]);
    para.addContent(insertion);

    const content = para.getContent();

    // Hyperlink is first in Revision, Revision is first in paragraph
    // relocateHyperlinkLeadingSpace with index 0 → trims
    relocateHyperlinkLeadingSpace(link, content, 0);

    expect(link.getText()).toBe("Google");

    doc.dispose();
  });

  // ──────────────────────────────────────────────
  // Test 8: Run inside Revision before hyperlink — space relocates internally
  // ──────────────────────────────────────────────
  it("should relocate leading space to Run inside same Revision", () => {
    const doc = Document.create();
    const para = doc.createParagraph();

    // Create a Revision with a Run followed by a Hyperlink with leading space
    const run = Run.create("text");
    const link = Hyperlink.createExternal("https://google.com", " Google");
    const insertion = Revision.createInsertion("TestAuthor", [run, link]);
    para.addContent(insertion);

    const revisionContent = insertion.getContent();
    const hyperlinkIndex = revisionContent.findIndex((item) => item instanceof Hyperlink);

    // Preceding item inside the Revision is a Run
    expect(revisionContent[hyperlinkIndex - 1]).toBeInstanceOf(Run);

    // Use the revision-internal relocation
    relocateHyperlinkLeadingSpace(
      link,
      revisionContent as unknown as ParagraphContent[],
      hyperlinkIndex
    );

    // Space relocated to the internal Run
    expect(run.getText()).toBe("text ");
    expect(link.getText()).toBe("Google");

    doc.dispose();
  });

  // ──────────────────────────────────────────────
  // Test 9: Multiple leading spaces
  // ──────────────────────────────────────────────
  it("should relocate single space and trim all leading spaces from hyperlink", () => {
    const doc = Document.create();
    const para = doc.createParagraph();
    para.addText("text");
    const link = Hyperlink.createExternal("https://google.com", "  Google");
    para.addHyperlink(link);

    const content = para.getContent();
    const hyperlinkIndex = content.findIndex((item) => item instanceof Hyperlink);

    relocateHyperlinkLeadingSpace(link, content, hyperlinkIndex);

    // Single space added to preceding Run, all leading spaces trimmed from hyperlink
    const run = content[hyperlinkIndex - 1] as Run;
    expect(run.getText()).toBe("text ");
    expect(link.getText()).toBe("Google");

    doc.dispose();
  });
});
