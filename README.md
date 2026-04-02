# WOFF Tool

Internal single-page web tool for creating and editing `.woff` font files from SVG glyphs, with icon normalization and MCP export.

## Prerequisites

- Node.js 18+

## Setup

```bash
npm install
npm run dev
```

Open [http://localhost:3456](http://localhost:3456) in your browser.

## Usage

1. **Open .woff** — load an existing `.woff` file to view/extend its glyphs
2. **Create New** — start a blank font set
3. **Add SVGs** — drag & drop or browse for `.svg` files (multiple supported)
4. **Rename glyphs** — click any glyph title to rename it inline
5. **Sort by name** — sort glyphs alphabetically and re-index codepoints
6. **Re-index** — manually reassign codepoints from a custom start value
7. **Normalize icons** — resize and align one or all icons to a fixed target box
8. **Preview CSS** — view the generated CSS on-page before downloading
9. **Generate** — click "Generate .woff" to produce the output
10. **Download** — save the generated `.woff` and `.css` files

### Icon Normalization

The normalization panel appears once you have glyphs loaded. Controls:

| Control | Description |
|---------|-------------|
| **Width** | Target width in pixels (default: 28) |
| **Height** | Target height in pixels (default: 28) |
| **Horizontal** | Alignment: `Left`, `Center`, `Right` |
| **Vertical** | Alignment: `Top`, `Center`, `Bottom` |
| **Normalize All** | Apply the preset to every glyph at once |
| **⊞ button** | Normalize a single glyph (appears on hover) |

- Normalization is **deterministic and repeatable** — re-applying the same settings produces identical output.
- Re-normalizing with different settings does **not compound** transforms. The tool always works from the original source geometry.
- For glyphs loaded from an existing `.woff`, normalization works on the reconstructed SVG path data.

---

## MCP Export

The WOFF Tool includes an MCP (Model Context Protocol) server that exposes the latest generated font bundle. This allows another repository, AI agent, or script to fetch the `.woff` file and glyph metadata programmatically.

### How It Works

1. **Generate a font** in the WOFF Tool UI (click "Generate .woff")
2. The tool persists the bundle to `data/latest/font.woff` and `data/latest/metadata.json`
3. The MCP server reads from this directory — no browser state needed

### Starting the MCP Server

The MCP server uses **stdio transport** (the standard for MCP). You don't run it manually — your MCP client (Claude Desktop, Cursor, Antigravity, etc.) launches it automatically based on the config below.

To test it directly:

```bash
npm run mcp
```

> Note: stdio MCP servers communicate via stdin/stdout, so running directly will show no output. Use an MCP client or the programmatic example below.

### MCP Client Configuration

Add the WOFF Tool MCP server to your client config. Replace `/path/to/convert-font` with the actual absolute path.

#### Claude Desktop

File: `~/Library/Application Support/Claude/claude_desktop_config.json`

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

#### Cursor

File: `.cursor/mcp.json` (in your project root)

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

#### Antigravity (Gemini)

File: `~/.gemini/antigravity/mcp_config.json`

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

#### Codex CLI (OpenAI)

File: `~/.codex/config.toml`

```toml
[mcp_servers.woff-tool]
command = "node"
args = ["/path/to/convert-font/mcp-server.mjs"]
```

### Available MCP Resources

Once connected, two resources are available:

| Resource URI | Type | Description |
|---|---|---|
| `woff-tool://latest/font.woff` | Binary (base64) | The latest generated WOFF font file |
| `woff-tool://latest/metadata` | JSON | Glyph metadata for the latest bundle |

### Metadata Schema

The `woff-tool://latest/metadata` resource returns:

```json
{
  "fontFamily": "MyIcons",
  "generatedAt": "2026-04-02T15:30:00.000Z",
  "glyphs": [
    {
      "name": "arrow-left",
      "codepoint": 57345,
      "unicodeHex": "U+E001",
      "cssSelector": ".icon-arrow-left",
      "cssContentEscape": "\\e001",
      "previewSvg": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 28 28\">...</svg>"
    }
  ]
}
```

Each glyph entry includes:

| Field | Description |
|-------|-------------|
| `name` | Glyph name (sanitized from filename) |
| `codepoint` | Integer codepoint (e.g. `57345`) |
| `unicodeHex` | Unicode hex string (e.g. `U+E001`) |
| `cssSelector` | CSS class selector (e.g. `.icon-arrow-left`) |
| `cssContentEscape` | CSS `content` escape value (e.g. `\e001`) |
| `previewSvg` | Full SVG markup for preview |

### Error Handling

If no font has been generated yet, both resources return an error:

```
"No generated bundle available. Generate a .woff first using the WOFF Tool UI at http://localhost:3456"
```

### Example: Agent Workflow

An AI agent in another repository can:

1. **Read metadata** — `woff-tool://latest/metadata` to get the icon list
2. **Fetch font** — `woff-tool://latest/font.woff` to get the binary
3. **Update code** — use the metadata to generate/update icon enums, CSS files, or component libraries

Example agent prompt:
> "Read the latest icon font metadata from the woff-tool MCP server. Update `src/icons.ts` with any new icons, and copy the latest `font.woff` to `public/fonts/`."

### Example: Programmatic Node.js Client

```javascript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import fs from 'fs';

// 1. Connect
const transport = new StdioClientTransport({
  command: 'node',
  args: ['/path/to/convert-font/mcp-server.mjs'],
});
const client = new Client({ name: 'my-app', version: '1.0.0' });
await client.connect(transport);

// 2. Read glyph metadata
const metaResult = await client.readResource({
  uri: 'woff-tool://latest/metadata',
});
const metadata = JSON.parse(metaResult.contents[0].text);
console.log(`Font: ${metadata.fontFamily}, ${metadata.glyphs.length} glyphs`);

for (const glyph of metadata.glyphs) {
  console.log(`  ${glyph.cssSelector} → ${glyph.unicodeHex}`);
}

// 3. Download the .woff file
const woffResult = await client.readResource({
  uri: 'woff-tool://latest/font.woff',
});
const woffBuffer = Buffer.from(woffResult.contents[0].blob, 'base64');
fs.writeFileSync('public/fonts/icons.woff', woffBuffer);
console.log(`Saved ${woffBuffer.length} bytes`);

// 4. Generate TypeScript enum
const entries = metadata.glyphs
  .map(g => `  ${g.name.replace(/-/g, '_').toUpperCase()} = '${g.cssSelector}'`)
  .join(',\n');
fs.writeFileSync('src/icons.ts', `export enum Icon {\n${entries}\n}\n`);

await client.close();
```

---

## Testing

```bash
npm test
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/parse-woff` | Upload a `.woff` → returns glyph metadata JSON |
| POST | `/api/generate` | Generate `.woff` from glyphs → returns binary |
| POST | `/api/generate-css` | Generate CSS from glyph data → returns CSS text |
| POST | `/api/normalize` | Normalize an SVG to target size/alignment |
| GET | `/api/latest-bundle` | Returns the latest generated metadata JSON |

## Dependencies (all MIT)

| Package | Purpose |
|---------|---------|
| express | HTTP server |
| multer | File upload handling |
| cors | Cross-origin support |
| svgicons2svgfont | SVG icons → SVG font |
| svg2ttf | SVG font → TTF |
| ttf2woff | TTF → WOFF |
| opentype.js | Parse existing .woff files |
| @modelcontextprotocol/sdk | MCP server for font bundle export |
