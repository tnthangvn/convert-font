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
 *         "command": "node",
 *         "args": ["/path/to/convert-font/mcp-server.js"]
 *       }
 *     }
 *   }
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LATEST_DIR = join(__dirname, 'data', 'latest');

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

// ── Start ──────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
