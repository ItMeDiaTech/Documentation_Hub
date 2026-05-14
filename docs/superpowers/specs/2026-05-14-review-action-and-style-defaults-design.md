# Comprehensive Review Fixes + Style Default Updates

**Date:** 2026-05-14
**Status:** Design

## Summary

Implement the 12 Critical and 33 High findings from the comprehensive code review delivered in `.full-review/` on 2026-05-14, plus update factory style defaults for the `Normal` and `Heading 2` paragraph styles. Work lands as 12 logically-grouped commits on the master branch. Security agent findings were not part of the review (skipped at user direction); a few defense-in-depth idioms (sandbox flag, CSP) are nonetheless included because they were surfaced as language/framework best-practice gaps.

## Goals

1. Land the 45 high-priority review findings (12 Critical + 33 High) with each commit focused on a single concern area, so any one can be reverted independently.
2. Change the factory defaults for paragraph styles `Normal` (spaceBefore/After: 3 → 6) and `Heading 2` (spaceBefore/After: 6 → 9). Persisted user sessions are unaffected; only newly-created sessions and `resetSessionToDefaults` pick up the change.
3. Close the Jest infrastructure gap that has been silently excluding `electron/__tests__/` from CI.
4. Add a render-count regression test that gates the `setSessions` storm fix.
5. Document a code-signing path (no implementation; user does not currently have an EV/OV certificate).

## Non-Goals

- Medium- and Low-severity findings (37 + 25 items) — deferred to a follow-up branch.
- Migration of existing user-session data — factory-default changes apply only to new sessions and explicit resets.
- Switching to a different DOCX library — DocXMLater remains sole.
- E2E test infrastructure — not in scope.
- Sentry / AppCenter / crash reporter integration — product decision deferred.

## Style Default Changes

Two files hold style defaults and must move together:

1. `src/contexts/SessionContext.tsx` — `DEFAULT_SESSION_STYLES` constant (source of truth for `createSession` and `resetSessionToDefaults`).
2. `src/components/sessions/StylesEditor.tsx` — local defaults used by the editor UI for fallback fields.

Numeric edits:

| Style | Field | Old | New |
|-------|-------|-----|-----|
| Normal | `spaceBefore` | 3 | 6 |
| Normal | `spaceAfter` | 3 | 6 |
| Heading 2 | `spaceBefore` | 6 | 9 |
| Heading 2 | `spaceAfter` | 6 | 9 |

`lineSpacing` (line-height multiplier) is not changed.

## Commit Sequence

Twelve commits. Each must pass `npm run typecheck && npm run lint` before the next begins. From commit 12 onward, `npm test` will pick up `electron/__tests__/` as well.

### Commit 1 — `feat(styles): change default Normal and Heading 2 paragraph spacing`
- Files: `src/contexts/SessionContext.tsx`, `src/components/sessions/StylesEditor.tsx`.
- Standalone so it can be reverted without touching review work.

### Commit 2 — `chore(deps): drop unused docx/mammoth + squatter 'all' package`
- `npm uninstall all docx mammoth` (BP-H5).
- Lockfile regenerates.
- Verify no imports break: `grep -r "from ['\"]docx['\"]\|from ['\"]mammoth['\"]\|from ['\"]all['\"]\b" src electron` returns nothing.

### Commit 3 — `chore(tsconfig): rename moduleResolution and drop ignoreDeprecations`
- `tsconfig.electron.json:6`: `"node"` → `"node10"` (BP-H1).
- `tsconfig.json:4`: remove `"ignoreDeprecations": "6.0"` (AL2).
- Verify clean `npm run typecheck`.

### Commit 4 — `fix(electron): sandbox + CSP + async stat + node: prefix + IPC signatures`
- `electron/main.ts`: add `sandbox: true`, `webSecurity: true`, `allowRunningInsecureContent: false` to `REQUIRED_SECURITY_SETTINGS` (BP-C1).
- `electron/main.ts`: add CSP via `session.defaultSession.webRequest.onHeadersReceived` with `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https:` (BP-H2). Tune `style-src` if framer-motion / Radix / Tailwind 4 inject inline styles in dev — dev console will report violations.
- `electron/main.ts:1299-1322`: `fs.statSync` → `await fsPromises.stat` (H3/P-H2). Update handler signature from `(...[, filePath]: [Event, string])` to `(_event, filePath: string)` (BP-M6 — applied only to lines this commit changes).
- `node:` import prefix on `electron/main.ts`, `BackupService.ts`, `customUpdater.ts`, `DictionaryService.ts`, `SharePointSyncService.ts` (BP-M1 partial — High-priority files only).
- Replace dead `webContents.session.getPreloadScripts()` tautology block at `electron/main.ts:308-381` with `webContents.getLastWebPreferences()` assertion or delete it; the `as const` already prevents drift (BP-M5).

### Commit 5 — `fix(ipc): rename process-document → document:get-stats; refresh CLAUDE.md inventory`
- Rename channel in `electron/main.ts:1299` (AH2).
- Rename wrapper in `electron/preload.ts`.
- Update any renderer call sites via grep.
- Update `electron/CLAUDE.md` IPC inventory to reflect actual channels: add `file:read-buffer`, `document:extract-text`, `open-comparison-window`, `display:get-all-displays`, `display:identify-monitors`, `platform`, `open-document`, `open-external`, `document:get-stats`; correct `process-document` description elsewhere (DH1/DL1).

### Commit 6 — `fix(session): spread order, dedup, await deletes, withTimeout cleanup`
- `src/pages/CurrentSession.tsx:504-505` and `:556-564`: standardize on `...session.processingOptions` first, named overrides last (C1).
- `src/contexts/SessionContext.tsx` `addDocuments`: move dedup into the `updateSessionById` updater callback using `Set<path>` lookup (C2 + P-H1). Closure-staleness fixed because the updater sees authoritative `prev` state.
- `deleteSession`: `await deleteSessionFromDB(id)`; surface error to caller; UI shows error toast (H6).
- Extract `withTimeout` to `src/utils/withTimeout.ts`. New implementation uses `AbortController` + `AbortSignal.timeout(ms)`, plumbed through `electronAPI.processDocument` via an optional `{ signal }` option. Fallback simple race uses `.finally(clearTimeout)` for callers that don't support cancellation (H2/M7/P-H5/BP-H3/AL3).
  - `electronAPI.processDocument` signature change: optional `signal` arg added; preload wrapper forwards via `ipcRenderer.invoke` and the main-side handler checks `controller.signal.aborted` at safe checkpoints.

### Commit 7 — `refactor(processor): consolidate run iterators; fix nested-revision walk; Roman bounds`
- Rename `src/services/document/helpers/revisionSafeRuns.ts` → `helpers/paragraphRuns.ts` exporting two named functions (AH4/AM1):
  - `getBodyRuns(para)`: excludes hyperlink-child runs and deleted-revision runs (replaces today's `WordDocumentProcessor.getAllRunsFromParagraph` + `StyleProcessor.getAllRunsFromParagraph`).
  - `getVisibleRuns(para)`: includes hyperlink runs but excludes deleted-revision runs.
- `getVisibleRuns` recurses into `Hyperlink.getContent()` and `ComplexField.getContent()` when looking for `Revision` items (H4 — closes under-deletion bug; DC1 caveat removed since the limitation no longer exists). Uses `isRevision` type guard rather than `instanceof` to handle DocXMLater's `PreservedElement` wrapping (root `CLAUDE.md` gotcha).
- Migrate all callers in `WordDocumentProcessor.ts` and `StyleProcessor.ts` to the new helper; delete both private duplicates.
- `src/services/document/list/list-detection.ts`: hoist regex array to module-level `const` so RegExps compile once (P-L3).
- Document Roman regex upper bound (`i…xv`) inline with explicit comment instead of extending alternation; lists with `xvi+` items will fall through and be detected as plain paragraphs (H1 — bounded contract documented, not extended).

### Commit 8 — `refactor(tables): hyperlink-restore helper + merged column-width pass`
- New `src/services/document/helpers/applyRunFormattingPreservingHyperlink.ts`:
  ```ts
  applyRunFmtPreservingHyperlink(run, font, size, opts: { bold? })
  ```
  Internally: single `getFormatting()` call; conditional `setFont`/`setSize`/`setBold` only when changed; `setColor("0000FF")` + `setUnderline("single")` only when run is hyperlink-styled and currently differs.
- Replace 5 call sites in `TableProcessor.ts:491, 538, 580, 724, 1428` (H5/P-H3).
- New `TableProcessor.enforceMinimumColumnWidth(doc, settings)` taking the implementation of the inline block at `WordDocumentProcessor.ts:3186-3253` (AM4).
- Merge min-column-width + step-column-width passes so each cell's `tcW` is written at most once per pipeline run; cache `isHLPTable` / `shouldSkipTable` per table in `WeakMap<Table, Classification>` (P-H4 + P-L4).
- Replace magic `1440` with `inchesToTwips(1)` / hoisted `TWIPS_PER_INCH` (M2).
- Add `log.debug` to the bail-out branch when surplus < deficit (M1).

### Commit 9 — `perf(state): collapse setSessions storm; stabilize virtual-list memos`
- Migrate the three `setSessions((prev) => prev.map(...))` sites in `processDocument` (`SessionContext.tsx:1091, 1098, 1730, 1853`) to `updateSessionById` (AH3 + P-C2 part 1).
- Collapse status-flip + result + stats updates so `processDocument` issues at most two `updateSessionById` calls per doc (start, finish) (P-C2 part 2).
- Persist `timeSavedMinutes` once at `processDocument` finalization; remove client-side `(hyperlinks * 101) / 60` recomputations from `VirtualDocumentList.tsx:127`, `Analytics.tsx`, `Dashboard.tsx`, `CurrentSession.tsx:674` — all read `stats.timeSaved` directly (M5 + P-M3).
- `VirtualDocumentList.tsx`:
  - `itemData` wrapped in `useMemo(..., [documents, callbacks, selectedDocumentId, showActions, heights])`.
  - `getItemSize` reads from a `useMemo<number[]>` heights array indexed by row (P-C3 step 1).
  - Row callbacks destructure their leaf deps (`onDocumentClick`, `onProcessDocument`) rather than closing over `data` (P-C3 step 2 + BP-L3).
  - `@ts-ignore` → `@ts-expect-error` on `react-window` imports (BP-L2).
- Same memo + destructure shape applied to `VirtualSessionList.tsx` (P-M2).
- `ensureSessionStyles` / `ensureListBulletSettings`: short-circuit when `session.styles && session.listBulletSettings` already present (P-M1).
- `closeSession` / `deleteSession` route through `updateSessionById` (or new `removeSessionById` sibling) for symmetry (M8).

### Commit 10 — `perf(boot): lazy-load WordDocumentProcessor + ESLint boundary rule`
- `electron/main.ts:6`: remove static `import { WordDocumentProcessor }`.
- Add lazy singleton factory near the IPC handler init:
  ```ts
  let processorPromise: Promise<WordDocumentProcessor> | null = null;
  const getProcessor = () => {
    if (!processorPromise) {
      processorPromise = import("../src/services/document/WordDocumentProcessor")
        .then((m) => new m.WordDocumentProcessor());
    }
    return processorPromise;
  };
  ```
- `HyperlinkIPCHandler.setupHandlers()`: `(await getProcessor()).processDocument(...)`; drop constructor-time `new WordDocumentProcessor()` (`:621`) (P-C1/BP-H4).
- Add comment at the existing `DocumentProcessingComparison` dynamic-import site explaining the lazy-load contract (DL3).
- Add `eslint.config.js` `no-restricted-imports` rule blocking renderer code (`src/contexts/**`, `src/pages/**`, `src/components/**`) from importing `@/services/document/*` values (types-only allowed via `import type`) (AH1).

### Commit 11 — `test: cover new helpers, bug fixes, and render regression`
- `src/utils/__tests__/withTimeout.test.ts` (T-H1).
- `src/services/document/helpers/__tests__/paragraphRuns.test.ts` — fast-path, delete-revision filter, nested-hyperlink-revision walk, insert-revision pass-through (T-C1, augmented for H4 fix).
- `src/services/document/helpers/__tests__/applyRunFormattingPreservingHyperlink.test.ts`.
- `src/contexts/__tests__/SessionContext.updateSessionById.test.ts` — tri-state sync via `renderHook` + `SessionProvider` (T-H2).
- `src/services/document/__tests__/romanRegex.test.ts` — `i.`…`xv.` valid; `xvi.`, `index.`, `iv` (no period) invalid; case-insensitive (T-H4).
- `TableProcessor.test.ts`: add four tests covering the previously-uncovered hyperlink-restore call sites at `:491, :538, :580, :724` (T-H5).
- `electron/__tests__/BackupService.prefixCollision.test.ts` — `Report` vs `Report_v2` (T-C2).
- `electron/__tests__/SharePointSyncService.atomicImport.test.ts` — failed import preserves existing entries (M3).
- `src/contexts/__tests__/SessionContext.renderCount.test.ts` — process a single doc; assert `renderCount <= 3` (P-C2/M2).
- `src/services/document/helpers/__tests__/ImageBorderCropper.test.ts`: add `MIN_DIMENSION_PX` guard test, fix the `.not.toThrow()` assertion to also check return value (M1 from testing phase).

### Commit 12 — `chore(ci): jest roots, husky, version checks, release safety, docs sweep`
- `jest.config.js:5`: `roots: ["<rootDir>/src", "<rootDir>/electron"]` (CICD-C1).
- `jest.config.js`: add coverage threshold per-file for `src/services/**`, `electron/services/**` (CICD-M3).
- `.husky/pre-commit` (new): `npm run lint && npm run typecheck` (CICD-H1).
- `.github/workflows/build.yml`: add `validate-tag` job verifying `git tag === package.json.version` before `build` job (CICD-C2).
- `electron/__tests__/version-consistency.test.ts`: `app.getVersion()` matches `package.json.version` (CICD-H3).
- Extract `release` script to `scripts/release.sh` with `set -e`, `set -o pipefail`, `trap`, and existence checks; update `package.json:15` to call it (CICD-H2).
- `scripts/validate-msi-config.js` asserting `upgradeCode === 'CF863E5D-30C2-470B-B337-4373B543F563'`; called by `release.sh` before electron-builder (CICD-H4).
- `scripts/__tests__/generate-latest-yml.test.js` — assert YAML structure, SHA512 length 88, size > 0 (CICD-M1).
- `docs/operations/code-signing.md` (new) — EV-cert acquisition, electron-builder `certificateFile`/`certificatePassword` env-var wiring, CI secret setup. No code change (CICD-C3 deferred to documentation).
- Update root `CLAUDE.md`:
  - Replace 3-function pipeline line with cross-link to `docs/DOCUMENT_PROCESSING_PIPELINE.md` (DH3).
  - Add gotcha for `isHyperlinkStyled()` (XML-parent context not checked) (DL2).
- Update `src/services/document/CLAUDE.md`: index `helpers/paragraphRuns.ts` and `DocumentProcessingComparison.ts` (DH4).
- Update `docs/DOCUMENT_PROCESSING_PIPELINE.md`:
  - Phase 9: remove stale `convertMixedListFormats` entry (DM2).
  - Phase 11: add min-column-width enforcement step (DM1).
- Update `docs/versions/changelog.md`:
  - Header version → `5.12.1`.
  - Add entries for v5.9.0–v5.12.1 covering the major changes from each version's commits (DH2/DM4).
- Drop `react-router` from `devDependencies` in `package.json` (BP-M4).
- `.nvmrc` (new): `22` (CICD-L1).

## Files Touched

| Layer | Files |
|-------|-------|
| Root config | `package.json`, `package-lock.json`, `tsconfig.json`, `tsconfig.electron.json`, `jest.config.js`, `.husky/pre-commit` (new), `.nvmrc` (new), `eslint.config.js` |
| CI | `.github/workflows/build.yml`, `scripts/release.sh` (new), `scripts/validate-msi-config.js` (new), `scripts/__tests__/generate-latest-yml.test.js` (new) |
| Electron | `electron/main.ts`, `electron/preload.ts`, `electron/customUpdater.ts`, `electron/services/BackupService.ts`, `electron/services/DictionaryService.ts`, `electron/services/SharePointSyncService.ts`, `electron/__tests__/*` (new tests) |
| Contexts | `src/contexts/SessionContext.tsx`, `src/contexts/__tests__/*` (new) |
| Pages | `src/pages/CurrentSession.tsx`, `src/pages/Analytics.tsx`, `src/pages/Dashboard.tsx` |
| Components | `src/components/document/VirtualDocumentList.tsx`, `src/components/sessions/VirtualSessionList.tsx`, `src/components/sessions/StylesEditor.tsx` |
| Services | `src/services/document/WordDocumentProcessor.ts`, `src/services/document/processors/TableProcessor.ts`, `src/services/document/processors/StyleProcessor.ts`, `src/services/document/list/list-detection.ts`, `src/services/document/helpers/paragraphRuns.ts` (renamed from `revisionSafeRuns.ts`), `src/services/document/helpers/applyRunFormattingPreservingHyperlink.ts` (new), `src/services/document/helpers/__tests__/*` (new) |
| Utils | `src/utils/withTimeout.ts` (new), `src/utils/__tests__/withTimeout.test.ts` (new) |
| Docs | `CLAUDE.md` (root), `electron/CLAUDE.md`, `src/services/document/CLAUDE.md`, `docs/DOCUMENT_PROCESSING_PIPELINE.md`, `docs/versions/changelog.md`, `docs/operations/code-signing.md` (new) |

## Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| `getVisibleRuns` recursive walk into `Hyperlink.getContent()` returns `PreservedElement` (root CLAUDE.md gotcha) rather than `Hyperlink` instances. | Use `isRevision` type guard rather than `instanceof Revision`. Regression test in commit 11 covers the nested-revision path. |
| Strict CSP may break Tailwind 4 / Radix / framer-motion / lucide / recharts inline styles. | Start with `style-src 'self' 'unsafe-inline'`. If any of the deps later require `script-src 'unsafe-eval'` (e.g., dev mode HMR), document and scope to dev only. |
| Lazy-load adds ~50–100ms latency to first `processDocument` call. | Document in `docs/DOCUMENT_PROCESSING_PIPELINE.md`. No prefetch needed; one-time cost amortizes over a batch. |
| Once `jest.config.js` `roots` includes `electron/`, pre-existing `electron/__tests__/main.test.ts` may have failing assertions. | If failures appear in commit 12, either fix in the same commit or quarantine with `it.skip` + a TODO comment referencing this spec. Do not let CI go red on master. |
| `withTimeout` AbortController plumbing through `ipcRenderer.invoke` is non-trivial — `invoke` itself does not honor `AbortSignal`. | Pass a `cancellationToken` in the IPC payload; main-side handler stores it in a `Map<token, AbortController>` and checks `signal.aborted` at safe checkpoints (between processing phases). Renderer-side `withTimeout` aborts by sending an `ipc:cancel` message with the token. |
| `processDocument` two-update collapse may need to preserve an intermediate "processing" UI state. | Use a separate `progressMap: Map<docId, ProgressState>` outside `sessions` for transient state (P-C2 part 3). Status flips write only to the map; final result writes to `sessions`. |
| Deferring `Medium` findings means M1 (column-width log), M2 (twips constant), M5 (timeSaved unit unification), M3 (structuredClone) are partially landed inside the High commits where they overlap; remaining Medium items deferred. | The spec is explicit: only items I list in the per-commit details land in this batch. Other Medium items remain in the review reports for follow-up. |

## Verification Strategy

- **Per commit:** `npm run typecheck && npm run lint` must pass before staging.
- **Existing test suite (`npm test`):** must remain green on every commit. Each commit that changes behavior covered by an existing test runs the relevant suite locally; full suite runs at minimum on commits 1, 6, 8, 9, 10, 11, 12.
- **New tests added in commit 11:** must pass from commit 11 onward.
- **Electron test inclusion:** the `roots` change in commit 12 brings `electron/__tests__/` into scope. Any pre-existing failures uncovered there must be fixed in the same commit or quarantined with `it.skip` + a TODO referencing this spec — CI must not go red on master.
- **Commit 9 (perf):** Run the render-count regression test from commit 11 against the pre-fix code to confirm it would have caught the bug; then again post-fix to confirm green.
- **Commit 10 (lazy-load):** Manual smoke test — open the app, observe cold-start time in DevTools Performance tab; expect a measurable drop before first `processDocument` call.
- **Commit 12 (CI):** Push to a branch first, verify the new `validate-tag` job behaves correctly with a tag/version mismatch (intentionally bump tag without bumping `package.json`) before merging.
- **Final:** After all 12 commits land, run `npm run build` end-to-end to confirm the installer builds clean.

## Open Items Acknowledged But Not Addressed

These were noted in review but explicitly out of scope:

- Medium findings (37) — separate follow-up branch.
- Low findings (25) — backlog.
- Crash reporter / telemetry — product decision deferred.
- E2E test infrastructure — not justified for current scope.
- IPC channel naming convention sweep beyond `process-document` — opportunistic; not a blocking refactor.
- Time-saved seconds-per-hyperlink constant (101) — leave as-is; reviewing whether it's accurate is a separate task.
