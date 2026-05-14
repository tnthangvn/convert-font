# Context

Need turn repo A into shared WOFF service and MCP host. Repo B connects to A through MCP, opens realtime Socket.IO channel, and drives preview/sync actions from that connection.

Core rules now:
- Every B→A interaction goes through MCP.
- Realtime transport between A and B uses Socket.IO channel join/sync.
- B must reconnect automatically if MCP or Socket.IO disconnects.
- B syncs icon/font changes back to its own repo files using data fetched from current channel state.
- B previews uploaded `.woff` by sending file to A via MCP, A parses it through existing HTTP API, then returns result to B UI.

Current code already has the right base:
- `server.js` has Socket.IO channel state, `join-channel`, `sync-glyphs`, `add-icons`, `request-glyphs`, and HTTP font/generate/parse routes.
- `mcp-server.mjs` exposes latest bundle resources.
- `public/app.js` drives UI actions against existing HTTP endpoints.

# Recommended approach

Keep A as canonical realtime server + font processor. Expand MCP so B can discover/connect/reconnect to the current channel, send files and mutation requests, and receive parsed bundle state for UI preview.

Use one shared channel state in A. B treats MCP as control plane and Socket.IO as realtime data plane.

# Implementation plan

1. Add MCP control layer in `mcp-server.mjs`
   - Add tools/resources for channel discovery, channel join, current connection status, and remote operations.
   - Expose an MCP tool for upload/parse preview flow: B sends `.woff` bytes or path, A stores temp upload, calls existing `POST /api/parse-woff`, returns parsed metadata.
   - Expose MCP tools for `sync icon`, `add icon`, `delete icon`, `request latest woff`, `request latest metadata`.

2. Add Socket.IO-aware channel bootstrap in A
   - Reuse `join-channel`, `sync-glyphs`, `add-icons`, `request-glyphs` in `server.js`.
   - Add a channel status handshake so B can ask “what channel am I on now?” and reconnect to same channel after disconnect.
   - Keep one source of truth for current glyph set in A.

3. Add reconnect behavior
   - On MCP reconnect, B re-asks A for active channel info and rejoins same Socket.IO channel.
   - On Socket.IO disconnect, B reuses MCP control plane to reacquire current channel and resubscribe.
   - On A restart, B reconnects to MCP, fetches latest channel snapshot, then rejoins channel and refreshes preview state.

4. Add sync flows for repo B
   - `sync icon về repo` flow: B asks A for current channel glyph state via MCP, then patches local `.woff` and `icon.css` in B using that snapshot.
   - If B edits icons in UI, B sends mutation through MCP, A updates channel state, then B refreshes local preview from returned state.
   - Prefer full snapshot replace for consistency when syncing back to B files.
   - Sync response from A should return updated `.woff` plus CSS preview only; no extra registry files needed.

5. Add WOFF preview flow
   - B upload `.woff` → MCP forwards file to A → A uses existing `/api/parse-woff` route → A returns parsed glyph metadata → B renders preview.
   - Keep temp upload handling only on A; do not persist SVGs.

6. Keep latest bundle authoritative in A
   - After every mutation, A calls existing `persistLatestBundle()` so MCP resources always reflect latest font bundle.
   - Reuse existing `data/latest/font.woff` and `data/latest/metadata.json` for preview and export.

7. UI changes in B
   - Show connection state: MCP connected/disconnected, Socket.IO joined/rejoined, active channel name.
   - Preview panel should use channel state returned by A.
   - Add/sync/delete actions should show optimistic saving, then refresh from A snapshot.

# Critical files

| File | Action | Description |
|------|------|-------------|
| `mcp-server.mjs` | Modify | Add MCP tools/resources for channel control, preview upload, sync operations, reconnect metadata. |
| `server.js` | Modify | Extend Socket.IO/channel status contract and ensure every mutation updates latest bundle. |
| `lib/socket-sync.js` | Review | Reuse/extend channel parsing and payload normalization for realtime sync contract. |
| `public/app.js` | Modify | Add channel connect/reconnect handling, preview refresh, and sync UI. |
| `data/latest/*` | Preserve | Canonical generated WOFF + metadata for MCP resources. |

# Risks and mitigations

| Risk | Mitigation |
|------|------------|
| B loses state on disconnect | Rehydrate from A channel snapshot on reconnect. |
| MCP and Socket.IO drift | Make A authoritative; every mutation updates one shared channel state. |
| Preview path differs from sync path | Route preview upload through same parse/generate primitives used by current server. |
| Local repo B files get stale | Sync local files from latest channel snapshot after every successful mutation. |

# Verification

1. Start A server.
2. Connect B MCP client to A.
3. Join channel from B, confirm Socket.IO join event.
4. Disconnect B, reconnect, confirm auto-resubscribe to same channel.
5. Upload `.woff` from B, confirm A parses and returns glyph metadata.
6. Add/edit/delete icon in B, confirm A updates preview and latest bundle.
7. Sync back to B repo files and confirm `.woff` plus `icon.css` are patched.
8. Confirm MCP latest WOFF/metadata resources match current channel state.
