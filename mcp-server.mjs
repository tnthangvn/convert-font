#!/usr/bin/env node
'use strict';

/**
 * MCP Server for the WOFF Tool.
 *
 * Resources:
 *   - woff-tool://latest/font.woff   → the latest WOFF binary (base64)
 *   - woff-tool://latest/metadata    → glyph metadata JSON
 *
 * Tools:
 *   - list_repo_fonts        → list .woff fonts in the repo (for "which font?")
 *   - convert_svg_to_font    → SVG file/folder → .woff + .css + metadata (HTTP-free)
 *   - sync_font              → add SVG(s) to a repo font, write .woff + .css back
 *   - preview_font           → push a repo font to the open browser tab (needs server)
 *   - get_ui_url             → the WOFF Tool UI URL
 *
 * Transport: stdio.
 *
 * Configuration (.mcp.json / Claude Desktop / Cursor):
 *   { "mcpServers": { "woff-tool": {
 *       "command": "node",
 *       "args": ["/var/www/free-time/convert-font/mcp-server.mjs"] } } }
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname, resolve, basename } from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { addIconsToFont, createFontFromSvgs } = require('./lib/icon-pipeline');
const { discoverFonts } = require('./lib/repo-fonts');

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = __dirname;
const LATEST_DIR = join(__dirname, 'data', 'latest');
const BASE_URL = process.env.WOFF_TOOL_URL || 'http://localhost:3456';

function textResult(payload) {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
  return { content: [{ type: 'text', text }] };
}

/** Resolve a font argument (repo-relative path, absolute path, or family name). */
function resolveFont(fontArg) {
  if (!fontArg) return null;
  const direct = resolve(REPO_ROOT, fontArg);
  if (existsSync(direct) && direct.toLowerCase().endsWith('.woff')) {
    const match = discoverFonts(REPO_ROOT).find((f) => resolve(f.woffPath) === direct);
    return match || { woffPath: direct, family: basename(direct, '.woff'), cssPath: null };
  }
  // Treat as a family name.
  const fonts = discoverFonts(REPO_ROOT);
  return fonts.find((f) => f.family === fontArg || f.relPath === fontArg) || null;
}

const server = new McpServer({ name: 'woff-tool', version: '1.0.0' });

// ── Resources ────────────────────────────────────────────────

server.resource(
  'latest-font',
  'woff-tool://latest/font.woff',
  { description: 'The latest generated WOFF font binary (base64-encoded)', mimeType: 'font/woff' },
  async (uri) => {
    const woffPath = join(LATEST_DIR, 'font.woff');
    if (!existsSync(woffPath)) {
      throw new Error('No generated bundle available yet. Run convert_svg_to_font, sync_font, or preview_font first.');
    }
    return { contents: [{ uri: uri.href, mimeType: 'font/woff', blob: readFileSync(woffPath).toString('base64') }] };
  }
);

server.resource(
  'latest-metadata',
  'woff-tool://latest/metadata',
  { description: 'Glyph metadata JSON for the latest generated font bundle.', mimeType: 'application/json' },
  async (uri) => {
    const metaPath = join(LATEST_DIR, 'metadata.json');
    if (!existsSync(metaPath)) {
      throw new Error('No generated bundle available yet. Run convert_svg_to_font, sync_font, or preview_font first.');
    }
    return { contents: [{ uri: uri.href, mimeType: 'application/json', text: readFileSync(metaPath, 'utf-8') }] };
  }
);

// ── Tools ────────────────────────────────────────────────────

server.registerTool(
  'list_repo_fonts',
  {
    description: 'List the icon fonts (.woff) that exist in the repository, with their paired CSS file. Use this to ask the user which font to preview or sync into.',
    inputSchema: {},
  },
  async () => {
    const fonts = discoverFonts(REPO_ROOT).map((f) => ({
      family: f.family,
      woffPath: f.relPath,
      cssPath: f.cssPath ? f.cssPath.replace(REPO_ROOT + '/', '') : null,
    }));
    return textResult({ count: fonts.length, fonts });
  }
);

server.registerTool(
  'convert_svg_to_font',
  {
    description: 'Convert an SVG file OR a folder of SVGs into a brand-new icon font (.woff + .css + metadata.json). Writes outputs to outDir. Does NOT require the web server.',
    inputSchema: {
      input: z.string().describe('Path to an .svg file or a folder of .svg files'),
      fontName: z.string().optional().describe('Font family name (default: CustomFont)'),
      prefix: z.string().optional().describe('CSS class prefix (default: icon)'),
      outDir: z.string().optional().describe('Output directory (default: data/latest)'),
    },
  },
  async ({ input, fontName = 'CustomFont', prefix = 'icon', outDir }) => {
    const result = await createFontFromSvgs({
      svgPaths: [resolve(REPO_ROOT, input)],
      fontFamily: fontName,
      prefix,
      cssFontPath: `${fontName}.woff`,
    });
    const dir = outDir ? resolve(REPO_ROOT, outDir) : LATEST_DIR;
    mkdirSync(dir, { recursive: true });
    const woffOut = join(dir, `${fontName}.woff`);
    const cssOut = join(dir, `${fontName}.css`);
    const metaOut = join(dir, 'metadata.json');
    writeFileSync(woffOut, result.woffBuffer);
    writeFileSync(cssOut, result.cssText, 'utf-8');
    writeFileSync(metaOut, JSON.stringify(result.metadata, null, 2), 'utf-8');
    return textResult({
      success: true,
      fontFamily: result.family,
      prefix: result.prefix,
      glyphCount: result.glyphs.length,
      added: result.added.map((g) => g.name),
      skipped: result.skipped,
      outputs: { woff: woffOut, css: cssOut, metadata: metaOut },
    });
  }
);

server.registerTool(
  'sync_font',
  {
    description: 'Add SVG icon(s) (a single .svg or a folder) into an EXISTING repo font, sort + reindex, then write the updated .woff and .css back into the repo. Refreshes any open preview tab. Use list_repo_fonts first to pick the font.',
    inputSchema: {
      font: z.string().describe('Repo font: a .woff path or a font family name (from list_repo_fonts)'),
      input: z.string().describe('Path to an .svg file or a folder of .svg files to add'),
      prefix: z.string().optional().describe('CSS class prefix (default: detected from CSS, else rvi)'),
      update: z.boolean().optional().describe('Replace icons of the same name instead of adding new ones'),
    },
  },
  async ({ font, input, prefix, update }) => {
    const target = resolveFont(font);
    if (!target) {
      const available = discoverFonts(REPO_ROOT).map((f) => f.family);
      return textResult({ success: false, error: `Font not found: "${font}". Available: ${available.join(', ') || '(none)'}` });
    }
    const result = await addIconsToFont({
      woffPath: target.woffPath,
      svgPaths: [resolve(REPO_ROOT, input)],
      cssPath: target.cssPath,
      prefix,
      update: !!update,
    });
    writeFileSync(target.woffPath, result.woffBuffer);
    if (result.cssText != null && target.cssPath) {
      writeFileSync(target.cssPath, result.cssText, 'utf-8');
    }
    // Best-effort: refresh the live preview if the server is up.
    let previewed = false;
    try {
      const res = await fetch(`${BASE_URL}/api/preview-font`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: target.woffPath }),
        signal: AbortSignal.timeout(2000),
      });
      previewed = res.ok;
    } catch (_) { /* server not running — fine */ }

    return textResult({
      success: true,
      font: target.family,
      prefix: result.prefix,
      added: result.added.map((g) => g.name),
      skipped: result.skipped,
      totalGlyphs: result.glyphs.length,
      wroteWoff: target.woffPath,
      wroteCss: target.cssPath || null,
      livePreviewRefreshed: previewed,
    });
  }
);

server.registerTool(
  'preview_font',
  {
    description: 'Preview a repo font in the already-open WOFF Tool browser tab (http://localhost:3456). Requires the web server to be running.',
    inputSchema: {
      font: z.string().describe('Repo font: a .woff path or family name (from list_repo_fonts)'),
    },
  },
  async ({ font }) => {
    const target = resolveFont(font);
    if (!target) {
      return textResult({ success: false, error: `Font not found: "${font}". Try list_repo_fonts.` });
    }
    try {
      const res = await fetch(`${BASE_URL}/api/preview-font`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: target.woffPath }),
        signal: AbortSignal.timeout(3000),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return textResult({ success: false, error: body.error || `Preview failed (${res.status})` });
      return textResult({ success: true, ...body, ui: BASE_URL });
    } catch (_) {
      return textResult({
        success: false,
        error: `Could not reach the WOFF Tool server at ${BASE_URL}. Start it with "npm start" and open ${BASE_URL}, then retry.`,
      });
    }
  }
);

server.registerTool(
  'get_ui_url',
  { description: 'Get the WOFF Tool UI URL', inputSchema: {} },
  async () => textResult(BASE_URL)
);

// ── Start ────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
