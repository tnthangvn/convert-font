# WOFF Workspace Preview Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align the current WOFF editor with the requested icon-font workflow by keeping the working `.woff` and SVG conversion path, while improving glyph metadata preview, CSS preview, and action labeling.

**Architecture:** Keep the current Express server and vanilla single-page app. Treat this as an incremental enhancement to the existing workspace instead of a rewrite: the server stays responsible for parsing `.woff` files and generating `.woff` and `.css` assets, while the frontend gets clearer glyph cards, a better sort/reindex flow, and an on-page CSS preview.

**Tech Stack:** Node.js, Express, vanilla JS, `opentype.js`, `svgicons2svgfont`, `svg2ttf`, `ttf2woff`, optional `node:test` for lightweight regression coverage.

---

## Requirement Review Against Current Source

| Requested item | Current source state | Plan decision |
|---|---|---|
| Preview font in a grid with unicode like `{ title: rvi-eyes, content: '\\e904' }` | Grid and icon preview already exist in `public/index.html:114`, `public/app.js:235`, and `public/index.css:364`, but cards only show `U+E904` and do not show CSS `content` text. | Extend the glyph card metadata instead of replacing the grid. |
| Title can edit | Already supported via inline rename in `public/app.js:321`. | Keep the feature and make the edit affordance more explicit in the card layout. |
| Sort by name and reindex | Already supported via `sortGlyphsAZ()` and `reindexGlyphs()` in `public/app.js:140-151`. | Keep the behavior, rename the control copy to match the requirement, and verify it still runs after rename and drag-drop changes. |
| Preview icon | Already supported in `public/app.js:251` and styled in `public/index.css:390`. | Preserve current behavior. |
| Preview generated CSS | Server route exists in `server.js:308` and frontend download exists in `public/app.js:489`, but there is no on-page CSS preview. | Add a persistent preview panel and reuse the same generation path for preview and download. |
| Allow download `.woff` | Already supported via `server.js:206` and `public/app.js:427`. | Keep current behavior and make success state clearer. |
| Upload SVG and convert to webfont | Already supported via `public/app.js:377` and `server.js:206`. | Keep the current pipeline; focus work on UX clarity and validation polish. |

## Scope Guardrails

- Keep the app as a single-page tool.
- Do not replace the current `.woff` generation pipeline.
- Do not add new font formats in this pass.
- Do not add auth, persistence, or database work.
- Treat this as a UI and workflow alignment task, not a new product build.

### Task 1: Extract CSS Generation Into a Reusable, Testable Helper

**Files:**
- Modify: `server.js:308-343`
- Modify: `server.js:348`
- Modify: `package.json`
- Create: `tests/server/generate-css.test.js`

- [ ] **Step 1: Extract the CSS string builder out of the route handler**

Create a helper in `server.js` or a small new module such as `lib/build-css.js`:

```js
function buildCssText({ fontFamily, prefix, fontPath, glyphs, hash }) {
  // returns the complete CSS file text
}
```

- [ ] **Step 2: Add one shared codepoint formatter for CSS content escapes**

Use a helper that always formats codepoints as lowercase CSS escapes so both preview and download stay consistent:

```js
function formatCssEscape(codepoint) {
  return `\\${codepoint.toString(16).toLowerCase()}`;
}
```

- [ ] **Step 3: Refactor `/api/generate-css` to call the helper instead of building the string inline**

Keep the route contract unchanged:

Run: `npm run dev`
Expected: the existing `Export CSS` button still downloads a valid `.css` file.

- [ ] **Step 4: Make the server testable without starting the listener on import**

Guard `app.listen(...)` behind `if (require.main === module)` and export the pieces needed by tests:

```js
module.exports = { app, buildCssText };
```

- [ ] **Step 5: Add a lightweight server regression test**

Create `tests/server/generate-css.test.js` with assertions for:

```js
assert.match(css, /\.icon-rvi-eyes:before/);
assert.match(css, /content: '\\\\e904';/);
```

- [ ] **Step 6: Add a test script and verify it**

Run: `npm test`
Expected: one passing test file covering CSS generation output.

- [ ] **Step 7: Commit**

Run:

```bash
git add package.json server.js tests/server/generate-css.test.js
git commit -m "refactor: make css generation reusable"
```

### Task 2: Upgrade the Glyph Grid to Match the Requested Metadata Preview

**Files:**
- Modify: `public/index.html:90-164`
- Modify: `public/app.js:7-235`
- Modify: `public/app.js:321-585`
- Modify: `public/index.css:351-730`

- [ ] **Step 1: Extend the glyph card markup to show the requested metadata**

Each card should render:

```text
preview icon
editable title
U+E904
content: '\e904'
.icon-rvi-eyes
```

- [ ] **Step 2: Add a frontend helper for CSS escape preview**

Add a helper near `codepointToHex()` in `public/app.js`:

```js
function codepointToCssEscape(cp) {
  return cp ? `\\${cp.toString(16).toLowerCase()}` : '';
}
```

- [ ] **Step 3: Keep rename behavior, but make it obvious**

Replace the click-only rename affordance with either:
- an always-visible text input inside each card, or
- a clearer edit affordance that still uses `startInlineRename(...)`

Recommended: keep `startInlineRename(...)` and add a visible edit hint so the implementation stays small.

- [ ] **Step 4: Rename the sort action to match the requested behavior**

Change the button copy from `Sort A→Z` to `Sort by name`, and keep the existing sequence:

```js
state.glyphs.sort((a, b) => a.name.localeCompare(b.name));
reindexGlyphs();
renderGlyphList();
```

- [ ] **Step 5: Preserve the existing drag, remove, and preview behavior**

Run: `npm run dev`
Expected:
- drag reorder still works
- remove still works
- existing `.woff` glyphs still render previews
- uploaded SVG glyphs still render previews

- [ ] **Step 6: Commit**

Run:

```bash
git add public/index.html public/app.js public/index.css
git commit -m "feat: align glyph grid with icon font metadata"
```

### Task 3: Add an On-Page CSS Preview Instead of Download-Only Export

**Files:**
- Modify: `public/index.html:120-164`
- Modify: `public/app.js:427-585`
- Modify: `public/index.css:538-721`

- [ ] **Step 1: Add a CSS preview panel below the glyph grid**

The panel should include:
- a preview title
- a short helper sentence
- a read-only `<textarea>` or `<pre><code>` block
- a `Preview CSS` or `Refresh CSS` button if preview is not auto-generated

- [ ] **Step 2: Split `handleExportCss()` into shared fetch and download helpers**

Refactor:

```js
async function fetchGeneratedCss() {}
function downloadCss(cssText, fontFamily) {}
```

Use the same fetch path for both preview and download so the preview cannot drift from the downloaded file.

- [ ] **Step 3: Invalidate CSS preview when glyph metadata changes**

Reset preview state whenever any of these change:
- glyph name
- glyph order
- codepoint start / reindex
- font name
- CSS prefix
- glyph removal

- [ ] **Step 4: Keep the existing `Download .css` button, but back it with the shared preview text**

Run: `npm run dev`
Expected:
- preview renders valid CSS
- `.icon-rvi-eyes:before` appears in the preview
- `content: '\e904';` appears in the preview
- `Download .css` still works

- [ ] **Step 5: Commit**

Run:

```bash
git add public/index.html public/app.js public/index.css
git commit -m "feat: add generated css preview"
```

### Task 4: Polish the End-to-End Workflow Without Rebuilding Existing Features

**Files:**
- Modify: `public/index.html:54-164`
- Modify: `public/app.js:332-487`
- Modify: `README.md:1-37`

- [ ] **Step 1: Keep the existing happy path intact**

Do not redesign the following flows:
- open `.woff`
- create new font
- upload multiple `.svg`
- generate `.woff`
- download `.woff`

- [ ] **Step 2: Tighten user-facing copy to match the real workflow**

Update labels and status text so the page reads as:
- open or create font
- add SVG icons
- sort by name / reindex
- preview CSS
- generate `.woff`
- download `.woff` and `.css`

- [ ] **Step 3: Update the README usage section**

Add the missing steps so the docs reflect the actual feature set after implementation:
- rename glyph titles
- sort by name and reindex
- preview generated CSS
- download `.css` alongside `.woff`

- [ ] **Step 4: Commit**

Run:

```bash
git add public/index.html public/app.js README.md
git commit -m "docs: document the updated workspace flow"
```

### Task 5: Verification and Smoke Test Pass

**Files:**
- Test: `tests/server/generate-css.test.js`
- Verify: `public/index.html`
- Verify: `public/app.js`
- Verify: `public/index.css`
- Verify: `server.js`

- [ ] **Step 1: Run automated checks**

Run:

```bash
npm test
```

Expected: PASS

- [ ] **Step 2: Run the app locally**

Run:

```bash
npm run dev
```

Expected: app served at `http://localhost:3456`

- [ ] **Step 3: Execute the manual smoke checklist**

Verify all of the following:
1. Open an existing `.woff` file and confirm glyph cards render in a grid.
2. Confirm each card shows icon preview, title, unicode, CSS `content` preview, and selector preview.
3. Rename one glyph to `rvi-eyes`.
4. Click `Sort by name` and confirm cards reorder alphabetically and codepoints are reassigned sequentially.
5. Change the CSS prefix and confirm the preview updates.
6. Click `Preview CSS` or refresh the preview and confirm it includes `content: '\e904';` style values.
7. Upload one new `.svg` and confirm it appears in the same grid.
8. Generate `.woff` and download it.
9. Download `.css` and confirm it matches the on-page preview.
10. Recheck the workspace on a narrow mobile viewport.

- [ ] **Step 4: Run GitNexus scope validation before commit or merge**

Run:

```bash
npx gitnexus detect_changes --scope all
```

Expected: only the planned frontend, server, docs, and test files are reported.
