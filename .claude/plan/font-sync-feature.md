## 📋 Implementation Plan: font-sync-feature

### Task Type
- [x] Frontend
- [x] Backend
- [ ] Full-stack

### Technical Solution
Use current SPA + Express flow. On .woff drop/open, derive `fontName` from uploaded filename stem instead of leaving `undefined`, and sync that value into UI/state before workspace render. Add compact sync block beside `Generate .woff` with editable target path and `sync file font` action. Action should generate current .woff first if needed, verify target path exists, then overwrite target with generated `.woff` bytes and show toast/status for success/failure.

### Requirement Notes
- Default target path example: `~/Desktop/RV-Icon.woff`.
- If user enters path without `.woff`, either reject or normalize with `.woff` suffix; prefer explicit validation.
- Use file name stem from dropped `.woff` only when it is non-empty.
- Keep download flow unchanged.

### Implementation Steps
1. Add path sync UI beside `Generate .woff`.
   - Expected outcome: user can edit target path and trigger sync from same action row.
2. Derive `fontName` from dropped `.woff` filename.
   - Expected outcome: `Font Name` field shows filename stem instead of default placeholder state.
3. Add sync handler in browser app.
   - Pseudo-code:
     ```js
     async function handleSyncFileFont() {
       const targetPath = syncPathInput.value.trim();
       if (!targetPath) return showError('Target path required.');
       if (!state.generatedBlob) await handleGenerate();
       if (!state.generatedBlob) return;
       const res = await fetch('/api/sync-file-font', {
         method: 'POST',
         headers: {'Content-Type': 'application/json'},
         body: JSON.stringify({ targetPath, blob: await blobToBase64(state.generatedBlob) })
       });
       const payload = await res.json();
       if (!res.ok) throw new Error(payload.error || 'Sync failed.');
       showToast('Font synced successfully.');
     }
     ```
   - Expected outcome: one click writes current generated font to target path.
4. Add server endpoint to write generated font to disk.
   - Pseudo-code:
     ```js
     app.post('/api/sync-file-font', express.json({limit:'25mb'}), async (req,res) => {
       const targetPath = expandHome(req.body.targetPath);
       if (!fs.existsSync(targetPath)) return res.status(404).json({error:'Target file not found.'});
       const buffer = Buffer.from(req.body.blob, 'base64');
       fs.writeFileSync(targetPath, buffer);
       return res.json({success:true});
     });
     ```
   - Expected outcome: existing file gets replaced atomically enough for current app.
5. Add toast/status feedback.
   - Expected outcome: user sees success/failure without guessing.
6. Update labels/defaults and keep state consistent after open/create.
   - Expected outcome: no `undefined` font name in UI.

### Key Files
| File | Action | Description |
|------|------|-------------|
| `public/index.html:L93-L107` | Modify | Font name/input and start/workspace controls for sync block placement |
| `public/index.html:L258-L276` | Modify | Add path-sync field and `sync file font` button beside `Generate .woff` |
| `public/app.js:L7-L20` | Modify | State defaults for font name handling |
| `public/app.js:L177-L179` | Modify | Name sanitization helper for filename stem reuse |
| `public/app.js:L879-L933` | Modify | Open `.woff` flow to derive font name from dropped filename |
| `public/app.js:L1009-L1057` | Modify | Generate flow, keep generated blob ready for sync |
| `public/app.js:L1201-L1346` | Modify | Wire sync button, input handling, and toast/status updates |
| `server.js:L487-L624` | Modify | Add sync API endpoint and file write logic |

### Risks & Mitigations
| Risk | Mitigation Measure |
|------|--------------------|
| Path handling around `~` on Linux/macOS | Expand home directory server-side before existence check/write |
| UI has no toast system today | Reuse status/error bar or add small inline toast only in workspace |
| Sync writes stale blob if user edits glyphs after generate | Regenerate before sync or sync from current state only |
| Writing arbitrary paths is dangerous | Only allow explicit user-provided path and require existing target file |

### SESSION_ID (for /ccg:execute use)
- CODEX_SESSION: unavailable
- GEMINI_SESSION: unavailable

### Acceptance Criteria
- Dropped `.woff` file name becomes default `Font Name` value.
- Sync block exists beside `Generate .woff`.
- Clicking `sync file font` overwrites existing target file with generated `.woff`.
- Missing target file shows failure message.
- Success shows positive feedback.
