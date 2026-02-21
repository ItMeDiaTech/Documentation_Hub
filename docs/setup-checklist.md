# Development Infrastructure Setup Checklist

Manual steps required after committing the infrastructure configuration files.

## GitHub Secrets & Tokens

### docxmlater (ItMeDiaTech/docXMLater)

- [ ] **NPM_TOKEN** — Create an npm access token for publishing
  1. Go to https://www.npmjs.com/settings/tokens
  2. Create a "Granular Access Token" with read/write for `docxmlater`
  3. Add as repository secret: Settings → Secrets → Actions → `NPM_TOKEN`

- [ ] **CROSS_REPO_PAT** — Fine-grained GitHub token for cross-repo dispatch
  1. Go to https://github.com/settings/personal-access-tokens
  2. Create fine-grained token with:
     - Repository access: `ItMeDiaTech/Documentation_Hub`
     - Permissions: Contents (Read and Write)
  3. Add as repository secret in docXMLater repo: `CROSS_REPO_PAT`

### dochub-app (ItMeDiaTech/Documentation_Hub)

- [ ] **GITHUB_TOKEN** — Automatically available, no action needed

## Renovate Bot

- [ ] Install the Renovate GitHub App on the `ItMeDiaTech` organization
  1. Go to https://github.com/apps/renovate
  2. Install for `ItMeDiaTech/Documentation_Hub`
  3. The `renovate.json` config file will be picked up automatically

## Local Development Tools

- [ ] Install yalc globally:
  ```bash
  npm install -g yalc
  ```

- [ ] Verify yalc works:
  ```bash
  # In docxmlater directory
  npm run build
  yalc publish

  # In dochub-app directory
  yalc add docxmlater
  ```

## Verification After Push

- [ ] **docxmlater CI** — Push to main or open a PR. Verify the CI workflow runs and passes.
- [ ] **dochub-app CI** — Push to main or open a PR. Verify the CI workflow runs and passes.
- [ ] **Release Please** — Push a conventional commit to docxmlater main. Verify Release Please creates a release PR.
- [ ] **Cross-repo dispatch** — After a docxmlater release, verify dochub-app CI is triggered.

## yalc Local Development Flow

```bash
# Terminal 1 — docxmlater (watch + push)
cd docxmlater
npm run dev:full

# Terminal 2 — dochub-app (link)
cd dochub-app
yalc add docxmlater
npm run electron:dev

# Changes to docxmlater src/ will auto-compile and push via yalc (~2s)
```

## Before Publishing

```bash
# In dochub-app — remove yalc link before committing
npm run predist
# This runs: yalc remove --all && npm install
```
