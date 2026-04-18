---
name: rv-icon
description: >
  Use this skill when the user asks to add or update SVG icons in an existing
  icon font (.woff). Automates reading a local SVG, normalizing the icon name
  with rvi- kebab-case prefix, resolving duplicates, importing/updating the icon
  (resized to 28×28 centered), sorting icons by name, reindexing all glyphs,
  exporting the updated .woff, generating CSS, and syncing results back.
---

# Icon Font Management Skill

## When to Use

Trigger this skill when the user issues commands like:

- `add icon <path> to <font-name>`
- `update icon <path> in <font-name>`
- `add svg <path> to RV-Icon`
- Any request to add or update icons in an icon font

## Prerequisites

- The WOFF Tool project must be at `/var/www/free-time/convert-font`
- Node.js 18+ must be available (for native `fetch()`)
- The WOFF Tool server may or may not be running — the script will auto-start it

## How It Works

This skill uses a Node.js CLI script that calls the WOFF Tool server APIs directly
(same APIs the browser UI uses). No browser automation required for the core workflow.

The **font file is dynamic** — the user provides the `.woff` path. The font family
name is derived from the filename (e.g. `RV-Icon.woff` → font family `RV-Icon`).

**Pipeline:**
1. Read and validate SVG from local workspace
2. Derive icon name: filename → kebab-case → `rvi-` prefix → duplicate resolution
3. Parse existing `.woff` via server API
4. Normalize SVG to 28×28 center-center via server API
5. Add/replace the icon in the glyph list
6. Sort all glyphs alphabetically by name
7. Reindex all codepoints sequentially from `E001`
8. Generate updated `.woff` via server API
9. Generate CSS via server API
10. Preserve manually-maintained emoji alias header in CSS (if present)
11. Write output files back to workspace

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

Parse the JSON output and report to the user:

**On success:**
```
✅ Icon successfully <added/updated>!

- Icon name: rvi-<name>
- CSS class: .rvi-<name>:before
- Codepoint: e0XX
- Total glyphs: N
- Updated files:
  - <woff-path>
  - <css-path>
```

**On failure:**
```
❌ Failed to <add/update> icon: <error message>
```

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
| SVG file not found | Invalid SVG path |
| Not a valid SVG | File doesn't contain `<svg>` tag |
| .woff file path is required | Missing woff-path argument |
| Existing .woff not found | Provided .woff doesn't exist |
| Server start failed | Cannot start WOFF Tool server |
| Icon not found (update) | Target icon name doesn't exist in font |
| Parse/normalize/generate failed | Server API returned an error |

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
  "iconName": "rvi-star",
  "cssClass": ".rvi-star:before",
  "codepoint": "e067",
  "totalGlyphs": 124,
  "updatedFiles": [
    "/absolute/path/public/fonts/RV-Icon.woff",
    "/absolute/path/public/icon.css"
  ]
}
```

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
