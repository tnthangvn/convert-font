# MCP Font Repository — Implementation Plan

**Date:** 2026-04-03
**Status:** Draft

## Goal

When the MCP `woff-tool` process starts, it launches a local web server at `http://localhost:3456`.
The web UI lists all existing fonts in the repository and allows creating/editing fonts with auto-sync.

**Key constraint:** Only `.woff` and `.css` files are stored. No SVGs saved to disk.

---

## Repository Structure

```
data/
└── fonts/
    ├── rong-viet.woff
    ├── icon-rv.css
    ├── my-app-icons.woff
    ├── icon-mai.css
    └── fonts.json          ← registry: maps fonts to CSS files + metadata
```

### `fonts.json` Schema

```json
{
  "fonts": [
    {
      "id": "rong-viet",
      "woffFile": "rong-viet.woff",
      "cssFile": "icon-rv.css",
      "cssPrefix": "rv",
      "codepointStart": "E001",
      "normalization": {
        "width": 28,
        "height": 28,
        "alignH": "center",
        "alignV": "center"
      },
      "createdAt": "2026-04-03T...",
      "updatedAt": "2026-04-03T..."
    }
  ]
}
```

### Naming Convention

| Font name      | WOFF file           | CSS file       | CSS prefix |
| -------------- | ------------------- | -------------- | ---------- |
| `rong-viet`    | `rong-viet.woff`    | `icon-rv.css`  | `rv`       |
| `my-app-icons` | `my-app-icons.woff` | `icon-mai.css` | `mai`      |

CSS file name = `icon-` + initials of font name (first letter of each word).

---

## Architecture

```
mcp-server.mjs (entry point — stdio MCP + HTTP)
  │
  ├── Starts Express server on port 3456
  │     ├── GET  /api/fonts              → list fonts from fonts.json
  │     ├── POST /api/fonts              → create new font entry
  │     ├── GET  /api/fonts/:id          → load font (parse .woff → glyphs)
  │     ├── PUT  /api/fonts/:id          → update metadata (rename, prefix, etc.)
  │     ├── DELETE /api/fonts/:id        → remove font + files
  │     ├── POST /api/fonts/:id/save     → receive glyphs → generate .woff + .css → save
  │     ├── POST /api/fonts/:id/export   → download .woff or .css
  │     ├── Existing: /api/parse-woff, /api/generate, /api/normalize
  │     └── Serves public/ (UI)
  │
  └── MCP layer (stdio)
        ├── Resource: woff-tool://fonts           → font list
        ├── Resource: woff-tool://fonts/{id}/woff  → binary
        ├── Resource: woff-tool://fonts/{id}/css   → CSS text
        └── Tool: create_font, build_font, get_ui_url
```

### Modules

| Module           | File                  | Responsibility                               |
| ---------------- | --------------------- | -------------------------------------------- |
| **MCP runtime**  | `mcp-server.mjs`      | Entry point — starts MCP + Express           |
| **Web server**   | `server.js`           | Express routes, static files                 |
| **Repo adapter** | `lib/repo.js` [NEW]   | Read/write `data/fonts/` + `fonts.json`      |
| **Sync engine**  | (inline in server.js) | On save: generate woff + css → write to disk |
| **Font editor**  | `public/app.js`       | Existing glyph editor + new repo UI          |

---

## Data Flow

### Opening an existing font

```
UI clicks font card
  → GET /api/fonts/:id
  → server reads .woff from data/fonts/
  → parseWoff() extracts glyphs (name, codepoint, pathData)
  → returns glyph list to UI
  → UI enters editor mode (same as current workspace)
```

### Saving (auto-sync)

```
UI edits glyphs (add/remove/rename/reorder/normalize)
  → POST /api/fonts/:id/save { glyphs: [...], fontName, prefix }
  → server generates .woff (generateWoff)
  → server generates .css (buildCssText)
  → writes both to data/fonts/
  → updates fonts.json timestamp
  → returns { status: 'synced', timestamp }
  → UI shows sync indicator
```

### Creating a new font

```
UI clicks "Create New Font"
  → prompts font name (e.g. "rong-viet")
  → POST /api/fonts { name: "rong-viet", prefix: "rv" }
  → server creates entry in fonts.json
  → no .woff/.css files yet (created on first save)
  → UI enters editor mode
```

---

## UI Changes

### New: Font Dashboard (replaces "Get Started")

The start section becomes a **font repository dashboard**:

- **Grid of font cards** — each shows font name, CSS file name, glyph count, last updated
- **"Import .woff"** button → import external .woff into repo
- **"Create New"** button → new empty font

### Modified: Editor Workspace

- **Sync status** in workspace bar: `🟢 Synced` / `🟡 Saving...` / `🔴 Failed`
- After each change, debounced auto-save (800ms) → POST to `/api/fonts/:id/save`
- **Export section** downloads from synced repo files (replaces manual generate)
- Keep existing features: search, drag-reorder, normalize, CSS preview

### Sync Status Indicator States

| State    | Visual                       | Trigger         |
| -------- | ---------------------------- | --------------- |
| `idle`   | Hidden                       | No edits        |
| `saving` | 🟡 pulsing dot + "Saving..." | Change detected |
| `synced` | 🟢 dot + "Synced"            | Save succeeded  |
| `failed` | 🔴 dot + "Failed — retry"    | Save error      |

---

## `lib/repo.js` — Repository Adapter

```js
// Core functions:
listFonts()                     → [{ id, woffFile, cssFile, glyphCount, updatedAt }]
loadFont(id)                    → { metadata, glyphs[] } (parsed from .woff)
createFont(name, opts)          → { id, ... } (adds to fonts.json)
updateFontMeta(id, changes)     → updates fonts.json entry
deleteFont(id)                  → removes files + registry entry
saveBuild(id, woffBuffer, css)  → writes .woff + .css + updates timestamp
getFontPath(id, type)           → absolute path to .woff or .css
```

### Validation Rules

- Font name: `^[a-zA-Z0-9][a-zA-Z0-9_-]*$`, 1-64 chars
- CSS prefix: `^[a-zA-Z][a-zA-Z0-9]*$`, 1-16 chars
- No duplicate font IDs
- Codepoint: `0xE001` – `0xF8FF` (Private Use Area)

### Error Handling

| Scenario                             | Behavior                                                   |
| ------------------------------------ | ---------------------------------------------------------- |
| `fonts.json` missing                 | Auto-create with empty `{ "fonts": [] }`                   |
| `fonts.json` corrupted               | Return error, don't overwrite                              |
| `.woff` file missing for listed font | Return font entry with `glyphCount: 0, status: 'no-build'` |
| Disk write failure                   | Return `{ status: 'failed', error: '...' }`                |
| Duplicate font name                  | Return 409 Conflict                                        |

---

## MCP Integration

### Resources

| URI                           | Description            |
| ----------------------------- | ---------------------- |
| `woff-tool://fonts`           | JSON list of all fonts |
| `woff-tool://fonts/{id}/woff` | WOFF binary (base64)   |
| `woff-tool://fonts/{id}/css`  | CSS text               |
| `woff-tool://ui`              | Returns web UI URL     |

### Tools

| Tool          | Description                     |
| ------------- | ------------------------------- |
| `create_font` | Create a new font entry         |
| `build_font`  | Trigger rebuild of .woff + .css |
| `list_fonts`  | List all fonts with metadata    |

---

## Files Changed

| Action | File                | Description                                                |
| ------ | ------------------- | ---------------------------------------------------------- |
| NEW    | `lib/repo.js`       | Repository adapter (CRUD for fonts.json + files)           |
| MODIFY | `mcp-server.mjs`    | Import & start Express on startup; add new resources/tools |
| MODIFY | `server.js`         | Add `/api/fonts/*` routes; keep existing routes            |
| MODIFY | `public/index.html` | Add font dashboard section, sync indicator                 |
| MODIFY | `public/app.js`     | Font list + auto-sync logic                                |
| MODIFY | `public/index.css`  | Font card styles, sync indicator styles                    |

---

## Verification

1. Start via MCP config → web server starts at `:3456`
2. `pnpm dev` → standalone dev mode still works
3. Create font → entry appears in `data/fonts/fonts.json`
4. Add SVGs → auto-sync → `.woff` + `.css` written to disk
5. Reload page → fonts persist from repository
6. Open existing font → glyphs loaded from `.woff`
7. MCP resources return correct data
8. Delete font → files removed from disk
9. Error scenarios: disk full, corrupted json, missing files
