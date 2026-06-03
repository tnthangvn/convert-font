---
name: rv-icon
description: CLI skill to add or update SVG icon(s) in an existing icon font (.woff). Reads a local SVG file or folder, vectorizes it (shapes flattened, strokes outlined to black fills), normalizes to the 28×28 contain standard, derives an rvi- kebab-case name (resolving duplicates), sorts glyphs by name, reindexes codepoints from 0xE001, and writes the updated .woff + .css back to disk. HTTP-free — no server required. For the MCP-based workflow (convert/sync/preview), see the woff-tool skill.
---

# Icon Font Management Skill (CLI)

> Prefer the **woff-tool** MCP skill for agent-driven convert/sync/preview. This
> skill is the standalone CLI for adding/updating icons in a single `.woff`.

## When to Use

Trigger this skill when the user issues commands like:

- `add icon <path> to <font-name>`
- `update icon <path> in <font-name>`
- `add svg <path> to RV-Icon`
- Any request to add or update icons in an icon font

## Prerequisites

- The WOFF Tool project must be at `/var/www/free-time/convert-font`
- Node.js 22+
- **No server required** — the script runs the pipeline directly from `lib/`

## How It Works

The CLI delegates to `lib/icon-pipeline.js` (`addIconsToFont`) — the same HTTP-free
core used by the MCP server. No browser, no running web server.

The **font file is dynamic** — the user provides the `.woff` path. The font family
name is derived from the filename (e.g. `RV-Icon.woff` → font family `RV-Icon`).
The `<svg-path>` may be a single `.svg` **or a folder** of `.svg` files (batch).

**Pipeline:**
1. Read and validate the SVG file(s)
2. Vectorize — flatten `<rect>/<circle>/…` and outline strokes into black filled paths
3. Derive icon name: filename → kebab-case → `rvi-` prefix → duplicate resolution
4. Normalize to the 28×28 contain standard (centered, aspect-preserved)
5. Add (or replace, in `update` mode) the icon in the glyph list
6. Sort all glyphs alphabetically by name
7. Reindex all codepoints sequentially from `0xE001`
8. Generate the updated `.woff`
9. Path-aware merge of the CSS (`mergeCssText` preserves manual/emoji blocks)
10. Write the `.woff` + `.css` back to disk in place

## Instructions

### Step 1: Determine the Action and Paths

Parse the user's command to identify:
- **Action**: `add` or `update`
- **SVG path**: the path to the SVG file
- **WOFF path**: the path to the existing `.woff` font file (provided by user)
- **CSS path** (optional): where to write the CSS output

If the user doesn't specify a CSS path, it defaults to `icon.css` in the parent
directory of the `.woff` file's folder.

### Step 2: Validate the SVG File

Before running the script, verify the SVG file exists:

```bash
ls -la <svg-path>
```

If the file doesn't exist, inform the user and stop.

### Step 3: Run the Management Script

Execute the orchestration script:

```bash
node /var/www/free-time/convert-font/skills/rv-icon/scripts/rv-icon-manage.js <action> <svg-path> <woff-path> [css-output-path]
```

Where:
- `<action>` is `add` or `update`
- `<svg-path>` is the path to the SVG file
- `<woff-path>` is the path to the existing `.woff` font
- `[css-output-path]` is optional — where to write the CSS

The script outputs a JSON result on stdout and progress logs on stderr.

### Step 4: Report Results

Parse the JSON output and report to the user. The result shape is:

```json
{
  "success": true,
  "action": "add",
  "source": "/abs/path/star.svg",
  "prefix": "rvi",
  "addedIcons": [{ "name": "star", "cssClass": ".rvi-star:before", "codepoint": "e067" }],
  "skipped": [],
  "totalGlyphs": 124,
  "updatedFiles": ["/abs/.../RV-Icon.woff", "/abs/.../icon.css"]
}
```

> Glyph names are stored **without** the prefix (`star`); the prefix is applied
> only in the CSS selector (`.rvi-star`).

**On failure:** `{ "success": false, "error": "<message>" }`

### Step 5: Visual Verification via chrome-devtools MCP

After the script completes, use the **chrome-devtools MCP** to verify the icon
was added/updated correctly in the WOFF Tool UI:

1. **Navigate** to the WOFF Tool:
   ```
   mcp_chrome-devtools_navigate url=http://localhost:3456
   ```

2. **Load the .woff via drag/drop simulation** — use `evaluate` to read the font
   file and simulate a drop on the page. This avoids native file dialogs:
   ```js
   mcp_chrome-devtools_evaluate script=`
     const response = await fetch('/fonts/<font-name>.woff');
     const blob = await response.blob();
     const file = new File([blob], '<font-name>.woff', { type: 'font/woff' });
     const dataTransfer = new DataTransfer();
     dataTransfer.items.add(file);
     const input = document.getElementById('woffInput');
     input.files = dataTransfer.files;
     input.dispatchEvent(new Event('change', { bubbles: true }));
   `
   ```

3. **Wait for parsing** (1–2 seconds), then search for the new icon:
   ```js
   mcp_chrome-devtools_evaluate script=`
     document.getElementById('searchInput').value = '<icon-name>';
     document.getElementById('searchInput').dispatchEvent(new Event('input', { bubbles: true }));
   `
   ```

4. **Take a screenshot** to confirm the icon renders:
   ```
   mcp_chrome-devtools_screenshot
   ```

5. Verify the icon appears in the glyph grid with the correct name and codepoint.

> **Note:** This step requires the `chrome-devtools` MCP server to be configured
> and running. If not available, skip this step — the API-based pipeline already
> produces byte-identical output to the UI flow.

## Error Handling

The script will fail clearly in these situations:

| Error | Cause |
|-------|-------|
| SVG path not found | Invalid SVG file/folder path |
| No SVG files found in the provided input | Empty folder / no `.svg` |
| `.woff` file path is required | Missing woff-path argument |
| Existing `.woff` not found | Provided `.woff` doesn't exist |
| No valid SVG icons to add/update | All inputs were skipped (invalid/unreadable) |

All errors are returned as JSON: `{ "success": false, "error": "..." }`

## Examples

### Add a New Icon

User: `add icon assets/icons/star.svg to RV-Icon (at public/fonts/RV-Icon.woff)`

```bash
node /var/www/free-time/convert-font/skills/rv-icon/scripts/rv-icon-manage.js add assets/icons/star.svg public/fonts/RV-Icon.woff
```

Expected output:
```json
{
  "success": true,
  "action": "add",
  "source": "/absolute/path/assets/icons/star.svg",
  "prefix": "rvi",
  "addedIcons": [{ "name": "star", "cssClass": ".rvi-star:before", "codepoint": "e067" }],
  "skipped": [],
  "totalGlyphs": 124,
  "updatedFiles": [
    "/absolute/path/public/fonts/RV-Icon.woff",
    "/absolute/path/public/icon.css"
  ]
}
```

You can also pass a **folder** instead of a single file to batch-add every `.svg` in it.

### Update an Existing Icon

```bash
node /var/www/free-time/convert-font/skills/rv-icon/scripts/rv-icon-manage.js update assets/icons/user.svg public/fonts/RV-Icon.woff
```

### Custom Font with Custom CSS Path

```bash
node /var/www/free-time/convert-font/skills/rv-icon/scripts/rv-icon-manage.js add star.svg dist/MyFont.woff src/styles/icons.css
```

### Add Duplicate Icon (Auto-Suffix)

If `rvi-user` already exists:

```bash
node /var/www/free-time/convert-font/skills/rv-icon/scripts/rv-icon-manage.js add user.svg public/fonts/RV-Icon.woff
```

Result: icon is named `rvi-user-3` (since `rvi-user`, `rvi-user-1`, `rvi-user-2` already exist).

## Naming Rules

| Input Filename | Derived Name |
|---------------|--------------|
| `user.svg` | `rvi-user` |
| `calendar-grid.svg` | `rvi-calendar-grid` |
| `arrowDown.svg` | `rvi-arrow-down` |
| `arrow_up_right.svg` | `rvi-arrow-up-right` |
| `icon@2x.svg` | `rvi-icon-2x` |

## Files Modified

After each operation, exactly two files are overwritten:

- `<woff-path>` — the font binary (in-place update)
- `<css-path>` — the icon stylesheet (default: `icon.css` sibling to fonts dir)

No other files are modified. Changes are NOT auto-committed.
