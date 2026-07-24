---
name: woff-tool
description: Use this skill to build or edit icon fonts (.woff) from SVGs via the WOFF Tool MCP server. Covers converting an SVG file/folder into a brand-new font, syncing (adding/updating) icons into an existing repo font, and live-previewing a font in the open browser tab. Trigger on requests like "convert these svgs to an icon font", "add icon X to <font>", "sync this folder into RV-Icon", or "preview <font> in the browser".
---

# WOFF Tool — Icon Font Builder (MCP)

The WOFF Tool exposes an MCP server (`woff-tool`) that turns SVGs into icon-font
`.woff` + `.css` + `metadata.json`. The conversion core is **HTTP-free** — `convert`
and `sync` work without the web server running. Only **live preview** needs the
server (it pushes a font to an already-open browser tab).

## The icon standard (default conversion)

Every icon is **vectorized** then **normalized** before it becomes a glyph. When no
size is given, the default standard is:

- **Box = 28×28.** The icon is *contained* inside a 28×28 box, centered.
- **Aspect ratio preserved.** The larger side fills 28; the other is auto/proportional.
  - `width > height` → width = 28, height = auto.
  - `height > width` → height = 28, width = auto.
- **Black fill.** Output paths use `fill="#000"` (canonical reference: `public/file-2.svg`).
- **Vectorized.** `<rect>/<circle>/<ellipse>/<line>/<polyline>/<polygon>` are flattened
  to paths, and **strokes are outlined into filled paths** — so outline/line icons
  (Lucide, Feather, …) render as real glyphs instead of coming out empty.

Override with `size` / `alignH` / `alignV`, or disable vectorization with
`vectorize: false`.

## Tools

| Tool | Needs server? | Purpose |
|------|---------------|---------|
| `list_repo_fonts` | No | List `.woff` fonts in the repo + their CSS. Use to pick the target font. |
| `convert_svg_to_font` | No | SVG file **or folder** → brand-new `.woff` + `.css` + `metadata.json`. |
| `sync_font` | No | Add/update icon(s) into an **existing** font; writes `.woff` back + `.css` **if paired** (check `wroteCss`). |
| `preview_font` | **Yes** | Push a repo font to the open `http://localhost:3456` tab. |

## Workflows

### 1. Convert SVGs → new icon font

For "turn this folder / svg into an icon font":

```
convert_svg_to_font({
  input: "assets/icons",       // .svg file or a folder of .svg
  fontName: "MyIcons",          // default: CustomFont
  prefix: "mi",                 // CSS class prefix, default: icon
  outDir: "dist/fonts"          // default: data/latest
  // size, alignH, alignV, vectorize are optional — omit for the 28×28 standard
})
```

Returns the output paths + a glyph summary (`added`, `skipped`, `glyphCount`).

### 2. Sync icons into an existing font

For "add icon X to <font>" or "sync <folder> into <font>":

1. **Pick the font.** Call `list_repo_fonts`. If there is **more than one** font,
   ask the user which one with `AskUserQuestion`. If there is exactly one, use it.
2. **Sync:**
   ```
   sync_font({
     font: "/abs/path/to/repo/public/fonts/RV-Icon.woff",  // see warning below
     input: "assets/star.svg",  // .svg file or folder
     update: false              // true = replace same-named icons instead of adding
     // size, alignH, alignV, vectorize optional
   })
   ```
   This vectorizes + normalizes the new icon(s), **sorts all glyphs by name**,
   **reindexes codepoints from `0xE001`**, and writes the updated `.woff` — plus the
   `.css` **only if it can locate the paired stylesheet**. If the web server is
   running, open tabs refresh automatically.
3. **Report** `added`, `skipped`, `totalGlyphs`, `wroteWoff`, `wroteCss`.

> ⚠️ **This MCP server is rooted at its own install dir, not the caller's project.**
> When driving a *different* repo (the common case), two things bite:
> - **Pass `font:` as the absolute `.woff` path in the target repo — not a family name.**
>   `list_repo_fonts` enumerates *this server's* fonts (it ships a bundled `RV-Icon`),
>   so `font: "RV-Icon"` syncs into the server's own copy under `~/.npm/_npx/**`, never
>   the caller's file. `list_repo_fonts` is only trustworthy when the server root **is**
>   the project.
> - **`wroteCss` can come back `null`.** `sync_font` writes the `.css` only when it sits
>   at the paired path next to the woff (`<root>/public/icon.css`). A project whose
>   stylesheet lives elsewhere (e.g. `public/assets/icon.css`) gets the new glyphs in the
>   `.woff` but a **stale, now-desynced `.css`** — the reindex moved every codepoint. In
>   that case regenerate the css by glyph **name** (old→name→new remap); see the
>   *Recovering a desynced css* section in the `svg-to-icon-font` skill.

### 3. Live preview a font

For "preview <font> in the browser" (requires `npm start` + an open tab at
`http://localhost:3456`):

```
preview_font({ font: "RV-Icon" })
```

If the server is down the tool returns an actionable error — start it with
`npm start`, open the URL, then retry. `convert` and `sync` do **not** need it.

## Rules

- **Driving another repo? Target it by absolute `.woff` path, not `list_repo_fonts`.**
  `list_repo_fonts`/family names resolve against *this server's* install dir, so they
  only apply when the server root is the project itself. Always verify `wroteWoff` in
  the result points at the intended file.
- **Don't pass `size` unless the user asked for a specific size** — the 28×28
  contain standard is the default and is what produces consistent icons.
- **`sync_font` requires the target `.woff` to already exist.** To create a font
  from scratch, use `convert_svg_to_font`.
- Changes are written to disk but **not committed**. Mention the files touched.

## CLI alternative

For a single icon without MCP, the same HTTP-free pipeline is available via:

```bash
node skills/rv-icon/scripts/rv-icon-manage.js <add|update> <svg-path> <woff-path> [css-path]
```
