## Implementation Plan: CSS Sync Sorting, Font URL Hash Preservation, and CSS Prefix Fixes

### Task Type
- [x] Frontend
- [x] Backend
- [ ] Fullstack parallel

### Enhanced Requirement
Fix WOFF Tool CSS sync behavior so existing CSS files stay deterministic and user settings apply everywhere:

1. When syncing WOFF + CSS to an existing `.css` file such as `public/icon.css`, generated icon rules must be reordered according to current glyph order after sort/reindex, not left in prior file order.
2. When existing `@font-face` has `src: url('~~/public/fonts/RV-Icon.woff?mnj1teui') format('woff');`, sync must preserve `~~/public/fonts/RV-Icon.woff` and update only query suffix.
3. CSS Prefix input must propagate consistently. If user changes `icon` to `rvi`, generated CSS, synced CSS, glyph card preview, and latest bundle metadata must use `rvi`.
4. Keep non-generated/custom CSS blocks in existing files unless they are managed font-face/base/glyph escape rules for active prefix.
5. If generated icon rules are interleaved with custom icon/emoji rules, move all synced generated icon rules into one dedicated group at bottom of file instead of sorting in-place.

### Context Summary
- `public/app.js:16` initializes `state.cssPrefix` from `sessionStorage` or `'icon'`.
- `public/index.html:226-227` renders CSS Prefix input with default `value="icon"`.
- `public/app.js:1053-1109` `handleGenerate()` sends `fontName` and `glyphMeta`, but not `cssPrefix`.
- `server.js:355` therefore falls back to `req.body.cssPrefix || 'icon'` in `persistLatestBundle()`.
- `public/app.js:968-980` `handleSyncFileFont()` already sends `prefix` for CSS sync.
- `public/app.js:1128-1153` `fetchGeneratedCss()` drives CSS preview/copy output.
- `public/app.js:1169-1201` `handlePreviewCss()` consumes generated CSS.
- `lib/build-css.js:16-25` `renderFontFace()` always renders a full new URL from `fontPath` + `hash`.
- `lib/build-css.js:162-225` `mergeCssText()` replaces `@font-face`, updates matching glyph blocks in old order, and appends new glyphs.
- `tests/server/generate-css.test.js` covers `buildCssText()`; sync behavior needs stronger tests.
- Antigravity confirmed UX issue: prefix input invalidates preview but does not re-render glyph cards, so `.icon-*` can stay visible after user enters `rvi`.
- Codex wrapper failed again before analysis output; session ID captured below for traceability.

### Impact Analysis
GitNexus impact checks before editing:

| Symbol | Risk | Direct callers | Affected processes |
|---|---:|---:|---:|
| `buildCssText` (`lib/build-css.js`) | LOW | 2 (`server.js`, `tests/server/generate-css.test.js`) | 0 |
| `handleGenerate` (`public/app.js`) | LOW | 1 (`handleSyncFileFont`) | 1 |
| `handleSyncFileFont` (`public/app.js`) | LOW | 0 | 0 |
| `fetchGeneratedCss` (`public/app.js`) | LOW expected | Used by copy/preview CSS flows | `HandleCopyCss → FetchGeneratedCss` |
| `mergeCssText` (`lib/build-css.js`) | UNKNOWN in index | Not indexed | Read manually: imported by `server.js` |

No HIGH/CRITICAL risk from GitNexus results already captured in prior plan.

### Technical Solution
Centralize deterministic CSS behavior in `lib/build-css.js` and keep frontend state/payloads aligned:

1. Keep `buildCssText()` ordered by incoming `glyphs`.
2. Extend `mergeCssText()` so managed glyph rules are collected, updated, and emitted in incoming `glyphs` order.
3. Preserve existing `@font-face` URL path when merging existing CSS, but generate fresh cachebuster query.
4. Keep custom/non-managed blocks in place.
5. Emit synced generated icon rules as one sorted group at bottom of CSS file when generated rules are mixed with custom icon rules, avoiding in-place reorder across custom blocks.
6. Fix frontend prefix flow by sending `cssPrefix` during `/api/generate` and re-rendering glyph card selectors when prefix input changes.
7. Avoid broad prefix-independent deletion in first pass: only manage active prefix rules unless test fixtures prove old-prefix generated rules must be migrated. This prevents deleting unrelated legacy/custom CSS.

### Implementation Steps

1. **Add URL extraction helper in `lib/build-css.js`**
   - Create helper near `extractContentValue()` or font helpers.
   - Extract path inside first `url(...)` from existing `@font-face` block.
   - Preserve path before `?`; ignore existing query.
   - Support single quotes, double quotes, and unquoted URL.

   Pseudo-code:
   ```js
   function extractFontFacePath(block) {
     const match = block.match(/url\(\s*(['"]?)([^)'"?]+)(?:\?[^)'"]*)?\1\s*\)/);
     return match ? match[2] : null;
   }
   ```

2. **Make `mergeCssText()` preserve font path, update only hash**
   - During existing block parse, when `parsed.selector === '@font-face'`, read path with `extractFontFacePath(block)`.
   - Do not keep old `@font-face` block.
   - Render one new `@font-face` using existing extracted path or fallback `fontPath`.
   - New cachebuster from current `hash` or existing generator remains fresh.

   Pseudo-code:
   ```js
   let preservedFontPath = null;
   if (parsed.selector === '@font-face') {
     preservedFontPath ||= extractFontFacePath(block);
     sawFontFace = true;
     continue;
   }
   const fontFace = renderFontFace({ fontFamily, fontPath: preservedFontPath || fontPath, hash });
   ```

3. **Sort managed glyph CSS blocks in `mergeCssText()` and group them at bottom when mixed with custom rules**
   - Convert incoming `glyphs` into ordered sanitized names.
   - While scanning existing CSS:
     - If selector is `.prefix-name:before` and content is CSS escape (`'\\e001'` style), treat as generated/synced rule: skip direct output and store updated block by name.
     - If selector is `.prefix-name:before` but content is not CSS escape (`'🤼‍♀️'`, text, alias), keep it in place as custom rule.
     - If glyph exists in incoming set, replace content and store.
     - If glyph no longer exists, drop old generated rule for active prefix.
   - After scanning, build sorted generated blocks by iterating incoming `glyphs`, using updated existing block or `renderGlyphRule()`.
   - Append generated sync group as one block at bottom of file, after all custom rules.
   - Use blank-line separation; avoid new markers unless existing style already has them.

   Pseudo-code:
   ```js
   const glyphByName = new Map(glyphs.map(g => [sanitizeGlyphCssName(g.name), g]));
   const managedBlocks = new Map();

   for (const block of parseCssBlocks(existingCss)) {
     const parsed = splitSelectorAndBody(block);
     const iconName = parsed && extractSingleIconName(parsed.selector, prefix);
     if (iconName && isCssEscapeContent(extractContentValue(parsed.body))) {
       const glyph = glyphByName.get(iconName);
       if (glyph) {
         managedBlocks.set(iconName, replaceContent(block, formatCssEscape(glyph.codepoint || 0xE001)));
       }
       continue;
     }
     output.push(block);
   }

   const sortedGlyphBlocks = glyphs.map(g => {
     const name = sanitizeGlyphCssName(g.name);
     return managedBlocks.get(name) || renderGlyphRule(prefix, name, g);
   });
   output.push('\n', ...sortedGlyphBlocks);
   ```

4. **Keep base rule handling deterministic**
   - Keep existing active-prefix base rule detection unless tests expose need to migrate old prefix base rules.
   - Insert new base rule after `@font-face` if missing for active prefix.
   - Avoid deleting unrelated prefix rules because they may be custom or legacy CSS.

5. **Send CSS Prefix during generation in `public/app.js`**
   - In `handleGenerate()` after appending `fontName` and `glyphMeta`, append current prefix.

   Pseudo-code:
   ```js
   const prefix = cssPrefixInput?.value.trim() || state.cssPrefix || 'icon';
   formData.append('cssPrefix', prefix);
   state.cssPrefix = prefix;
   ```

6. **Update glyph card selectors on CSS Prefix change**
   - In CSS prefix input handler, keep `state.cssPrefix` + `sessionStorage`, invalidate preview, then update visible card selector labels.
   - Prefer targeted DOM text updates for performance; call `renderGlyphList()` only if card DOM lacks stable selector nodes.

   Pseudo-code:
   ```js
   cssPrefixInput.addEventListener('input', () => {
     state.cssPrefix = cssPrefixInput.value.trim() || 'icon';
     sessionStorage.setItem('woff_cssPrefix', state.cssPrefix);
     invalidateCssPreview();
     document.querySelectorAll('.glyph-card').forEach((card) => {
       const index = Number(card.dataset.index);
       const glyph = state.glyphs[index];
       const selector = card.querySelector('.glyph-card__css-selector');
       if (glyph && selector) selector.textContent = `.${state.cssPrefix}-${glyph.name}`;
     });
   });
   ```

7. **Use state fallback when reading prefix**
   - In `fetchGeneratedCss()` and `handleSyncFileFont()`, prefer `cssPrefixInput?.value.trim() || state.cssPrefix || 'icon'`.
   - This avoids null DOM edge cases and keeps state/input consistent.

8. **Add/extend tests**
   - Add unit tests for `mergeCssText()` in `tests/server/generate-css.test.js` or existing sync test file.
   - If `tests/server/sync-file-font.test.js` exists, add integration route test there.

   Required test cases:
   - Existing CSS has `.rvi-b:before` before `.rvi-a:before`; incoming glyphs `[a, b]`; output bottom sync group order is `.rvi-a:before` then `.rvi-b:before`.
   - Existing CSS has generated `.rvi-activity-1:before { content: '\\e001'; }`, custom `.rvi-wrestling-2:before { content: '🤼‍♀️'; }`, generated `.rvi-activity-2:before { content: '\\e002'; }`; output keeps custom emoji rule in place and moves generated sync rules into one sorted bottom group.
   - Existing `@font-face` has `url('~~/public/fonts/RV-Icon.woff?mnj1teui')`; merge with hash `newhash`; output has `url('~~/public/fonts/RV-Icon.woff?newhash')`.
   - `buildCssText()` or `/api/generate-css` with `prefix: 'rvi'` emits `[class^='rvi-']` and `.rvi-name:before`.
   - `/api/generate` with multipart `cssPrefix=rvi` makes latest bundle metadata `cssSelector` use `.rvi-*`.

9. **Manual UI verification after implementation**
   - Start app.
   - Open WOFF file.
   - Change CSS Prefix to `rvi`.
   - Confirm glyph card selectors change from `.icon-*` to `.rvi-*` immediately.
   - Generate and sync to test CSS file containing custom `@font-face` path.
   - Confirm output CSS sorted and path preserved with only query changed.

### Key Files
| File | Operation | Description |
|---|---|---|
| `lib/build-css.js:16-25` | Modify | Preserve existing font URL path during merge while refreshing query suffix |
| `lib/build-css.js:57-225` | Modify | Add helper and make `mergeCssText()` output managed glyph rules in incoming order |
| `public/app.js:1053-1081` | Modify | Include `cssPrefix` in `/api/generate` FormData |
| `public/app.js:1128-1153` | Modify | Read prefix from input/state consistently for CSS preview |
| `public/app.js:968-980` | Modify | Read prefix from input/state consistently for sync payload |
| `public/app.js:1351-1355` | Modify | Update glyph card selector labels after CSS Prefix changes |
| `tests/server/generate-css.test.js` | Modify | Add `mergeCssText()` unit tests; update import |
| `tests/server/sync-file-font.test.js` | Modify if present | Add route-level sync test for existing CSS behavior |

### Risks and Mitigation
| Risk | Mitigation |
|---|---|
| CSS parser drops custom rules that look like generated glyph rules | Only treat blocks as managed when selector matches active prefix and `content` is CSS escape; keep emoji/text aliases in place |
| Prefix change leaves old-prefix generated rules duplicated | First pass preserves non-active-prefix rules to avoid unsafe deletion; add old-prefix migration only with explicit requirement/tests |
| Moving generated rules to bottom changes file layout | Intentional for mixed generated/custom CSS; creates one clear sync-owned group and prevents generated sort from crossing custom blocks |
| Existing custom `@font-face` contains extra descriptors | Current behavior already replaces full block; keep descriptors generated by `renderFontFace()` but preserve URL path |
| Duplicate glyph names after sanitization | Existing behavior uses `Map`, last wins; add no new behavior beyond current naming constraints |
| Prefix input re-render cost for large fonts | Update selector text nodes directly; full `renderGlyphList()` fallback only if needed |
| Cachebuster test flaky with time | Use explicit `hash` argument in unit tests |

### Acceptance Criteria
- Syncing existing CSS produces one bottom generated-icon group ordered by current glyph order, while custom emoji/text icon rules stay in place.
- Existing `@font-face` URL path stays unchanged; only `?hash` suffix changes.
- CSS Prefix set to `rvi` appears in generated CSS selectors, synced CSS payload, latest bundle metadata, and glyph card previews.
- Existing custom emoji/non-escape alias rules remain untouched.
- Tests pass with `node --test` or project test command.
- UI golden path manually verified in browser after implementation.

### SESSION_ID (for /ccg:execute use)
- CODEX_SESSION: 019e6d70-d489-7f51-a25e-063ba9fcb470 (Codex wrapper failed before analysis output; prior failed sessions: 019e6d68-1348-7ca2-a7e6-21b9c78d85c9, 019e6d66-5dc6-72e0-a3ee-42ce775e3d8c)
- ANTIGRAVITY_SESSION: not emitted in output; background task `b9ye3typt` completed successfully
