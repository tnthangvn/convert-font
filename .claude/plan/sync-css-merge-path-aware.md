## Implementation Plan: Path-aware CSS Sync Merge

### Task Type
- [ ] Frontend
- [x] Backend
- [ ] Fullstack

### Requirement
When syncing a generated WOFF to a CSS path such as `/var/www/free-time/convert-font/public/icon.css`, update CSS in-place instead of overwriting full file:
- Add required generated `@font-face`, base `[class^='prefix-']` rules, and generated icon rules if missing.
- Skip duplicate generated sections already present.
- Preserve custom emoji/manual rules such as:
  ```css
  .rvi-tennis:before {
    content: '🎾';
  }
  ```
- Update generated font-codepoint icon rules when codepoints changed, e.g. `.rvi-arrow-up:before { content: '\e00b'; }`.
- Remove generated font-codepoint icon rules when glyph no longer exists.
- Keep CSS font URL path relative from CSS file to WOFF target.

### Current Context
| File | Current behavior |
|------|------------------|
| `server.js:465-518` | `POST /api/sync-file-font` writes WOFF, calculates relative font path, calls `buildCssText`, then overwrites entire CSS file. |
| `lib/build-css.js:23-54` | `buildCssText` creates full CSS from scratch: `@font-face`, base class rules, per-glyph `:before` rules. |
| `tests/server/sync-file-font.test.js:66-107` | Tests only new CSS creation and relative path output. |
| `skills/rv-icon/scripts/rv-icon-manage.js:206-264` | Prior CLI has line-based emoji header preservation. Useful reference, but not robust enough for server merge. |

### GitNexus Safety Requirement
Before implementation, run impact analysis because project requires it before editing any symbol:

```js
gitnexus_impact({ target: "buildCssText", direction: "upstream", repo: "convert-font" })
gitnexus_impact({ target: "server.js", direction: "upstream", repo: "convert-font" })
```

If impact returns HIGH or CRITICAL, warn user before editing.

### Technical Solution
Add merge helper in `lib/build-css.js` and update `server.js` route to use it only when CSS file exists.

Preferred behavior:
1. Existing CSS missing: use existing `buildCssText` unchanged.
2. Existing CSS present: call new `mergeCssText`:
   - Parse CSS into top-level rule blocks while preserving raw text.
   - Classify blocks:
     - `@font-face` for target `fontFamily`: update/replace generated font-face path.
     - Base selector block `[class^='prefix-']`, `[class*=' prefix-']`: ensure present/update if generated.
     - Single generated glyph rule `.${prefix}-${name}:before` with `content: '\e...'`: update or remove.
     - Custom/manual glyph rule where content is emoji or non-escape: preserve and mark name as custom so no duplicate generated rule gets appended.
     - Other CSS: preserve exactly.
   - Append missing generated glyph rules for glyphs not processed and not custom.

### Implementation Steps

1. Run required GitNexus impact checks.
   - Expected deliverable: blast radius summary for `buildCssText` and sync route/module.

2. Extend `lib/build-css.js`.
   - Add `sanitizeGlyphCssName(name)` helper so name normalization is shared by `buildCssText` and merge logic.
   - Add `parseCssBlocks(css)` helper using brace-depth tokenizer; track single/double quotes so braces in strings do not break parsing.
   - Add `extractContentValue(blockBody)` helper.
   - Add `isCssEscapeContent(value)` helper: match `^\\[0-9a-fA-F]+$`.
   - Add `extractSingleIconName(selector, prefix)` helper: match exact single selector `.${prefix}-${name}:before`.
   - Export new `mergeCssText`.

3. Refactor `buildCssText` minimally.
   - Replace inline glyph name sanitization with `sanitizeGlyphCssName`.
   - Keep output format stable for existing tests.

4. Implement `mergeCssText({ existingCss, fontFamily, prefix, fontPath, glyphs, hash })`.
   - Build map of generated glyphs by sanitized CSS name.
   - Generate canonical font-face and base blocks using same formatting as `buildCssText`.
   - Parse existing CSS blocks.
   - For each block:
     - Update first relevant `@font-face` block; preserve unrelated `@font-face` when font-family differs if detectable.
     - Update first base class block for prefix.
     - For generated glyph rule with escape content:
       - If glyph exists, replace `content` value with current codepoint escape and preserve selector.
       - If glyph missing, omit block.
     - For custom glyph rule with emoji/non-escape content: preserve raw block and mark name processed.
     - Preserve all unknown blocks.
   - If no font-face/base block found, prepend/add generated ones.
   - Append missing generated glyph rules.
   - Ensure final newline.

5. Update `server.js` imports and route.
   - Change import to:
     ```js
     const { buildCssText, mergeCssText } = require('./lib/build-css');
     ```
   - In `/api/sync-file-font`, when `cssPath` exists:
     ```js
     const cssOptions = {
       fontFamily: fontFamily || 'CustomFont',
       prefix: prefix || 'icon',
       fontPath: relativeFontPath,
       glyphs: glyphs || [],
     };
     const cssText = fs.existsSync(resolvedCssPath)
       ? mergeCssText({ existingCss: fs.readFileSync(resolvedCssPath, 'utf-8'), ...cssOptions })
       : buildCssText(cssOptions);
     fs.writeFileSync(resolvedCssPath, cssText, 'utf-8');
     ```
   - Do not add broad fallback that hides merge bugs unless parser has explicit invalid-brace detection.

6. Add tests.
   - Extend `tests/server/sync-file-font.test.js` or add focused tests for `lib/build-css.js`.
   - Required cases:
     1. New CSS file still created with relative font URL.
     2. Existing emoji custom rule preserved:
        ```css
        .rvi-tennis:before {
          content: '🎾';
        }
        ```
     3. Existing generated rule updated when glyph codepoint changes.
     4. Existing generated rule removed when glyph missing.
     5. Missing generated glyph appended.
     6. Existing generated glyph not duplicated.
     7. Existing CSS with unrelated custom classes/comments preserved.

7. Run verification.
   - `npm test` or project test command from `package.json`.
   - For UI-facing sync behavior, run app and manually test sync if feasible.
   - Before commit, run:
     ```js
     gitnexus_detect_changes({ scope: "all", repo: "convert-font" })
     ```

### Pseudo-code

```js
function sanitizeGlyphCssName(name) {
  return (name || 'glyph').replace(/[^a-zA-Z0-9_-]/g, '-');
}

function parseCssBlocks(css) {
  const blocks = [];
  let start = 0;
  let depth = 0;
  let quote = null;

  for (let i = 0; i < css.length; i += 1) {
    const ch = css[i];
    const prev = css[i - 1];

    if ((ch === "'" || ch === '"') && prev !== '\\') {
      quote = quote === ch ? null : quote || ch;
      continue;
    }
    if (quote) continue;

    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        blocks.push(css.slice(start, i + 1));
        start = i + 1;
      }
    }
  }

  if (start < css.length) blocks.push(css.slice(start));
  return blocks;
}

function mergeCssText(options) {
  const glyphByName = new Map(
    options.glyphs.map(g => [sanitizeGlyphCssName(g.name), g])
  );
  const processed = new Set();
  const output = [];
  let sawFontFace = false;
  let sawBase = false;

  for (const block of parseCssBlocks(options.existingCss)) {
    const parsed = splitSelectorAndBody(block);
    if (!parsed) {
      output.push(block);
      continue;
    }

    if (isTargetFontFace(parsed, options.fontFamily)) {
      output.push(renderFontFace(options));
      sawFontFace = true;
      continue;
    }

    if (isBaseRule(parsed.selector, options.prefix)) {
      output.push(renderBaseRule(options));
      sawBase = true;
      continue;
    }

    const iconName = extractSingleIconName(parsed.selector, options.prefix);
    if (iconName) {
      const content = extractContentValue(parsed.body);
      if (isCssEscapeContent(content)) {
        const glyph = glyphByName.get(iconName);
        if (glyph) {
          output.push(replaceContent(block, formatCssEscape(glyph.codepoint || 0xE001)));
          processed.add(iconName);
        }
        continue;
      }
      output.push(block);
      processed.add(iconName);
      continue;
    }

    output.push(block);
  }

  if (!sawFontFace) output.unshift(renderFontFace(options));
  if (!sawBase) insertBaseAfterFontFaceOrStart(output, renderBaseRule(options));

  for (const [name, glyph] of glyphByName) {
    if (!processed.has(name)) output.push(renderGlyphRule(options.prefix, name, glyph));
  }

  return normalizeFinalNewline(output.join(''));
}
```

### Key Files
| File | Operation | Description |
|------|-----------|-------------|
| `lib/build-css.js:8-57` | Modify | Add merge helpers; export `mergeCssText`; keep `buildCssText` stable. |
| `server.js:9` | Modify | Import `mergeCssText`. |
| `server.js:465-518` | Modify | Use merge when `cssPath` points to existing CSS file; keep relative font path. |
| `tests/server/sync-file-font.test.js:66-126` | Modify/Add tests | Cover preserve/update/remove/append/no-duplicate behavior. |
| Optional `tests/lib/build-css.test.js` | Add | Unit-test pure merge helper without HTTP server. |

### Risks and Mitigation
| Risk | Mitigation |
|------|------------|
| Custom CSS lost | Preserve unknown blocks and non-escape icon rules raw. |
| Generated icon duplicates | Track processed icon names for both generated-updated and custom-preserved rules. |
| Deleted custom emoji removed incorrectly | Only remove exact single icon rules whose `content` is CSS escape `\e...`; emoji/non-escape preserved. |
| Relative font URL wrong | Keep current `path.relative(cssParentDir, resolvedPath).replace(/\\/g, '/')` logic. |
| Parser corrupts malformed CSS | Keep parser conservative; preserve unparsed leftovers; add tests for comments/custom blocks. |

### SESSION_ID (for /ccg:execute use)
- CODEX_SESSION: `019e68dd-bb7b-7441-a2d3-c3848818dccf` (analysis command failed after session creation)
- ANTIGRAVITY_SESSION: not reported by wrapper output
