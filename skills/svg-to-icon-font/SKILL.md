---
name: svg-to-icon-font
description: >-
  End-to-end guide for turning SVG icons into a portable icon webfont (.woff +
  .css) that drops into ANY project. Use this whenever the user wants to convert
  SVGs into an icon font — phrases like "convert these svgs to an icon font",
  "make a webfont from this folder of icons", "turn my svg icons into a .woff",
  "build an icon font I can use across my projects", "generate icon-font CSS from
  these svgs", or "I have a bunch of svg icons, how do I use them as a font". This
  skill picks the right conversion method (MCP, Node CLI/library, or browser UI),
  runs it, and shows how to consume the generated font in any HTML/React/Vue app.
  It is method-agnostic and font-agnostic — works for any font name and prefix,
  not just RV-Icon. For the MCP-only workflow see the woff-tool skill; for
  adding/updating a single icon in an existing font see the rv-icon skill.
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

**Add/update icons in an existing repo font** — `sync_font`. Always
`list_repo_fonts` first; if more than one font exists, ask which with
`AskUserQuestion`; if exactly one, use it. `sync_font` sorts glyphs by name and
reindexes codepoints from `0xE001`, then writes `.woff` + `.css` back. The `.css` is
**path-aware merged**, not overwritten — any manual/hand-authored CSS blocks you
added (e.g. emoji aliases) are preserved; only the managed glyph rules are updated.
It requires the target `.woff` to already exist — to create from scratch use
`convert_svg_to_font`. For the full MCP workflow (including `preview_font`), defer
to the **woff-tool** skill.

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
