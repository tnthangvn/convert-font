# WOFF Tool

Create and edit `.woff` icon fonts from SVG glyphs — in the browser, from the
command line, or through an MCP server. Icons are automatically **vectorized**
(shapes flattened, strokes outlined) and **normalized** to a consistent box, then
packed into a `.woff` with matching CSS and metadata.

> Package: [`@tnthangvn/woff-tool`](https://www.npmjs.com/package/@tnthangvn/woff-tool)

## Prerequisites

- Node.js **22+**
- [pnpm](https://pnpm.io) (the repo is pnpm-managed; `npm` also works for running it)

## Setup

```bash
pnpm install
pnpm dev          # or: npm run dev
```

Open [http://localhost:3456](http://localhost:3456).

## The Icon Standard

Whenever an SVG is converted into a glyph it is **vectorized** then **normalized**.
With no size specified, the default standard is:

- **28×28 box.** The icon is *contained* inside a 28×28 box, centered.
- **Aspect ratio preserved** — the larger side fills 28, the other is auto:
  - `width > height` → width = 28, height = auto
  - `height > width` → height = 28, width = auto
- **Black fill** (`fill="#000"`). Canonical reference: [`public/file-2.svg`](public/file-2.svg).
- **Vectorized** — `<rect>`, `<circle>`, `<ellipse>`, `<line>`, `<polyline>`,
  `<polygon>` are flattened to paths, and **strokes are outlined into filled paths**,
  so outline/line icon sets (Lucide, Feather, …) render correctly instead of empty.

Override the box with `size` (or `width`/`height`), placement with `alignH`/`alignV`,
or turn off vectorization with `vectorize: false`.

## Browser Usage

1. **Open .woff** — load an existing `.woff` to view/extend its glyphs
2. **Create New** — start a blank font set
3. **Add SVGs** — drag & drop or browse for `.svg` files (multiple supported)
4. **Rename glyphs** — click a glyph title to rename inline
5. **Sort by name** — alphabetize and re-index codepoints
6. **Re-index** — reassign codepoints from a custom start value
7. **Normalize icons** — resize/align one or all icons to a target box
8. **Preview CSS** — view generated CSS before downloading
9. **Generate** — produce the `.woff`
10. **Download** — save `.woff` + `.css`

### Live Preview (SSE)

The UI subscribes to a Server-Sent Events stream (`/api/preview-stream`). An agent or
the MCP `preview_font` tool can push a font to **every open tab** without drag & drop —
the tab swaps to that font live while preserving your search text, scroll, and theme.
A freshly opened tab auto-loads the active preview, and a "Live" indicator reflects the
connection. (Sockets were intentionally removed; SSE is dependency-free and
auto-reconnecting — server is the source of truth, the browser is a subscriber.)

---

## MCP Server

The WOFF Tool ships an MCP (Model Context Protocol) server so an agent can build and
edit icon fonts programmatically. The conversion core is **HTTP-free** — `convert` and
`sync` work without the web server; only `preview_font` needs it.

### Configuration

Register the server in your MCP client. The repo's `.mcp.json` already contains:

```json
{
  "mcpServers": {
    "woff-tool": {
      "command": "node",
      "args": ["/path/to/convert-font/mcp-server.mjs"]
    }
  }
}
```

Or run the published bin: `npx @tnthangvn/woff-tool`. Same config shape for Claude
Desktop, Cursor (`.cursor/mcp.json`), Antigravity, and Codex (`~/.codex/config.toml`,
`[mcp_servers.woff-tool]`).

### Tools

| Tool | Server? | Description |
|------|:------:|-------------|
| `list_repo_fonts` | No | List `.woff` fonts in the repo + paired CSS (use to pick a font). |
| `convert_svg_to_font` | No | SVG file **or folder** → new `.woff` + `.css` + `metadata.json`. |
| `sync_font` | No | Add/update icon(s) in an existing repo font; writes `.woff` + `.css` back. |
| `preview_font` | **Yes** | Push a repo font to the open browser tab at `http://localhost:3456`. |
| `get_ui_url` | No | Returns the UI URL. |

**Common parameters** (`convert_svg_to_font`, `sync_font`):

| Param | Default | Description |
|-------|---------|-------------|
| `input` | — | `.svg` file or folder of `.svg` |
| `prefix` | `icon` (convert) / detected → `rvi` (sync) | CSS class prefix |
| `size` | `28` | Box size in px; icon contained, larger side fills the box |
| `alignH` / `alignV` | `center` | Alignment within the box |
| `vectorize` | `true` | Flatten shapes & outline strokes to black fills |
| `update` (sync only) | `false` | Replace same-named icons instead of adding |

`sync_font` also **sorts glyphs by name** and **reindexes codepoints from `0xE001`**.

### Resources

| Resource URI | Type | Description |
|---|---|---|
| `woff-tool://latest/font.woff` | Binary (base64) | The latest generated WOFF |
| `woff-tool://latest/metadata` | JSON | Glyph metadata for the latest bundle |

### Metadata Schema

```json
{
  "fontFamily": "MyIcons",
  "generatedAt": "2026-06-03T15:30:00.000Z",
  "glyphs": [
    {
      "name": "arrow-left",
      "codepoint": 57345,
      "unicodeHex": "U+E001",
      "cssSelector": ".icon-arrow-left",
      "cssContent": "\\e001",
      "previewSvg": "<svg ... fill=\"#000\">...</svg>"
    }
  ]
}
```

### Example: Agent Workflow

1. `list_repo_fonts` → see which fonts exist (ask the user if more than one).
2. `sync_font({ font, input })` → add icons; glyphs sorted + reindexed; files written.
3. `preview_font({ font })` → the open tab swaps to the updated font live.

### Example: Programmatic Client

```javascript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({
  command: 'node',
  args: ['/path/to/convert-font/mcp-server.mjs'],
});
const client = new Client({ name: 'my-app', version: '1.0.0' });
await client.connect(transport);

await client.callTool({
  name: 'convert_svg_to_font',
  arguments: { input: 'assets/icons', fontName: 'MyIcons', prefix: 'mi' },
});

const meta = await client.readResource({ uri: 'woff-tool://latest/metadata' });
console.log(JSON.parse(meta.contents[0].text).glyphs.length, 'glyphs');
await client.close();
```

---

## CLI

Add or update a single icon in an existing `.woff` without the browser or MCP.
HTTP-free — no server required.

```bash
node skills/rv-icon/scripts/rv-icon-manage.js <add|update> <svg-path> <woff-path> [css-path]
```

| Argument | Required | Description |
|----------|:--------:|-------------|
| `<action>` | ✅ | `add` or `update` |
| `<svg-path>` | ✅ | Path to the SVG |
| `<woff-path>` | ✅ | Existing `.woff` (family name = filename stem) |
| `[css-path]` | ❌ | CSS output (default: `icon.css` sibling to the fonts dir) |

It vectorizes + normalizes the SVG to the 28×28 standard, derives a kebab-case name
(resolving duplicates), sorts glyphs by name, reindexes from `0xE001`, and writes the
`.woff` + `.css` back in place. Prints a JSON result on stdout.

---

## Agent Skill

`skills/woff-tool/SKILL.md` documents the MCP workflow for AI assistants — converting,
syncing, and previewing icon fonts, plus the icon standard above.

## Library Modules (`lib/`)

The pipeline is split into pure, HTTP-free modules reused by the server, MCP, and CLI:

| Module | Responsibility |
|--------|----------------|
| `parse-woff.js` | Parse a `.woff` → glyph metadata + path data |
| `generate-woff.js` | SVG glyphs → `.woff` (svgicons2svgfont → svg2ttf → ttf2woff) |
| `vectorize-svg.js` | Flatten shapes + outline strokes → black filled paths |
| `normalize-svg.js` | Fit an SVG into a target box with alignment (re-normalization-safe) |
| `naming.js` | `toKebabCase`, `resolveDuplicate` |
| `build-css.js` | Build & path-aware merge of icon CSS (preserves manual blocks) |
| `repo-fonts.js` | Discover `.woff` fonts in the repo + sibling CSS |
| `icon-pipeline.js` | Orchestrates the above: `createFontFromSvgs`, `addIconsToFont` |

## Testing

```bash
npm test          # node --test 'tests/**/*.test.js'
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/parse-woff` | Upload a `.woff` → glyph metadata JSON |
| POST | `/api/generate` | Generate `.woff` from glyphs → binary |
| POST | `/api/generate-css` | Generate CSS from glyph data |
| POST | `/api/normalize` | Normalize an SVG to a target box |
| POST | `/api/sync-file-font` | Add SVG(s) to a font file + merge CSS in place |
| GET | `/api/latest-bundle` | Latest generated metadata JSON |
| GET | `/api/repo-fonts` | List repo `.woff` fonts (+ CSS) |
| GET | `/api/preview-stream` | SSE stream — browser subscribes for live previews |
| POST | `/api/preview-font` | Push a font to open tabs (`{ path }`) |
| GET | `/api/active-preview` | Bootstrap the current preview for a fresh tab |

## Dependencies (all MIT)

| Package | Purpose |
|---------|---------|
| express · cors · multer | HTTP server, CORS, uploads |
| svgicons2svgfont · svg2ttf · ttf2woff | SVG glyphs → SVG font → TTF → WOFF |
| opentype.js | Parse existing `.woff` files |
| svgpath | Path parsing/transform/arc-flattening for vectorization |
| zod | MCP tool input validation |
| @modelcontextprotocol/sdk | MCP server |
