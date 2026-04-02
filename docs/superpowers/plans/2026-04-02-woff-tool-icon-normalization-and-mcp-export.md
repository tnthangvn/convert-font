# WOFF Tool Icon Normalization and MCP Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing internal WOFF workspace so a user can normalize one icon or all icons to a fixed size/alignment, then expose the latest generated `font.woff` plus icon preview metadata through a small MCP surface for another repository to consume.

**Architecture:** Keep the current Express server and vanilla single-page app. Add browser-side SVG normalization helpers and pure placement math so icon resizing stays deterministic without introducing a frontend build step, then persist the latest generated font bundle on the server so both the web UI and a new MCP server can serve the same artifact contract.

**Tech Stack:** Node.js 18, Express, vanilla JS, `opentype.js`, `svgicons2svgfont`, `svg2ttf`, `ttf2woff`, `node:test`, `@modelcontextprotocol/sdk` (for the MCP transport only).

---

## Scope Check

The revised requirements now cover two loosely coupled subsystems:

1. Icon normalization inside the web UI.
2. External artifact export for another repository through MCP.

They can still live in one implementation plan because the second subsystem depends on the font-generation output shape from the first. Execute them in order. If delivery needs to split later, split after Task 4.

## English Requirement Notes

This is the reviewed English translation of the new requirements:

- Add a feature to resize one selected icon to a fixed target size and align it horizontally/vertically within its container.
- Add a feature to resize all icons to the same fixed target size and shared alignment preset, for example `28x28`, `center`, `center`.
- Add an MCP capability so another repository can connect to this repo, fetch the latest generated `font.woff`, and fetch preview/icon metadata that can be used to update source code in that other repository.

## File Structure

Lock the decomposition before implementation:

- Create: `public/fit-box.js`
  Responsibility: Pure reusable math for fitting source bounds into a target box with left/center/right and top/center/bottom alignment.
- Create: `public/svg-normalize.js`
  Responsibility: Browser-only SVG parsing, hidden measurement SVG, and transformed SVG output generation.
- Modify: `public/index.html`
  Responsibility: Load the new browser helpers and add normalization controls plus the latest-artifact status block.
- Modify: `public/index.css`
  Responsibility: Style the normalization controls, selected glyph state, and artifact export state without replacing the current app layout.
- Modify: `public/app.js`
  Responsibility: Manage selected glyph state, normalization actions, generation invalidation, and the UI bridge to the new server artifact contract.
- Create: `lib/build-preview-manifest.js`
  Responsibility: Produce deterministic preview metadata from the current glyph list for UI download, HTTP export, and MCP export.
- Create: `lib/latest-artifacts.js`
  Responsibility: Persist and read the latest generated `woff`/CSS/preview manifest under a deterministic server-side directory.
- Modify: `server.js`
  Responsibility: Reuse shared helpers, persist latest artifacts on generation, and expose HTTP endpoints that mirror the MCP contract.
- Create: `mcp/server.js`
  Responsibility: Expose MCP tools/resources that read the persisted latest artifacts without depending on browser state.
- Modify: `package.json`
  Responsibility: Add scripts for the MCP server and, if needed, the new MCP SDK dependency.
- Create: `tests/server/fit-box.test.js`
  Responsibility: Lock alignment/scale math before UI wiring.
- Create: `tests/server/build-preview-manifest.test.js`
  Responsibility: Lock preview metadata shape before HTTP/MCP export work.
- Create: `tests/server/latest-artifacts.test.js`
  Responsibility: Lock latest-artifact persistence/read behavior before wiring server routes and MCP handlers.
- Modify: `README.md`
  Responsibility: Document normalization workflow, latest-artifact behavior, and how another repo connects to the MCP server.

## Data Contract Decisions

Use these contracts consistently across frontend, HTTP export, and MCP export:

```js
// In-memory glyph shape in public/app.js
{
  id: 1,
  name: 'rvi-eyes',
  codepoint: 0xE904,
  svgContentOriginal: '<svg ... />',
  svgContent: '<svg ... />',
  svgPathData: null,
  isNew: true,
  normalization: {
    targetWidth: 28,
    targetHeight: 28,
    alignX: 'center',
    alignY: 'center',
  }
}
```

```js
// Preview manifest shape from lib/build-preview-manifest.js
{
  fontFamily: 'CustomFont',
  prefix: 'icon',
  generatedAt: '2026-04-02T15:00:00.000Z',
  glyphs: [
    {
      name: 'rvi-eyes',
      codepoint: 59652,
      unicodeHex: 'U+E904',
      cssSelector: '.icon-rvi-eyes',
      cssContent: '\\e904',
      previewSvg: '<svg ... />'
    }
  ]
}
```

```js
// Latest artifact manifest persisted on disk
{
  fontFamily: 'CustomFont',
  prefix: 'icon',
  woffFileName: 'CustomFont.woff',
  cssFileName: 'CustomFont.css',
  manifestFileName: 'preview-manifest.json',
  generatedAt: '2026-04-02T15:00:00.000Z',
  glyphCount: 12
}
```

### Task 1: Lock Reusable Placement Math Before UI Work

**Files:**
- Create: `public/fit-box.js`
- Create: `tests/server/fit-box.test.js`
- Modify: `public/index.html`

- [ ] **Step 1: Write the failing math test for centered placement**

Create `tests/server/fit-box.test.js`:

```js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { computePlacementTransform } = require('../../public/fit-box');

describe('computePlacementTransform', () => {
  it('scales proportionally and centers inside the target box', () => {
    const result = computePlacementTransform({
      sourceWidth: 16,
      sourceHeight: 10,
      targetWidth: 28,
      targetHeight: 28,
      alignX: 'center',
      alignY: 'center',
    });

    assert.equal(result.scale, 1.75);
    assert.equal(result.translateX, 0);
    assert.equal(result.translateY, 5.25);
    assert.match(result.transform, /translate\(0 5.25\) scale\(1.75\)/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/server/fit-box.test.js`
Expected: FAIL with `Cannot find module '../../public/fit-box'`

- [ ] **Step 3: Implement the pure placement helper as a browser+Node shared module**

Create `public/fit-box.js`:

```js
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.fitBox = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function pickOffset(extraSpace, align) {
    if (align === 'end') return extraSpace;
    if (align === 'center') return extraSpace / 2;
    return 0;
  }

  function computePlacementTransform({
    sourceWidth,
    sourceHeight,
    targetWidth,
    targetHeight,
    alignX = 'center',
    alignY = 'center',
  }) {
    const scale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
    const scaledWidth = sourceWidth * scale;
    const scaledHeight = sourceHeight * scale;
    const translateX = pickOffset(targetWidth - scaledWidth, alignX);
    const translateY = pickOffset(targetHeight - scaledHeight, alignY);

    return {
      scale,
      translateX,
      translateY,
      transform: `translate(${translateX} ${translateY}) scale(${scale})`,
    };
  }

  return { computePlacementTransform };
});
```

- [ ] **Step 4: Expand the test to cover left/top and right/bottom alignment**

Append to `tests/server/fit-box.test.js`:

```js
it('supports start and end alignment', () => {
  const start = computePlacementTransform({
    sourceWidth: 10,
    sourceHeight: 10,
    targetWidth: 28,
    targetHeight: 40,
    alignX: 'start',
    alignY: 'start',
  });
  const end = computePlacementTransform({
    sourceWidth: 10,
    sourceHeight: 10,
    targetWidth: 28,
    targetHeight: 40,
    alignX: 'end',
    alignY: 'end',
  });

  assert.equal(start.translateX, 0);
  assert.equal(start.translateY, 0);
  assert.equal(end.translateX, 0);
  assert.equal(end.translateY, 12);
});
```

- [ ] **Step 5: Load the shared helper before `app.js`**

Update the bottom of `public/index.html`:

```html
  <script src="fit-box.js"></script>
  <script src="app.js"></script>
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `node --test tests/server/fit-box.test.js`
Expected: PASS with 2 passing tests

- [ ] **Step 7: Commit**

Run:

```bash
git add public/fit-box.js public/index.html tests/server/fit-box.test.js
git commit -F- <<'EOF'
Establish reusable icon placement math before normalization UI work

The normalization feature needs deterministic fit and alignment behavior before any browser workflow is added, so this commit locks the math in a shared helper and test.

Constraint: Browser code must stay build-step free
Confidence: high
Scope-risk: narrow
Directive: Keep placement math pure and reusable; DOM measurement belongs elsewhere
Tested: node --test tests/server/fit-box.test.js
Not-tested: Browser integration
EOF
```

### Task 2: Add Single-Icon Fixed-Size Normalization

**Files:**
- Create: `public/svg-normalize.js`
- Modify: `public/index.html`
- Modify: `public/index.css`
- Modify: `public/app.js`

- [ ] **Step 1: Add the failing browser-side integration hook in `public/app.js`**

Add the new state fields near the top of `public/app.js`:

```js
selectedGlyphId: null,
normalizationDefaults: {
  targetWidth: 28,
  targetHeight: 28,
  alignX: 'center',
  alignY: 'center',
},
```

And add this call where glyph cards are rendered:

```js
card.classList.toggle('glyph-card--selected', glyph.id === state.selectedGlyphId);
card.addEventListener('click', () => {
  state.selectedGlyphId = glyph.id;
  renderGlyphList();
  renderNormalizationPanel();
});
```

- [ ] **Step 2: Add the normalization panel markup**

Insert this block below the glyph toolbar in `public/index.html`:

```html
        <div id="normalizationPanel" class="normalization-panel hidden">
          <div class="normalization-panel__header">
            <h3 class="normalization-panel__title">Normalize Selected Icon</h3>
            <p id="normalizationTarget" class="normalization-panel__target">Select a glyph to edit its size/alignment.</p>
          </div>
          <div class="normalization-panel__grid">
            <label class="normalization-field">
              <span>Width</span>
              <input id="normalizeWidthInput" class="form-input form-input--sm" type="number" min="1" value="28">
            </label>
            <label class="normalization-field">
              <span>Height</span>
              <input id="normalizeHeightInput" class="form-input form-input--sm" type="number" min="1" value="28">
            </label>
            <label class="normalization-field">
              <span>Horizontal</span>
              <select id="normalizeAlignX" class="form-input form-input--sm">
                <option value="start">Left</option>
                <option value="center" selected>Center</option>
                <option value="end">Right</option>
              </select>
            </label>
            <label class="normalization-field">
              <span>Vertical</span>
              <select id="normalizeAlignY" class="form-input form-input--sm">
                <option value="start">Top</option>
                <option value="center" selected>Center</option>
                <option value="end">Bottom</option>
              </select>
            </label>
          </div>
          <button id="btnNormalizeSelected" class="btn btn--secondary btn--sm" type="button">Apply to selected</button>
        </div>
```

- [ ] **Step 3: Implement browser-only SVG measurement and transform output**

Create `public/svg-normalize.js`:

```js
(function (root) {
  function createMeasureHost() {
    const host = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    host.setAttribute('width', '0');
    host.setAttribute('height', '0');
    host.style.position = 'absolute';
    host.style.opacity = '0';
    host.style.pointerEvents = 'none';
    document.body.appendChild(host);
    return host;
  }

  function normalizeSvgContent(svgContent, options) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgContent, 'image/svg+xml');
    const svg = doc.querySelector('svg');
    const host = createMeasureHost();
    const measured = document.importNode(svg, true);
    host.appendChild(measured);
    const bbox = measured.getBBox();
    const fit = root.fitBox.computePlacementTransform({
      sourceWidth: bbox.width || 1,
      sourceHeight: bbox.height || 1,
      targetWidth: options.targetWidth,
      targetHeight: options.targetHeight,
      alignX: options.alignX,
      alignY: options.alignY,
    });

    const inner = svg.innerHTML;
    host.remove();
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${options.targetWidth} ${options.targetHeight}" fill="currentColor"><g transform="${fit.transform}">${inner}</g></svg>`;
  }

  root.svgNormalize = { normalizeSvgContent };
})(typeof globalThis !== 'undefined' ? globalThis : window);
```

- [ ] **Step 4: Preserve original SVG content and apply normalization to a selected glyph**

Modify glyph creation in `public/app.js` so every glyph keeps the original:

```js
state.glyphs.push({
  id: nextId(),
  name: sanitizeName(file.name),
  codepoint: null,
  svgContentOriginal: content,
  svgContent: content,
  svgPathData: null,
  isNew: true,
  file,
  normalization: null,
});
```

Add the selected-glyph action:

```js
function handleNormalizeSelected() {
  const glyph = state.glyphs.find((item) => item.id === state.selectedGlyphId);
  if (!glyph || !glyph.svgContentOriginal) return;

  const options = {
    targetWidth: Number(normalizeWidthInput.value) || 28,
    targetHeight: Number(normalizeHeightInput.value) || 28,
    alignX: normalizeAlignX.value,
    alignY: normalizeAlignY.value,
  };

  glyph.normalization = options;
  glyph.svgContent = window.svgNormalize.normalizeSvgContent(glyph.svgContentOriginal, options);
  state.generatedBlob = null;
  invalidateCssPreview();
  renderGlyphList();
  renderNormalizationPanel();
}
```

- [ ] **Step 5: Add the panel renderer and selected-glyph styling**

Add this renderer in `public/app.js`:

```js
function renderNormalizationPanel() {
  const glyph = state.glyphs.find((item) => item.id === state.selectedGlyphId);
  if (!glyph) {
    hide(normalizationPanel);
    return;
  }

  show(normalizationPanel);
  normalizationTarget.textContent = `Editing ${glyph.name}`;
  const opts = glyph.normalization || state.normalizationDefaults;
  normalizeWidthInput.value = opts.targetWidth;
  normalizeHeightInput.value = opts.targetHeight;
  normalizeAlignX.value = opts.alignX;
  normalizeAlignY.value = opts.alignY;
}
```

Add styles in `public/index.css`:

```css
.glyph-card--selected {
  border-color: rgba(99, 102, 241, 0.7);
  box-shadow: 0 0 0 1px rgba(99, 102, 241, 0.35);
}

.normalization-panel {
  margin-bottom: 20px;
  padding: 16px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-glass);
}
```

- [ ] **Step 6: Wire the new script and the button**

Update the script order in `public/index.html`:

```html
  <script src="fit-box.js"></script>
  <script src="svg-normalize.js"></script>
  <script src="app.js"></script>
```

Add listeners in `public/app.js`:

```js
const normalizationPanel = $('#normalizationPanel');
const normalizationTarget = $('#normalizationTarget');
const normalizeWidthInput = $('#normalizeWidthInput');
const normalizeHeightInput = $('#normalizeHeightInput');
const normalizeAlignX = $('#normalizeAlignX');
const normalizeAlignY = $('#normalizeAlignY');
const btnNormalizeSelected = $('#btnNormalizeSelected');

if (btnNormalizeSelected) {
  btnNormalizeSelected.addEventListener('click', handleNormalizeSelected);
}
```

- [ ] **Step 7: Run the manual smoke test**

Run: `npm run dev`
Expected:
- Open `http://localhost:3456`
- Upload one SVG
- Click the glyph card
- Set `28 x 28`, `Left`, `Bottom`
- Click `Apply to selected`
- The card preview updates and the app does not crash

- [ ] **Step 8: Commit**

Run:

```bash
git add public/index.html public/index.css public/app.js public/svg-normalize.js
git commit -F- <<'EOF'
Add per-icon normalization controls for fixed-size alignment

This introduces the smallest useful editing surface for the new resize requirement by letting a user normalize one selected glyph without changing the rest of the workspace.

Constraint: No frontend bundler and no new browser dependency
Confidence: medium
Scope-risk: moderate
Directive: Always preserve the original SVG content so normalization stays reversible
Tested: npm run dev
Not-tested: Automated browser coverage
EOF
```

### Task 3: Add Bulk Normalize-All Controls

**Files:**
- Modify: `public/index.html`
- Modify: `public/index.css`
- Modify: `public/app.js`

- [ ] **Step 1: Add the bulk action controls next to the single-icon controls**

Extend the normalization panel in `public/index.html`:

```html
          <div class="normalization-panel__actions">
            <button id="btnNormalizeSelected" class="btn btn--secondary btn--sm" type="button">Apply to selected</button>
            <button id="btnNormalizeAll" class="btn btn--primary btn--sm" type="button">Apply to all</button>
          </div>
```

- [ ] **Step 2: Add the bulk handler in `public/app.js`**

```js
function handleNormalizeAll() {
  const options = {
    targetWidth: Number(normalizeWidthInput.value) || 28,
    targetHeight: Number(normalizeHeightInput.value) || 28,
    alignX: normalizeAlignX.value,
    alignY: normalizeAlignY.value,
  };

  state.normalizationDefaults = options;

  state.glyphs.forEach((glyph) => {
    if (!glyph.svgContentOriginal) return;
    glyph.normalization = options;
    glyph.svgContent = window.svgNormalize.normalizeSvgContent(glyph.svgContentOriginal, options);
  });

  state.generatedBlob = null;
  invalidateCssPreview();
  renderGlyphList();
  renderNormalizationPanel();
}
```

- [ ] **Step 3: Invalidate generated artifacts whenever normalization changes**

Strengthen the shared invalidation path in `public/app.js`:

```js
function invalidateGeneratedOutputs() {
  state.generatedBlob = null;
  state.cssPreviewText = null;
  hide(downloadSection);
  if (cssPreviewCode) {
    cssPreviewCode.innerHTML = '<code>/* Preview outdated — click "Preview CSS" to refresh */</code>';
    cssPreviewCode.classList.add('css-preview__code--stale');
  }
}
```

Replace direct calls to `invalidateCssPreview()` in normalization, rename, remove, sort, and reindex flows with:

```js
invalidateGeneratedOutputs();
```

- [ ] **Step 4: Make the bulk preset explicit in the UI**

Add this helper text to `public/index.html`:

```html
          <p class="normalization-panel__hint">Example preset: `28 x 28`, horizontal `Center`, vertical `Center`.</p>
```

Add matching style in `public/index.css`:

```css
.normalization-panel__hint {
  color: var(--text-muted);
  font-size: 0.85rem;
  margin-top: 10px;
}
```

- [ ] **Step 5: Wire the new button and verify the default preset**

Add the DOM reference and listener:

```js
const btnNormalizeAll = $('#btnNormalizeAll');

if (btnNormalizeAll) {
  btnNormalizeAll.addEventListener('click', handleNormalizeAll);
}
```

Run: `npm run dev`
Expected:
- Upload three SVGs
- Set `28 x 28`, `Center`, `Center`
- Click `Apply to all`
- All glyph previews update
- The download card hides until `.woff` is generated again

- [ ] **Step 6: Commit**

Run:

```bash
git add public/index.html public/index.css public/app.js
git commit -F- <<'EOF'
Add bulk normalization so all glyphs can share one fixed-size preset

The second resize requirement is batch-oriented, so this commit adds a single preset-driven action that rewrites every glyph from its preserved original SVG.

Constraint: Batch normalization must not rely on previously transformed SVG output
Confidence: medium
Scope-risk: moderate
Directive: Always normalize from svgContentOriginal, never from already-normalized svgContent
Tested: npm run dev
Not-tested: Large icon sets over 100 glyphs
EOF
```

### Task 4: Persist the Latest Generated Font Bundle and Preview Metadata

**Files:**
- Create: `lib/build-preview-manifest.js`
- Create: `lib/latest-artifacts.js`
- Modify: `server.js`
- Create: `tests/server/build-preview-manifest.test.js`
- Create: `tests/server/latest-artifacts.test.js`

- [ ] **Step 1: Write the failing preview-manifest test**

Create `tests/server/build-preview-manifest.test.js`:

```js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildPreviewManifest } = require('../../lib/build-preview-manifest');

describe('buildPreviewManifest', () => {
  it('builds deterministic glyph preview metadata', () => {
    const manifest = buildPreviewManifest({
      fontFamily: 'CustomFont',
      prefix: 'icon',
      glyphs: [
        { name: 'rvi-eyes', codepoint: 0xE904, svgContent: '<svg></svg>' },
      ],
    });

    assert.equal(manifest.fontFamily, 'CustomFont');
    assert.equal(manifest.prefix, 'icon');
    assert.equal(manifest.glyphs[0].unicodeHex, 'U+E904');
    assert.equal(manifest.glyphs[0].cssSelector, '.icon-rvi-eyes');
    assert.equal(manifest.glyphs[0].cssContent, '\\e904');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/server/build-preview-manifest.test.js`
Expected: FAIL with `Cannot find module '../../lib/build-preview-manifest'`

- [ ] **Step 3: Implement the preview-manifest builder**

Create `lib/build-preview-manifest.js`:

```js
'use strict';

const { formatCssEscape } = require('./build-css');

function buildPreviewManifest({ fontFamily, prefix, glyphs }) {
  return {
    fontFamily,
    prefix,
    generatedAt: new Date().toISOString(),
    glyphs: glyphs.map((glyph) => ({
      name: glyph.name,
      codepoint: glyph.codepoint,
      unicodeHex: `U+${glyph.codepoint.toString(16).toUpperCase().padStart(4, '0')}`,
      cssSelector: `.${prefix}-${glyph.name}`,
      cssContent: formatCssEscape(glyph.codepoint),
      previewSvg: glyph.svgContent,
    })),
  };
}

module.exports = { buildPreviewManifest };
```

- [ ] **Step 4: Write the failing persistence test**

Create `tests/server/latest-artifacts.test.js`:

```js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { writeLatestArtifacts, readLatestArtifacts } = require('../../lib/latest-artifacts');

describe('latest artifacts', () => {
  it('writes and reads the current bundle contract', async () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'woff-tool-artifacts-'));

    await writeLatestArtifacts({
      baseDir,
      fontFamily: 'CustomFont',
      prefix: 'icon',
      woffBuffer: Buffer.from('woff-data'),
      cssText: '.icon-rvi-eyes:before { content: "\\\\e904"; }',
      previewManifest: { fontFamily: 'CustomFont', prefix: 'icon', glyphs: [] },
    });

    const result = await readLatestArtifacts({ baseDir });
    assert.equal(result.meta.fontFamily, 'CustomFont');
    assert.equal(result.woffBuffer.toString(), 'woff-data');
    assert.match(result.cssText, /\.icon-rvi-eyes:before/);
  });
});
```

- [ ] **Step 5: Implement deterministic artifact persistence**

Create `lib/latest-artifacts.js`:

```js
'use strict';

const fs = require('fs/promises');
const path = require('path');

async function writeLatestArtifacts({ baseDir, fontFamily, prefix, woffBuffer, cssText, previewManifest }) {
  await fs.mkdir(baseDir, { recursive: true });
  const meta = {
    fontFamily,
    prefix,
    woffFileName: `${fontFamily}.woff`,
    cssFileName: `${fontFamily}.css`,
    manifestFileName: 'preview-manifest.json',
    generatedAt: new Date().toISOString(),
    glyphCount: previewManifest.glyphs.length,
  };

  await fs.writeFile(path.join(baseDir, meta.woffFileName), woffBuffer);
  await fs.writeFile(path.join(baseDir, meta.cssFileName), cssText, 'utf8');
  await fs.writeFile(path.join(baseDir, meta.manifestFileName), JSON.stringify(previewManifest, null, 2), 'utf8');
  await fs.writeFile(path.join(baseDir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');

  return meta;
}

async function readLatestArtifacts({ baseDir }) {
  const meta = JSON.parse(await fs.readFile(path.join(baseDir, 'meta.json'), 'utf8'));
  const [woffBuffer, cssText, manifestText] = await Promise.all([
    fs.readFile(path.join(baseDir, meta.woffFileName)),
    fs.readFile(path.join(baseDir, meta.cssFileName), 'utf8'),
    fs.readFile(path.join(baseDir, meta.manifestFileName), 'utf8'),
  ]);

  return {
    meta,
    woffBuffer,
    cssText,
    previewManifest: JSON.parse(manifestText),
  };
}

module.exports = { writeLatestArtifacts, readLatestArtifacts };
```

- [ ] **Step 6: Persist the latest artifacts after successful generation**

Modify `server.js`:

```js
const { buildPreviewManifest } = require('./lib/build-preview-manifest');
const { writeLatestArtifacts, readLatestArtifacts } = require('./lib/latest-artifacts');

const LATEST_ARTIFACTS_DIR = path.join(__dirname, 'artifacts', 'latest');
```

Inside the `/api/generate` success path:

```js
const prefix = req.body?.cssPrefix || 'icon';
const glyphContract = (glyphMeta || []).map((glyph) => ({
  name: glyph.name,
  codepoint: glyph.codepoint,
  svgContent: glyph.svgContent,
}));
const cssText = buildCssText({
  fontFamily: fontName,
  prefix,
  fontPath: `fonts/${fontName}.woff`,
  glyphs: glyphContract,
});
const previewManifest = buildPreviewManifest({
  fontFamily: fontName,
  prefix,
  glyphs: glyphContract,
});
await writeLatestArtifacts({
  baseDir: LATEST_ARTIFACTS_DIR,
  fontFamily: fontName,
  prefix,
  woffBuffer,
  cssText,
  previewManifest,
});
```

- [ ] **Step 7: Add lightweight HTTP endpoints for the latest artifacts**

Append to `server.js`:

```js
app.get('/api/latest-artifacts', async (req, res) => {
  const latest = await readLatestArtifacts({ baseDir: LATEST_ARTIFACTS_DIR });
  res.json({
    ...latest.meta,
    previewManifest: latest.previewManifest,
  });
});

app.get('/api/latest-artifacts/woff', async (req, res) => {
  const latest = await readLatestArtifacts({ baseDir: LATEST_ARTIFACTS_DIR });
  res.set({
    'Content-Type': 'font/woff',
    'Content-Disposition': `attachment; filename="${latest.meta.woffFileName}"`,
  });
  res.send(latest.woffBuffer);
});
```

- [ ] **Step 8: Run the tests**

Run: `node --test tests/server/build-preview-manifest.test.js tests/server/latest-artifacts.test.js`
Expected: PASS with both suites passing

- [ ] **Step 9: Commit**

Run:

```bash
git add lib/build-preview-manifest.js lib/latest-artifacts.js server.js tests/server/build-preview-manifest.test.js tests/server/latest-artifacts.test.js
git commit -F- <<'EOF'
Persist the latest generated font bundle for reuse outside the browser

The new cross-repo requirement needs a server-side source of truth for the most recent generated artifacts, so this commit saves the latest WOFF, CSS, and preview manifest in one deterministic location.

Constraint: No database or background job system
Confidence: medium
Scope-risk: moderate
Directive: Keep HTTP and MCP export backed by the same persisted artifact directory
Tested: node --test tests/server/build-preview-manifest.test.js tests/server/latest-artifacts.test.js
Not-tested: Concurrent generations from multiple users
EOF
```

### Task 5: Expose the Latest Bundle Through MCP

**Files:**
- Create: `mcp/server.js`
- Modify: `package.json`
- Modify: `README.md`

- [ ] **Step 1: Add the MCP dependency and script**

Update `package.json`:

```json
{
  "scripts": {
    "dev": "node server.js",
    "start": "node server.js",
    "test": "node --test 'tests/**/*.test.js'",
    "mcp": "node mcp/server.js"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.0"
  }
}
```

- [ ] **Step 2: Implement a minimal MCP server backed by the persisted latest artifacts**

Create `mcp/server.js`:

```js
'use strict';

const path = require('path');
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { readLatestArtifacts } = require('../lib/latest-artifacts');

const latestDir = path.join(__dirname, '..', 'artifacts', 'latest');
const server = new Server({ name: 'woff-tool', version: '1.0.0' }, { capabilities: { tools: {} } });

server.setRequestHandler('tools/list', async () => ({
  tools: [
    {
      name: 'get_latest_font_bundle',
      description: 'Return the latest generated WOFF, CSS, and preview manifest.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    },
  ],
}));

server.setRequestHandler('tools/call', async (request) => {
  if (request.params.name !== 'get_latest_font_bundle') {
    throw new Error(`Unknown tool: ${request.params.name}`);
  }

  const latest = await readLatestArtifacts({ baseDir: latestDir });
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          meta: latest.meta,
          cssText: latest.cssText,
          previewManifest: latest.previewManifest,
          woffBase64: latest.woffBuffer.toString('base64'),
        }),
      },
    ],
  };
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 3: Document how another repo connects to the MCP server**

Add this section to `README.md`:

````md
## MCP Export

Run the MCP server:

```bash
npm run mcp
```

Tool contract:

- `get_latest_font_bundle`
  - Returns `meta`
  - Returns `cssText`
  - Returns `previewManifest`
  - Returns `woffBase64`

The MCP server only exposes the latest successfully generated bundle under `artifacts/latest/`. Generate the font in the web UI first.
````

- [ ] **Step 4: Install dependencies and run the MCP smoke test**

Run: `npm install`
Expected: installs `@modelcontextprotocol/sdk`

Run: `npm run mcp`
Expected: process starts without syntax/runtime errors and waits on stdio

- [ ] **Step 5: Commit**

Run:

```bash
git add package.json package-lock.json README.md mcp/server.js
git commit -F- <<'EOF'
Expose the latest generated font bundle through a small MCP server

Another repository needs a machine-consumable way to fetch the latest font output and preview metadata, so this commit wraps the persisted latest-artifact directory in a minimal MCP tool.

Constraint: MCP must not depend on browser memory or manual file copying
Rejected: Build a second HTTP-only integration surface | user explicitly requested MCP connectivity
Confidence: medium
Scope-risk: moderate
Directive: Keep the MCP tool contract stable because downstream repos will automate against it
Tested: npm install; npm run mcp
Not-tested: Remote client integration from the consuming repository
EOF
```

### Task 6: Wire the Frontend to the New Artifact Contract and Verify End-to-End

**Files:**
- Modify: `public/app.js`
- Modify: `public/index.html`
- Modify: `README.md`
- Verify: `server.js`
- Verify: `mcp/server.js`

- [ ] **Step 1: Send the CSS prefix along with generation requests**

Update `handleGenerate()` in `public/app.js`:

```js
formData.append('fontName', fontNameInput.value || state.fontName);
formData.append('cssPrefix', cssPrefixInput.value.trim() || 'icon');
formData.append('glyphMeta', JSON.stringify(glyphMeta));
```

- [ ] **Step 2: Show whether a latest bundle is available after generation**

Add this block near the download section in `public/index.html`:

```html
        <div id="latestBundleNotice" class="latest-bundle-notice hidden">
          Latest bundle updated and available to MCP consumers.
        </div>
```

Add the UI update in `public/app.js` after generation succeeds:

```js
show(latestBundleNotice);
latestBundleNotice.textContent = 'Latest bundle updated and available to MCP consumers.';
```

- [ ] **Step 3: Document the new normalization workflow in `README.md`**

Update the usage section so it includes:

```md
4. **Normalize one icon** — select a glyph, set width/height/alignment, and apply to the selected icon
5. **Normalize all icons** — apply a shared preset such as `28x28`, `center`, `center`
6. **Preview CSS** — refresh generated CSS after glyph metadata changes
7. **Generate** — create the latest `.woff`, `.css`, and preview manifest bundle
8. **Download / MCP consume** — download locally or let another repo fetch the latest bundle through MCP
```

- [ ] **Step 4: Run the automated checks**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Run the local app and complete the manual smoke checklist**

Run: `npm run dev`
Expected: app served at `http://localhost:3456`

Manual checklist:

1. Open `Create New`.
2. Upload three SVG files.
3. Select one glyph and apply `28x28`, `Left`, `Bottom`.
4. Confirm only that glyph preview changes.
5. Apply `28x28`, `Center`, `Center` to all.
6. Confirm all glyph previews update and the previous download card disappears.
7. Preview CSS and confirm selectors/content values still match the glyph list.
8. Generate `.woff`.
9. Download `.woff`.
10. Request `GET /api/latest-artifacts` and confirm it returns preview metadata.
11. Request `GET /api/latest-artifacts/woff` and confirm it returns a `.woff`.
12. Start `npm run mcp` and confirm the process starts cleanly.

- [ ] **Step 6: Run GitNexus scope validation before merge**

Run: `npx gitnexus detect_changes --scope all`
Expected: only the planned frontend, server, MCP, docs, and test files are reported

- [ ] **Step 7: Commit**

Run:

```bash
git add public/index.html public/app.js README.md
git commit -F- <<'EOF'
Finish the normalization and MCP export workflow end to end

This final integration commit connects the browser generation flow to the latest-artifact contract and documents the completed workflow for local and cross-repo use.

Constraint: The latest bundle must reflect the same inputs used for manual download
Confidence: medium
Scope-risk: moderate
Directive: Keep the frontend, HTTP export, and MCP export on one artifact contract to avoid drift
Tested: npm test; npm run dev; npm run mcp; npx gitnexus detect_changes --scope all
Not-tested: Consuming repo automation against the MCP tool
EOF
```

## Self-Review

### 1. Spec Coverage

- Existing v1 requirements still covered: open/create, add multiple SVGs, generate/download WOFF, readable errors, single-page UI.
- New requirement covered: single-icon normalization in Task 2.
- New requirement covered: bulk normalization in Task 3.
- New requirement covered: MCP export and cross-repo bundle access in Task 5.
- Setup/run notes covered: Task 5 and Task 6 update `README.md`.

### 2. Placeholder Scan

- No `TODO`, `TBD`, or “implement later” placeholders remain.
- Each code-changing step includes a concrete code block.
- Each verification step includes a concrete command and expected result.

### 3. Type Consistency

- Alignment values are consistently `start | center | end`.
- Normalization dimensions are consistently `targetWidth` and `targetHeight`.
- Export naming is consistently `latest artifacts`, `previewManifest`, and `woffBuffer`.
- The MCP tool name is consistently `get_latest_font_bundle`.
