---
name: svg-to-icon-font
description: >-
  Turn SVG icons into a portable icon webfont (.woff + .css) for ANY project, and
  route SVG icons — including ones exported from Figma or produced during
  design-to-code — into a project's EXISTING icon font instead of inlining them.
  Trigger whenever the intent is for SVGs to BECOME font glyphs, e.g. "convert
  these svgs to an icon font", "make a webfont from this folder of icons", "turn
  my svg icons into a .woff", "add these icons to our icon font", "sync the Figma
  icons into <font>", "use these icons as a font instead of inline svg", "generate
  icon-font CSS from these svgs", or "build an icon font I can reuse across
  projects". Also trigger when implementing icons in a project that already ships
  an icon font (a .woff + prefixed CSS) and new icons should be added there rather
  than as inline <svg>. DISTINGUISH — do NOT trigger for: rendering a one-off
  inline SVG, logos, illustrations, multicolor or decorative graphics, or any case
  where inline SVG is the intended output. Icon fonts are for monochrome,
  single-glyph icon SETS that font-size/color should control. Method- and
  font-agnostic (any name/prefix, not just RV-Icon); preserves an existing font's
  prefix when extending. For the MCP-only workflow see the woff-tool skill; for
  the single-icon CLI see the rv-icon skill.
triggers:
  [
    'svg to font',
    'svg to icon font',
    'convert svg to font',
    'convert svgs to icon font',
    'icon font',
    'icon webfont',
    'make a webfont',
    'svg to woff',
    'generate icon font',
    'generate icon-font css',
    'add icon to font',
    'add icons to icon font',
    'sync icons into font',
    'icons as a font',
    'use icons as font instead of inline svg',
    'figma icons to font',
    'add figma icons to icon font',
    'extend icon font',
    'build icon font',
  ]
priority: high
version: 1.1.0
---

# SVG → Icon Font

Convert one or many SVGs into a **portable icon webfont**: a `.woff` binary plus a
matching `.css`. Those two files are self-contained — copy them into any project,
fix one `url()` path, and use icons as `<i class="prefix-name">`. The conversion
tooling lives in this repo (the `@tnthangvn/woff-tool` package); the **output is
yours to take anywhere**.

## What you produce

| File | What it is | Goes where |
|------|------------|------------|
| `<Font>.woff` | The font binary (all glyphs) | Anywhere you serve static assets |
| `<Font>.css` | `@font-face` + one class per icon | Linked from your HTML/app |
| `metadata.json` | Glyph names, codepoints, CSS selectors, preview SVG | Tooling/reference (optional) |

The user chooses the **font name** (family) and the **class prefix** — both are
free. `prefix: "mi"` gives classes like `.mi-arrow-left`; `fontName: "MyIcons"`
names the family. Nothing here is tied to RV-Icon.

## The icon standard (what every glyph becomes)

Before an SVG becomes a glyph it is **vectorized** then **normalized**. With no
size given, the default is:

- **28×28 box, contained & centered.** The larger side fills 28; the other scales
  proportionally (aspect ratio preserved).
- **Black fill** (`fill="#000"`). Glyphs are monochrome — color them later in CSS.
- **Vectorized.** `<rect>/<circle>/<ellipse>/<line>/<polyline>/<polygon>` are
  flattened to paths, and **strokes are outlined into filled paths**. This is why
  outline/line sets (Lucide, Feather, Tabler…) come out as real icons instead of
  empty boxes — a font has no notion of "stroke", only filled shapes.

Only override `size`/`alignH`/`alignV` when the user explicitly asks; the 28×28
contain default is what keeps a mixed icon set visually consistent. Disable
flattening with `vectorize: false` only if a set is already all-filled and you
have a reason to.

## Pick a method

Choose based on what's available, not preference. Check in this order:

1. **Is the `woff-tool` MCP server connected?** (look for `convert_svg_to_font` /
   `sync_font` tools) → **Method A (MCP)**. Best for agents — no shell, returns
   structured results, can live-preview.
2. **No MCP, but you can run Node in this repo (or it's installed)?** →
   **Method B (Node CLI / library)**. One command, HTTP-free, fully scriptable.
3. **User wants to do it by hand / drag-and-drop?** → **Method C (browser UI)**.

When unsure and an agent is driving, prefer **A** if the MCP is present, else **B**.

---

## Method A — MCP (`woff-tool`)

HTTP-free for convert/sync; only live preview needs the dev server running.

**New font from a folder or file:**
```
convert_svg_to_font({
  input: "assets/icons",     // an .svg file OR a folder of .svg
  fontName: "MyIcons",        // family + filename stem (default: CustomFont)
  prefix: "mi",               // CSS class prefix (default: icon)
  outDir: "dist/fonts"        // default: data/latest
  // size / alignH / alignV / vectorize are optional — omit for the 28×28 standard
})
```
Writes `dist/fonts/MyIcons.woff` + `.css` + `metadata.json`; returns the paths and
a glyph summary (`added`, `skipped`, `glyphCount`).

**Add/update icons in an existing repo font** — `sync_font`. It requires the target
`.woff` to already exist (create-from-scratch is `convert_svg_to_font`). `sync_font`
sorts glyphs by name and **reindexes every codepoint from `0xE001`**, then writes the
`.woff` and — *when it can locate the paired stylesheet* — the `.css`. For the full
MCP workflow (including `preview_font`), defer to the **woff-tool** skill.

> ⚠️ **The MCP server is rooted at its own package dir, not your repo.** So:
> 1. **Never call `sync_font` with a family name** for a real project — `list_repo_fonts`
>    reports the server's *bundled* fonts (it ships its own `RV-Icon`!), and syncing by
>    name writes into the npm cache (`~/.npm/_npx/**`), not your repo. Always pass
>    `font:` as the **absolute `.woff` path inside the target repo**.
> 2. **Read the result before trusting it.** Confirm `wroteWoff` is your repo path and
>    `wroteCss` is **non-null**. `sync_font` only rewrites the `.css` if it sits at the
>    server's expected paired path (`<root>/public/icon.css` next to the woff). Projects
>    that keep the stylesheet elsewhere (e.g. `public/assets/icon.css`) get
>    **`wroteCss: null`** — the `.woff` gains the new glyphs but the `.css` is left
>    **stale and now desynced** (the reindex shifted every existing codepoint).
> 3. **If `wroteCss` is null → regenerate the css by glyph NAME**, never by codepoint.
>    See "Recovering a desynced css" below. The `.css` is *not* smart-merged in this
>    case; you must remap it yourself.

### Recovering a desynced css (reindex remap)

When `sync_font` reindexed the `.woff` but did **not** rewrite your project's `.css`,
the fix is a **name-based remap**, not appending two lines. The reindex is alphabetical,
so nearly every existing codepoint moved — but glyph **names** are stable. Rebuild the
css by translating each `\eXXXX` through *old-codepoint → name → new-codepoint*, which
preserves all hand-authored aliases and emoji blocks (they carry no `\e` token, so they
pass through untouched), then append the new classes. Needs the pre-sync `.woff`
(`git show HEAD:path` works) and `fonttools`:

```python
import re
from fontTools.ttLib import TTFont
old = TTFont("OLD.woff").getBestCmap()          # cp -> name  (pre-sync, e.g. from git)
new = TTFont("NEW.woff").getBestCmap()          # cp -> name  (post-sync, in repo)
name2new = {n: cp for cp, n in new.items()}
oldcp2name = {cp: n for cp, n in old.items()}
css = open("path/to/icon.css", encoding="utf-8").read()
css = re.sub(r"\\([ef][0-9a-fA-F]{3})",
             lambda m: "\\%x" % name2new[oldcp2name[int(m.group(1), 16)]], css)
# then append the new glyphs' classes, e.g.:
for cls, glyph in [("verified", "verified"), ("no-entry", "no-entry")]:
    css += "\n.%s%s:before {\n  content: '\\%x';\n}\n" % (PREFIX, cls, name2new[glyph])
open("path/to/icon.css", "w", encoding="utf-8").write(css)
```

**Verify before done:** the set of distinct `\e` tokens in the css must equal the woff
glyph count, with zero tokens absent from the woff cmap. This whole hazard disappears if
the project keeps its `.css` at the server's paired path so `sync_font` writes both
atomically — prefer fixing the pairing over remapping when you control the layout.

---

## Method B — Node CLI / library (HTTP-free)

No server, no MCP. Two entry points, depending on whether the font exists yet.

**Create a brand-new font** (this skill bundles the script):
```bash
node skills/svg-to-icon-font/scripts/svg-to-font.js <svg-file-or-folder> [out-dir] \
  [--name MyIcons] [--prefix mi] [--size 28]
```
Example → writes `dist/fonts/MyIcons.woff`, `.css`, `metadata.json` and prints a
JSON summary (`glyphCount`, `added`, `skipped`, file paths). Pass a folder to batch
every `.svg` inside it.

**Add/update an icon in an EXISTING `.woff`** — use `addIconsToFont` (shown in the
next block). Point `cssPath` at the font's stylesheet and **omit `prefix`** so it
**auto-detects and preserves the existing class prefix** — that prefix is the
font's public API and must not change.

> ⚠️ Don't reach for the bundled `rv-icon` CLI to extend an arbitrary font. It
> **hardcodes `prefix = 'rvi'`**, so on a `mi-`/`icon-`/… font it rewrites every
> class to `rvi-` and breaks all existing references. Only use it when the font is
> (or should become) `rvi-` prefixed. For any other font, use `addIconsToFont`
> below or the MCP `sync_font` (Method A) — both keep the prefix intact.

**From your own Node code** (e.g. a build step) — call the library directly:
```js
const { createFontFromSvgs, addIconsToFont } = require('./lib/icon-pipeline');

// New font from a folder:
const { woffBuffer, cssText, metadata } = await createFontFromSvgs({
  svgPaths: 'assets/icons',
  fontFamily: 'MyIcons',
  prefix: 'mi',
});
require('fs').writeFileSync('dist/MyIcons.woff', woffBuffer);
require('fs').writeFileSync('dist/MyIcons.css', cssText);
```
Extend an existing font with `addIconsToFont` — pass `cssPath` and skip `prefix`
so the current prefix is detected and kept:
```js
const { woffBuffer, cssText } = await addIconsToFont({
  woffPath: 'public/fonts/MyIcons.woff',
  svgPaths: 'assets/new-icon.svg',      // file or folder
  cssPath:  'public/fonts/MyIcons.css', // prefix is detected from here
  update: false,                        // true = replace a same-named glyph
});
// write woffBuffer → the .woff, cssText → the .css (in place)
```
Adjust the `require('./lib/icon-pipeline')` path to the repo's `lib/` from wherever
your script lives.

---

## Method C — Browser UI

Run `pnpm dev` (or `npm run dev`) and open `http://localhost:3456`. Then:
**Create New** → **Add SVGs** (drag & drop, multiple ok) → optionally rename
glyphs, **Sort by name**, **Re-index**, **Normalize icons** → **Preview CSS** →
**Generate** → **Download** the `.woff` + `.css`. Good for one-offs and visual
checks; the output is identical to Methods A/B.

---

## Use the font in any project

This is the portable part — it has nothing to do with where you converted. Drop
the two files in, point the CSS at the `.woff`, and reference classes.

1. **Copy** `<Font>.woff` and `<Font>.css` into the target project (e.g.
   `public/fonts/` and `src/styles/`).
2. **Fix the `url()`** in the `@font-face` block so it resolves from where the CSS
   is served — e.g. `src: url('/fonts/MyIcons.woff') format('woff');`. This is the
   single line that's environment-specific.
3. **Load the CSS and use a class** (the prefix you chose):
   ```html
   <link rel="stylesheet" href="/styles/MyIcons.css" />
   <i class="mi-arrow-left"></i>
   <span class="mi-star" style="font-size: 2rem; color: tomato"></span>
   ```
   In React/Vue it's the same class: `<i className="mi-arrow-left" />`.

Because each icon is a font glyph, **`font-size` scales it and `color` paints it** —
no SVG editing, no extra requests per icon. Look up the exact class names in the
generated `.css` (or `metadata.json` → `cssSelector`).

What the generated CSS looks like:
```css
@font-face {
  font-family: 'MyIcons';
  src: url('MyIcons.woff?v=abc123') format('woff');
  font-weight: normal; font-style: normal; font-display: block;
}
[class^='mi-'], [class*=' mi-'] { font-family: 'MyIcons' !important; /* … */ }
.mi-arrow-left:before { content: '\e001'; }
```

## Running conversions from another project

Two different things get confused here — keep them separate:

- **Using a font you already generated** needs *no tooling*: copy the `.woff` +
  `.css` into the other project (above). Nothing else.
- **Converting SVGs from another repo** needs the woff-tool engine. This `SKILL.md`
  is only instructions, and the bundled `svg-to-font.js` depends on `lib/` + its npm
  deps — so copying either file alone into an unrelated project won't convert
  anything. Pick one of:
  - **Register the MCP once (zero files copied).** Add `@tnthangvn/woff-tool` to the
    other project's MCP client via `npx @tnthangvn/woff-tool`. Then **Method A**
    works there with no checkout.
  - **Install the package.** `npm i -D @tnthangvn/woff-tool`, then copy
    `scripts/svg-to-font.js` over — it auto-falls back to the installed package when
    there's no local `lib/`, so **Method B** runs from any project.

## Rules & gotchas

- **Don't pass `size` unless asked.** The 28×28 contain default is deliberate;
  arbitrary sizes break visual consistency across a set.
- **Glyph names are stored without the prefix.** The font holds `arrow-left`; the
  prefix only appears in the CSS selector (`.mi-arrow-left`). So the same glyphs
  work under any prefix.
- **`sync`/add needs the `.woff` to already exist.** Create-from-scratch is
  `convert_svg_to_font` (A) or `svg-to-font.js` (B).
- **Extending a font: keep its prefix.** Use `addIconsToFont` (pass `cssPath`, omit
  `prefix`) or `sync_font` — both detect it. The `rv-icon` CLI forces `rvi-` and
  will rewrite a differently-prefixed font's classes.
- **Sync/add reindexes codepoints from `0xE001` and sorts by name** — codepoints
  aren't stable across syncs, which is fine because the **class names** (not the
  codepoints) are your stable API.
- **Files are written but not committed.** Tell the user exactly which files
  changed so they can review and commit.
- **Empty/clipped glyph?** It was probably a stroke-only icon that wasn't
  flattened — make sure `vectorize` is on (default), then regenerate.
