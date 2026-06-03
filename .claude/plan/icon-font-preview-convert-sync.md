## 📋 Implementation Plan: icon-font-preview-convert-sync

> Multi-model status: **antigravity (frontend) ✅** delivered a full SSE-based UX analysis.
> **codex (backend) ❌** failed 3× (CLI exits status 1 right after `turn_started`, log auto-deleted — an
> environment/auth issue, not the prompt). Backend direction below is Claude-authored from full source review
> and is consistent with antigravity's recommendation and the project memory note
> (*server = source of truth; browser = subscriber; MCP = producer only*).

---

### Task Type
- [x] Full-stack (backend pipeline + Express endpoints + MCP server + SPA frontend)
- [x] **Refactoring** (dead-code removal, de-duplication, module extraction — see **§6 / Phase R**)

---

## 0. Source Review — Current State (verified)

| Area | File | Today |
|------|------|-------|
| HTTP server | `server.js` | Express :3456. APIs: `/api/parse-woff`, `/api/generate` (svgItems **or** glyphMeta → woff), `/api/generate-css`, `/api/sync-file-font` (writes woff + merges CSS path-aware), `/api/normalize`, `/api/latest-bundle`. **Sockets removed** (`io = null`). `persistLatestBundle()` writes `data/latest/{font.woff,metadata.json}`. `parseWoff`/`generateWoff` live **inline** here. |
| CSS engine | `lib/build-css.js` | `buildCssText` + `mergeCssText` (path-aware, merges managed `.prefix-name:before` rules by name, preserves manual/emoji blocks). |
| SVG normalize | `lib/normalize-svg.js` | `normalizeSvg` → 28×28 box, re-normalization-safe via `data-original-viewbox`. |
| Single-icon CLI | `skills/rv-icon/scripts/rv-icon-manage.js` | parse woff → derive `rvi-` kebab name (dedupe) → normalize 28×28 → add/update → sort by name → reindex from `0xE001` → generate → css (preserve emoji header) → write back. **Calls HTTP APIs** (needs server running). Single SVG only. |
| Naming | `skills/rv-icon/scripts/naming.js` | `toKebabCase`, `addPrefix`, `resolveDuplicate`, `deriveIconName`. |
| MCP | `mcp-server.mjs` | **STALE/BROKEN.** Most tools POST to removed `/api/channel/*` & `/api/socket/*`. Only resources `latest-font`, `latest-metadata` + `get_ui_url` work. **No SVG→font tool.** |
| SPA | `public/app.js` | `handleWoffOpen(file)` = manual drop path. `applyPreviewResult(payload)` (leftover socket scaffolding) maps a parse result → `state.glyphs` → `renderGlyphList()`. Dead helpers still call `/api/channel/*` (`fetchChannelStatus`, `refreshChannelState`). |
| Repo fonts | — | `public/fonts/RV-Icon.woff` + `public/icon.css`; scratch `data/latest/font.woff`. |

**Core insight:** the building blocks already exist. The three requirements are mostly *wiring + one batch generalization + reviving the MCP*, not new algorithms. The biggest structural win is **extracting the font pipeline out of `server.js`/`rv-icon-manage.js` into HTTP-free `lib/` modules** so the MCP `convert`/`sync` tools work even when the web server is not running.

---

## 1. Technical Solution (synthesized)

Three requirements map onto one shared core + three thin entrypoints:

```
                         ┌─────────────────────────────────────┐
                         │  lib/  (pure, HTTP-free core)        │
                         │  parse-woff · generate-woff ·        │
                         │  normalize-svg · build-css ·         │
                         │  naming · repo-fonts · icon-pipeline │
                         └───────────────┬─────────────────────┘
            ┌────────────────────────────┼────────────────────────────┐
            ▼                            ▼                             ▼
   server.js (Express :3456)     mcp-server.mjs (stdio)      rv-icon CLI (thin wrapper)
   - REST endpoints              - convert_svg_to_font        - back-compat shim over
   - SSE broadcast               - sync_font                    lib/icon-pipeline
   - active-preview state        - list_repo_fonts
            │                    - preview_font ──┐
            ▼                                     │ (HTTP to running server)
   SPA (public/app.js) ◀── SSE /api/preview-stream┘
   subscriber: applyPreviewResult + state preservation
```

**Decisions (resolved):**

1. **Live preview transport = SSE** (antigravity-recommended; sockets were intentionally removed and SSE is dependency-free, auto-reconnecting, unidirectional server→browser — exactly the producer/subscriber model in the memory note). Polling rejected (network noise, sluggish). URL-param autoload kept as a *secondary* convenience but not primary.
2. **Pipeline is HTTP-free.** Extract `parseWoff` and `generateWoff` from `server.js` into `lib/parse-woff.js` and `lib/generate-woff.js`. The MCP `convert`/`sync` tools call `lib/icon-pipeline` **directly** (no running server required). Only **`preview_font` needs the server** (because it must reach an open browser tab).
3. **"Ask which font" lives in the orchestration layer** (Claude conversation / MCP client), not the server. Server/MCP merely *expose* `list_repo_fonts`; the agent uses `AskUserQuestion` when >1 font.
4. **CSS strategy unified on `mergeCssText`** (path-aware, preserves manual blocks) — supersedes the ad-hoc `extractEmojiHeader`/`patchCss` in the CLI. `mergeCssText` already preserves unmanaged rules, so emoji aliases survive.
5. **Prefix is a parameter** with detection: infer from the target CSS's existing `.<prefix>-` rules, fallback `rvi` (or `icon` for `public/icon.css`). No longer hardcoded.

---

## 2. Implementation Steps

### Phase A — Extract HTTP-free core (foundation, no behavior change)

1. **`lib/parse-woff.js`** — move `parseWoff(buffer)` + `pathCommandsToData` out of `server.js`. Export both. `server.js` imports them (delete the in-file duplicate — note `parseWoff` is currently defined **twice** in server.js, lines ~62 and ~136; collapse to one).
   - *Outcome:* font parsing usable without Express.
2. **`lib/generate-woff.js`** — move `generateWoff(svgItems, fontName, existingWoffBuffer, glyphMeta)` out of `server.js`. Keep the dynamic ESM imports (`svgicons2svgfont`/`svg2ttf`/`ttf2woff`) inside. Export it. `server.js` imports it.
   - *Outcome:* woff generation usable from MCP/CLI directly.
3. **`lib/repo-fonts.js`** — `discoverFonts(repoRoot)`:
   ```js
   // returns [{ woffPath, family, cssPath|null, relPath, glyphCount? }]
   function discoverFonts(root) {
     const files = walk(root, { ext: '.woff',
       ignore: ['node_modules', '.git', 'data/latest', 'data/tmp'] });
     return files.map(woffPath => ({
       woffPath,
       relPath: path.relative(root, woffPath),
       family: path.basename(woffPath, '.woff'),     // RV-Icon.woff → RV-Icon
       cssPath: findSiblingCss(woffPath),             // icon.css in parent-of-fonts dir
     }));
   }
   ```
   - *Outcome:* single source of truth for "which fonts exist in the repo".
4. **`lib/icon-pipeline.js`** — the batch generalization of `rv-icon-manage.js`, HTTP-free:
   ```js
   // addIconsToFont({ woffPath, svgPaths[], cssPath, prefix, normalize=true,
   //                  width=28, height=28, alignH='center', alignV='center',
   //                  startCodepoint=0xE001 })
   //   → { woffBuffer, cssText, glyphs[], added[], skipped[], report }
   async function addIconsToFont(opts) {
     const parsed = parseWoff(fs.readFileSync(opts.woffPath));
     const existing = parsed.glyphs.filter(g => g.svgPathData && g.index !== 0)
       .map(g => ({ name: g.name, svgContent: buildSvgFromPath(g.svgPathData, parsed.unitsPerEm) }));
     const names = new Set(existing.map(g => g.name));
     const prefix = opts.prefix || detectPrefix(opts.cssPath) || 'rvi';

     const added = [];
     for (const svgPath of opts.svgPaths) {                // BATCH: folder or single
       const name = deriveIconName(svgPath, names, { prefix }); // dedupe vs prior + within batch
       names.add(name);
       const norm = normalizeSvg({ svgContent: fs.readFileSync(svgPath,'utf8'),
                                   targetWidth: opts.width, targetHeight: opts.height,
                                   alignH: opts.alignH, alignV: opts.alignV });
       if (norm.error) { skipped.push({ svgPath, error: norm.error }); continue; }
       added.push({ name, svgContent: norm.normalizedSvg });
     }
     let all = [...existing, ...added];
     all.sort((a,b) => a.name.localeCompare(b.name));      // SORT
     all.forEach((g,i) => g.codepoint = opts.startCodepoint + i); // REINDEX

     const woffBuffer = await generateWoff([], family, null, all); // glyphMeta path
     const cssText = fs.existsSync(opts.cssPath)
       ? mergeCssText({ existingCss: fs.readFileSync(opts.cssPath,'utf8'),
                        fontFamily: family, prefix,
                        fontPath: path.relative(path.dirname(opts.cssPath), opts.woffPath),
                        glyphs: all })
       : buildCssText({ fontFamily: family, prefix, fontPath, glyphs: all });
     return { woffBuffer, cssText, glyphs: all, added, skipped };
   }
   ```
   - *Outcome:* one function powers CLI + MCP `sync_font`. Handles **folder of SVGs** (expand dir → `*.svg`) and single file. Sort + reindex per requirement.
5. **Rewire `skills/rv-icon/scripts/rv-icon-manage.js`** to a thin wrapper over `lib/icon-pipeline.addIconsToFont` (drop the HTTP calls + `extractEmojiHeader`/`patchCss`). Keep its CLI signature for back-compat. Update `tests/server/sync-file-font.test.js` expectations if needed.
   - *Outcome:* CLI no longer needs the server running; single code path.

### Phase B — Preview backend (SSE) in `server.js`

6. Add SSE registry + helpers and three endpoints:
   ```js
   let sseClients = [];
   let activePreview = null; // last broadcast parse result (for fresh-tab bootstrap)

   app.get('/api/preview-stream', (req, res) => {           // browser subscribes
     res.set({ 'Content-Type':'text/event-stream', 'Cache-Control':'no-cache', Connection:'keep-alive' });
     res.flushHeaders();
     sseClients.push(res);
     if (activePreview) res.write(`event: preview-ready\ndata: ${JSON.stringify(activePreview)}\n\n`);
     const hb = setInterval(() => res.write(': hb\n\n'), 15000);
     req.on('close', () => { clearInterval(hb); sseClients = sseClients.filter(c => c!==res); });
   });

   function broadcastPreview(result) {
     activePreview = result;
     const msg = `event: preview-ready\ndata: ${JSON.stringify(result)}\n\n`;
     sseClients.forEach(c => c.write(msg));
   }

   app.get('/api/repo-fonts', (req, res) =>                 // discovery for the agent
     res.json({ fonts: discoverFonts(__dirname) }));

   app.post('/api/preview-font', express.json(), (req, res) => { // trigger preview of a repo font
     const woffPath = expandHome(req.body.path);
     if (!fs.existsSync(woffPath)) return res.status(404).json({ error: `Font not found: ${woffPath}` });
     const parsed = parseWoff(fs.readFileSync(woffPath));
     const result = { fontFamily: parsed.fontFamily, unitsPerEm: parsed.unitsPerEm,
                      glyphs: parsed.glyphs, sourcePath: woffPath, generatedAt: nowIso() };
     persistLatestBundle(fs.readFileSync(woffPath), parsed.glyphs, parsed.fontFamily);
     broadcastPreview(result);
     res.json({ success: true, family: parsed.fontFamily, glyphCount: parsed.glyphs.length, clients: sseClients.length });
   });

   app.get('/api/active-preview', (req, res) =>             // fresh-tab bootstrap
     activePreview ? res.json(activePreview) : res.status(404).json({ error: 'none' }));
   ```
   - *Outcome:* agent triggers `POST /api/preview-font {path}` → every open tab updates live; new tabs bootstrap via `/api/active-preview` or the replay on stream-connect.

### Phase C — Preview frontend in `public/app.js` / `index.html` / `index.css`

7. **Connect SSE on load + bootstrap fresh tab** (reuse existing `applyPreviewResult`):
   ```js
   function connectPreviewStream() {
     const es = new EventSource('/api/preview-stream');
     es.addEventListener('preview-ready', e => handleIncomingPreview(JSON.parse(e.data)));
     es.onopen  = () => updateLiveIndicator('connected');
     es.onerror = () => updateLiveIndicator('reconnecting'); // EventSource auto-retries
   }
   async function bootstrapActivePreview() {
     const r = await fetch('/api/active-preview'); if (r.ok) handleIncomingPreview(await r.json());
   }
   ```
8. **`handleIncomingPreview` with state preservation** (search/scroll/theme survive swap):
   ```js
   function handleIncomingPreview(result) {
     const scrollY = window.scrollY, q = searchInput?.value || '';
     applyPreviewResult(result);                 // already maps glyphs + renders
     if (state.mode !== 'workspace') goToWorkspace(result.fontFamily, []);
     if (q && searchInput) { searchInput.value = q; renderGlyphList(); }
     requestAnimationFrame(() => window.scrollTo({ top: scrollY }));
     setSyncStatus(`Previewing ${result.fontFamily}`);
   }
   ```
9. **Add live indicator** to header (`index.html`) + pulse styles (`index.css`), reusing existing CSS vars (`--success`/`--warning`). Small dot + "Live" label.
10. **Cleanup dead scaffolding**: remove/neutralize `fetchChannelStatus`, `refreshChannelState`, `currentChannel` calls to `/api/channel/*` so the console isn't throwing 404s. (Low-risk deletion — endpoints don't exist.)

### Phase D — Revive the MCP server (`mcp-server.mjs`)

11. **Delete dead tools** (`get_connection`, `join_channel`, `sync_channel_icons`, `get_channel_export`, `parse_woff_preview`, `get_channel_bundle`, `sync_from_channel`). Keep resources `latest-font`, `latest-metadata`, and `get_ui_url`.
12. **Add tools** (zod-validated; `convert`/`sync` call `lib/` directly, HTTP-free):
    - `list_repo_fonts()` → `discoverFonts(repoRoot)` — feeds the agent's "which font?" question.
    - `convert_svg_to_font({ input, fontName='CustomFont', prefix='icon', outDir })` — `input` = svg file or dir; expand → `generateWoff`/`icon-pipeline` from scratch → write `<outDir>/<fontName>.woff` + `.css` + `metadata.json`; return paths + glyph summary. **No server needed.**
    - `sync_font({ font, input, prefix? })` — `font` = repo path or family name (resolved via `discoverFonts`); `input` = svg file/dir → `addIconsToFont` → **write woff+css back into repo**; if server reachable, `POST /api/preview-font` to refresh open tabs; return report (added/skipped/total/codepoints).
    - `preview_font({ path })` — `POST /api/preview-font` to the running server (the one tool that requires it); clear error if server down: *"Start the WOFF Tool server (npm start) and open http://localhost:3456".*
13. **Register the MCP** in `.mcp.json` (currently only `open-design`):
    ```json
    "woff-tool": { "command": "node", "args": ["/var/www/free-time/convert-font/mcp-server.mjs"] }
    ```

### Phase E — Tests & verification

14. Unit-test the new lib modules:
    - `tests/lib/repo-fonts.test.js` — discovery ignores `node_modules`/`data`, resolves sibling CSS.
    - `tests/lib/icon-pipeline.test.js` — batch add from a temp dir → sorted names, sequential codepoints from `0xE001`, dedupe, skipped-invalid, CSS merge preserves manual block.
    - `tests/server/preview-font.test.js` — `/api/preview-font` 404 on missing, 200 + broadcast on valid; `/api/active-preview` replay.
15. Keep `node --test 'tests/**/*.test.js'` green (existing `normalize-svg`, `generate-css`, `sync-file-font` tests). Manual: start server, open tab, run `preview_font` → tab swaps without losing search/scroll.

### Phase R — Refactoring & dead-code removal (interleaved, each step independently safe)

> The socket/channel feature was deleted server-side but its client/MCP halves remain, throwing 404s and
> shipping a latent crash. This phase removes **unused code** and **duplication**. Several items overlap the
> feature work above (lib extraction, MCP rewrite) — do them as one pass, not twice.

16. **`server.js` — collapse the duplicate `parseWoff`.** It is defined **twice** (lines ~62 and ~136, identical). Keep one (move to `lib/parse-woff.js` per Phase A) and delete the other. Verify no behavioral diff.
17. **`server.js` — simplify `generateWoff` dead guards.** `if (allSvgItems.length === 0)` is checked **3×** (lines ~230, ~252, plus the post-validation check). Collapse to a single guard after building `validSvgItems`. Remove the unreachable duplicate at ~252.
18. **`public/app.js` — delete the orphaned channel/socket layer** (all call removed `/api/channel/*`·`/api/socket/*`, now dead):
    - Functions: `setConnectionState`, `currentChannel`, `renderConnectionState`, `refreshChannelState` (**defined twice**, ~102 and ~361), `fetchChannelStatus`, `replayLatestPreviewIfAny`, `handleChannelError`, `syncCurrentChannel`, and the `handleChannel*`/`setPreviewPending`/`shouldAcceptPreview` job-id machinery (~349–437).
    - State fields: `activeChannel`, `channelId`, `channelMeta`, `lastChannelSyncAt`, `channelStateCache`, `pendingPreviewJob`, `latestPreviewJob`, `previewPending`.
    - **Call sites to strip** (fire-and-forget into the void today): `void syncCurrentChannel('delete'|'update'|'add', …)` in the glyph delete/update/add handlers (~725, ~758, ~1045) and the init block `if (currentChannel()) fetchChannelStatus(...)` (~1269–1270).
    - **Keep & repurpose** `applyPreviewResult` (it becomes the SSE swap target — Phase C). Strip only its `jobId`/`shouldAcceptPreview` branches.
    - *Outcome:* SPA stops emitting 404s; ~150+ dead lines gone from the 1449-line file.
19. **`skills/rv-icon/scripts/rv-icon-manage.js` — remove the buggy/dead CSS path.** `patchCss` (no-emoji-header branch) references **undefined constants** `FONT_PATH` and `CSS_FONT_PATH` → `ReferenceError` whenever a target CSS has no emoji header. Delete `extractEmojiHeader` + `patchCss` entirely; `lib/build-css.mergeCssText` (Phase A) already preserves manual blocks, removing the need. Also delete the now-unused local `buildSvgFromPath`/`normalizeSvg`/`generateWoff`/`generateCss`/`parseWoff` HTTP wrappers once the file delegates to `lib/icon-pipeline`.
20. **`mcp-server.mjs` — remove unused helpers** left after dropping channel tools: `ensureTmpFile`, `cleanup`, `postMultipart`, `TMP_DIR`, and `postJson`/`fetchJson` if no remaining tool uses them. (Done as part of Phase D rewrite.)
21. **De-duplicate `buildSvgFromPath`.** It exists in both `public/app.js` and `rv-icon-manage.js` (client can't share Node lib, so keep the client copy; server/CLI/MCP use the one in `lib/parse-woff.js` or `lib/icon-pipeline.js`). Document the single server-side source.
22. **Dead-asset removal (confirmed orphaned via grep).** `lib/socket-sync.js` + `tests/lib/socket-sync.test.js` — **nothing imports `socket-sync`** except its own test → delete both. `data/tmp`/`TMP_DIR` is referenced **only** by the dead `ensureTmpFile` helper in `mcp-server.mjs` → removed with step 20.
23. **Verification after removals:** `node --test 'tests/**/*.test.js'` green; `node -e "require('./server.js')"` loads; grep proves **zero** remaining references to `/api/channel`, `/api/socket`, `syncCurrentChannel`, `FONT_PATH`. Optionally `git diff --stat` to confirm net line reduction.

---

## 3. Key Files

| File | Action | Description |
|------|--------|-------------|
| `lib/parse-woff.js` | **Create** | Extract `parseWoff` + `pathCommandsToData` from `server.js` (dedupe the double definition). |
| `lib/generate-woff.js` | **Create** | Extract `generateWoff` (svgicons2svgfont→svg2ttf→ttf2woff) from `server.js`. |
| `lib/repo-fonts.js` | **Create** | `discoverFonts(root)` — scan repo `.woff`, resolve sibling CSS. |
| `lib/icon-pipeline.js` | **Create** | `addIconsToFont(...)` — batch add → sort → reindex → woff+css; HTTP-free core. |
| `server.js:62-95,136-169` | Modify | Replace inline `parseWoff` (defined twice) with import. |
| `server.js:175-293` | Modify | Replace inline `generateWoff` with import. |
| `server.js` (routes) | Modify | Add `/api/preview-stream`, `/api/repo-fonts`, `/api/preview-font`, `/api/active-preview` + SSE registry/broadcast. |
| `public/app.js:88-156` | Modify | Remove dead `/api/channel/*` scaffolding; add SSE connect + bootstrap + `handleIncomingPreview`. |
| `public/app.js:119-147` | Reuse | `applyPreviewResult` is the swap target — wrap with state preservation. |
| `public/index.html` (header) | Modify | Add live-preview indicator widget. |
| `public/index.css` | Modify | Pulse/`--success`/`--warning` indicator styles; optional new-glyph flash. |
| `mcp-server.mjs` | Rewrite | Drop dead channel tools; add `list_repo_fonts`, `convert_svg_to_font`, `sync_font`, `preview_font`. |
| `.mcp.json` | Modify | Register `woff-tool` MCP server. |
| `skills/rv-icon/scripts/rv-icon-manage.js` | Modify | Thin wrapper over `lib/icon-pipeline`; drop HTTP + `extractEmojiHeader`/`patchCss`. |
| `tests/lib/*`, `tests/server/preview-font.test.js` | Create | Cover discovery, batch pipeline, preview endpoint. |
| `server.js:62/136` | **Delete** | Remove the duplicate `parseWoff` (defined twice). |
| `server.js:230-254` | **Simplify** | Collapse the 3× `allSvgItems.length === 0` guards. |
| `public/app.js:88-156, 349-437` | **Delete** | Orphaned channel/socket layer + duplicate `refreshChannelState`. |
| `public/app.js:725,758,1045,1269` | **Delete** | `syncCurrentChannel`/`fetchChannelStatus` call sites into dead endpoints. |
| `skills/rv-icon/scripts/rv-icon-manage.js:206-265` | **Delete** | `extractEmojiHeader` + buggy `patchCss` (undefined `FONT_PATH`/`CSS_FONT_PATH`). |
| `mcp-server.mjs:42-68` | **Delete** | `ensureTmpFile`, `cleanup`, `TMP_DIR` + unused `postMultipart`/`postJson` helpers. |
| `lib/socket-sync.js` + `tests/lib/socket-sync.test.js` | **Delete** | Confirmed orphaned (no importers). |

---

## 4. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Extracting `parseWoff`/`generateWoff` breaks existing routes | Pure move + import; run full `node --test` suite; `server.js` already has a **duplicate** `parseWoff` — collapsing it is net-safer. |
| `convert`/`sync` writing to arbitrary paths from MCP | Restrict writes to repo-relative paths / explicit user-provided paths; require the target `.woff` to already exist for `sync` (matches `sync-file-font` safety). |
| Batch dedupe collisions (two `star.svg` in a folder) | `deriveIconName` already auto-suffixes; pass the growing `names` set across the batch. |
| SSE connection through proxies buffering | Set `Cache-Control: no-cache`, `X-Accel-Buffering: no`; 15s heartbeat comments. |
| Font swap resets user's filter/scroll | Snapshot search + `scrollY`, restore after `applyPreviewResult` (Phase C step 8). |
| CSS prefix mismatch (`rvi` vs `icon`) overwrites wrong rules | Detect prefix from existing CSS; `mergeCssText` only touches `.<prefix>-name:before` managed blocks, preserves the rest. |
| MCP `preview_font` when server is down | Detect + return actionable message; `convert`/`sync` stay fully functional without the server. |
| `data/latest` getting picked up as a "repo font" | Explicit ignore list in `discoverFonts`. |
| Deleting `app.js` channel code breaks glyph add/update/delete | Those handlers only *call* `syncCurrentChannel` fire-and-forget; remove the call line, keep the handler body. Test add/sort/reindex/generate in the UI after. |
| Removing `socket-sync.js`/its test breaks `npm test` glob | Delete the test file in the same commit; grep confirms no other importer. |
| Refactor mixed with feature work obscures review | Land **Phase R as its own commit(s)** before/after feature commits; each step is independently green. |

---

## 6. Refactoring Scorecard — "remove unused code" (loại bỏ code không dùng)

| # | Target | Type | Evidence | Lines saved (≈) |
|---|--------|------|----------|-----------------|
| 1 | `server.js` duplicate `parseWoff` | Dead/dup | Defined at L62 **and** L136, identical | ~35 |
| 2 | `server.js` triple `allSvgItems.length===0` guard | Dead | L230, L252 unreachable + post-check | ~8 |
| 3 | `public/app.js` channel/socket layer | Dead | ~15 fns hitting removed `/api/channel`·`/api/socket`; `refreshChannelState` defined 2× | ~150 |
| 4 | `rv-icon-manage.js` `extractEmojiHeader`+`patchCss` | Dead + **bug** | `patchCss` uses undefined `FONT_PATH`/`CSS_FONT_PATH` → `ReferenceError` | ~60 |
| 5 | `rv-icon-manage.js` HTTP wrapper fns | Superseded | Replaced by `lib/icon-pipeline` (Phase A) | ~120 |
| 6 | `mcp-server.mjs` dead tools + helpers | Dead | 7 tools → removed endpoints; `ensureTmpFile`/`cleanup`/`TMP_DIR` unused | ~90 |
| 7 | `lib/socket-sync.js` + its test | Orphaned | grep: zero importers outside its own test | ~110 |

**Net effect:** ~580 fewer lines, one latent `ReferenceError` removed, zero dead network calls, and a single shared pipeline instead of three divergent copies of normalize→sort→reindex→generate.

**Guardrail (no over-deletion):** before deleting any symbol, `grep -rn <symbol> --include='*.js' --include='*.mjs'` to confirm no live caller; keep client-side `buildSvgFromPath` (the browser can't import Node `lib/`). Land Phase R as isolated commits so `git revert` is trivial if a hidden caller surfaces.

---

## 5. Acceptance Criteria

- **Preview:** Agent lists repo fonts; on choosing one, an already-open `http://localhost:3456` tab swaps to that font live (no drag/drop), preserving search text, scroll, and theme. A freshly opened tab auto-loads the active preview. A visible "Live" indicator reflects SSE connection.
- **MCP convert:** `convert_svg_to_font` turns an SVG file **or folder** into `.woff` + `.css` + `metadata.json` **without the web server running**, returning the output paths and a glyph summary.
- **Sync:** "sync font <folder|svg>" → agent asks which repo font (only when >1) → icons added → glyphs **sorted by name** → codepoints **reindexed from `0xE001`** → updated `.woff` and `.css` written **back into the repo**; open tabs refresh if the server is running.
- **No regressions:** `node --test 'tests/**/*.test.js'` passes; dead `/api/channel/*` calls removed from the SPA.

### SESSION_ID (for /ccg:execute use)
- CODEX_SESSION: unavailable (codex CLI failed 3×; last session id `019e8729-880f-7803-a6a4-f1b991a08650` did not produce output)
- ANTIGRAVITY_SESSION: see task `br6w3c3eo` (analysis completed; new session — frontend draft not separately persisted)
