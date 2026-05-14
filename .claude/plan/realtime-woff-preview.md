## 📋 Implementation Plan: realtime-woff-preview

### Task Type
- [ ] Frontend (→ gemini)
- [ ] Backend (→ codex)
- [x] Full-stack (→ parallel)

### Technical Solution
Turn WOFF preview into event-driven flow.
- Browser UI stays open and connected to Socket.IO server.
- Server owns session registry: channel ↔ browser client(s) ↔ MCP-triggered preview job.
- MCP only triggers preview request and receives parsed payload; it never renders locally.
- Server parses WOFF, stores preview payload, and broadcasts update event to active browser channel.
- Browser updates current workspace state from socket event, preserving filter/scroll/theme.

### Implementation Steps
1. Define session contract on server - one canonical channel per preview workspace.
   - Outcome: browser and MCP talk through same channel id.
   - Pseudo-code:
     ```js
     getOrCreateChannel(channelId) -> { clients, latestPreview, meta }
     ```
2. Add socket event flow for preview updates in `server.js`.
   - Outcome: `parseWoff` result is broadcast to connected browser clients.
   - Pseudo-code:
     ```js
     app.post('/api/socket/parse-woff-preview', upload.single('woff'), async (req, res) => {
       const result = parseWoff(req.file.buffer)
       savePreview(channel, result)
       io.to(channel).emit('preview-ready', { channel, result })
       res.json({ ok: true, result })
     })
     ```
3. Keep MCP as producer only.
   - Outcome: MCP sends preview request with channel id and file path, waits for server response.
   - Pseudo-code:
     ```js
     await callMcp('parse_woff_preview', { channel, filePath })
     ```
4. Update browser socket handling in `public/app.js`.
   - Outcome: active browser tab refreshes glyph list, badge counts, and preview panel live.
   - Pseudo-code:
     ```js
     socket.on('preview-ready', ({ channel, result }) => {
       if (channel !== currentChannel()) return
       state.woffPreviewPayload = result
       state.glyphs = mapPreviewGlyphs(result)
       renderGlyphList()
       renderPreview()
       renderConnectionState()
     })
     ```
5. Clarify UI states in `public/index.html` and `public/app.js`.
   - Outcome: user sees separate connection state for socket/server and MCP trigger state.
   - Pseudo-code:
     ```js
     state.socketConnected
     state.mcpConnected
     state.previewPending
     ```
6. Preserve local interaction state during refresh.
   - Outcome: search, scroll, theme, selected glyph survive preview updates.
   - Pseudo-code:
     ```js
     const snapshot = captureUiState()
     applyPreviewUpdate(result)
     restoreUiState(snapshot)
     ```
7. Add verification path for browser + MCP handshake.
   - Outcome: stable live preview without manual refresh.
   - Tests: socket event receipt, preview broadcast, stale channel ignore, reconnect recovery.

### Key Files
| File | Action | Description |
|------|--------|-------------|
| `server.js:L1-L420` | Modify | Add preview broadcast/session registry and event emission path |
| `public/app.js:L1-L900` | Modify | Handle socket preview events and preserve UI state |
| `public/index.html:L1-L280` | Modify | Surface clearer realtime connection and preview pending states |
| `public/index.css:L1-L1200` | Modify | Add live/sync/pending visual states |
| `server.js` MCP/route handlers | Review | Ensure MCP trigger path targets active browser channel |

### Risks & Mitigations
| Risk | Mitigation Measure |
|------|--------------------|
| Preview event hits wrong browser tab | Require channel id on every preview event and ignore stale payloads |
| Reconnect drops live preview state | Cache latest preview per channel and replay on socket join |
| UI re-render resets user filters | Snapshot/restore local UI state around preview apply |
| MCP and browser drift on channel mapping | Make server registry source of truth and log join/leave transitions |

### SESSION_ID (for /ccg:execute use)
- CODEX_SESSION: 019e2a78-2a13-7472-9a79-753562e3025e
- GEMINI_SESSION: fe4c40c6-e94b-4b05-86df-60c4cea1250f
