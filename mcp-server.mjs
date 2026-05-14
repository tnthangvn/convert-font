#!/usr/bin/env node
'use strict';

/**
 * MCP Server for the WOFF Tool.
 *
 * Exposes the latest generated font bundle via MCP resources:
 *   - woff-tool://latest/font.woff   → the WOFF binary (base64)
 *   - woff-tool://latest/metadata    → glyph metadata JSON
 *
 * Transport: stdio (standard MCP transport)
 *
 * Usage:
 *   node mcp-server.js
 *
 * Configuration (Claude Desktop, Cursor, etc.):
 *   {
 *     "mcpServers": {
 *       "woff-tool": {
 *         "command": "npx",
 *         "args": ["-y", "woff-tool"]
 *       }
 *     }
 *   }
 *
 * (Requires the woff-tool package to be installed or accessible via npx)
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readFileSync, existsSync, writeFileSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

const A_BASE_URL = process.env.WOFF_TOOL_URL || 'http://localhost:3456';

function fetchJson(path, options = {}) {
  return fetch(`${A_BASE_URL}${path}`, options);
}

function ensureTmpFile(prefix, content) {
  const file = join(TMP_DIR, `${prefix}-${randomUUID()}.woff`);
  writeFileSync(file, content);
  return file;
}

function cleanup(file) {
  try { unlinkSync(file); } catch {}
}

async function postMultipart(path, filePath, fieldName = 'woffFile') {
  const form = new FormData();
  form.append(fieldName, new Blob([readFileSync(filePath)]), 'upload.woff');
  return fetchJson(path, { method: 'POST', body: form });
}

async function postJson(path, body) {
  return fetchJson(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const LATEST_DIR = join(__dirname, 'data', 'latest');
const TMP_DIR = join(__dirname, 'data', 'tmp');

const server = new McpServer({
  name: 'woff-tool',
  version: '1.0.0',
});

// ── Resource: Latest WOFF binary ──────────────────────────────

server.resource(
  'latest-font',
  'woff-tool://latest/font.woff',
  {
    description: 'The latest generated WOFF font binary (base64-encoded)',
    mimeType: 'font/woff',
  },
  async (uri) => {
    const woffPath = join(LATEST_DIR, 'font.woff');
    if (!existsSync(woffPath)) {
      throw new Error(
        'No generated bundle available. Generate a .woff first using the WOFF Tool UI at http://localhost:3456'
      );
    }

    const woffBuffer = readFileSync(woffPath);
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: 'font/woff',
          blob: woffBuffer.toString('base64'),
        },
      ],
    };
  }
);

// ── Resource: Latest metadata ──────────────────────────────────

server.resource(
  'latest-metadata',
  'woff-tool://latest/metadata',
  {
    description:
      'Glyph metadata JSON for the latest generated font bundle. ' +
      'Includes glyph name, codepoint, unicode hex, CSS selector, CSS content escape, and preview SVG.',
    mimeType: 'application/json',
  },
  async (uri) => {
    const metaPath = join(LATEST_DIR, 'metadata.json');
    if (!existsSync(metaPath)) {
      throw new Error(
        'No generated bundle available. Generate a .woff first using the WOFF Tool UI at http://localhost:3456'
      );
    }

    const metadata = readFileSync(metaPath, 'utf-8');
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json',
          text: metadata,
        },
      ],
    };
  }
);

server.registerTool(
  'get_connection',
  {
    description: 'Get active WOFF Tool service status',
  },
  async ({ channel }) => {
    const res = await fetchJson(`/api/channel/${encodeURIComponent(channel)}/status`);
    return { content: [{ type: 'text', text: await res.text() }] };
  }
);

server.registerTool(
  'join_channel',
  {
    description: 'Join current channel through HTTP-backed MCP control',
  },
  async ({ channel }) => {
    const res = await fetchJson(`/api/channel/${encodeURIComponent(channel)}/status`);
    return { content: [{ type: 'text', text: await res.text() }] };
  }
);

server.registerTool(
  'sync_channel_icons',
  {
    description: 'Mutate channel icons',
  },
  async ({ channel, action, icons, fontName, cssPrefix }) => {
    const res = await postJson(`/api/channel/${encodeURIComponent(channel)}/icons`, {
      action,
      icons,
      fontName,
      cssPrefix,
    });
    return { content: [{ type: 'text', text: await res.text() }] };
  }
);

server.registerTool(
  'get_channel_export',
  {
    description: 'Get current channel export payload',
  },
  async ({ channel }) => {
    const res = await fetchJson(`/api/channel/${encodeURIComponent(channel)}/export`);
    return { content: [{ type: 'text', text: await res.text() }] };
  }
);

server.registerTool(
  'parse_woff_preview',
  {
    description: 'Send WOFF to A for preview parsing',
  },
  async ({ filePath }) => {
    const res = await postMultipart('/api/socket/parse-woff-preview', filePath);
    return { content: [{ type: 'text', text: await res.text() }] };
  }
);

server.registerTool(
  'get_channel_bundle',
  {
    description: 'Get current channel WOFF and CSS payload',
  },
  async ({ channel }) => {
    const res = await fetchJson(`/api/channel/${encodeURIComponent(channel)}/export`);
    return { content: [{ type: 'text', text: await res.text() }] };
  }
);

server.registerTool(
  'sync_from_channel',
  {
    description: 'Sync latest glyph state from a channel',
  },
  async ({ channel, fontName, cssPrefix }) => {
    const res = await postJson('/api/socket/sync-from-channel', {
      channelUrl: `${A_BASE_URL}?channel=${encodeURIComponent(channel)}`,
      fontName,
      cssPrefix,
    });
    return { content: [{ type: 'text', text: await res.text() }] };
  }
);

server.registerTool(
  'get_ui_url',
  {
    description: 'Get WOFF Tool UI URL',
  },
  async () => ({ content: [{ type: 'text', text: A_BASE_URL }] })
);

// ── Start ──────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
