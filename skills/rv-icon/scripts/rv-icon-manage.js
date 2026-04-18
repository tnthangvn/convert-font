#!/usr/bin/env node
'use strict';

/**
 * RV-Icon Management Script
 *
 * Automates adding/updating SVG icons in an icon font by calling
 * the WOFF Tool server APIs directly (no browser automation needed).
 *
 * Usage:
 *   node rv-icon-manage.js add   <svg-path> <woff-path> [css-output-path]
 *   node rv-icon-manage.js update <svg-path> <woff-path> [css-output-path]
 *
 * Arguments:
 *   <svg-path>        — path to the SVG file to add/update
 *   <woff-path>       — path to the existing .woff font file
 *   [css-output-path] — path to write CSS (default: sibling icon.css next to .woff)
 *
 * Environment:
 *   WOFF_TOOL_URL  — base URL of the WOFF Tool server (default: http://localhost:3456)
 */

const fs = require('fs');
const path = require('path');
const { deriveIconName, addPrefix, toKebabCase } = require('./naming');

// ── Configuration ──────────────────────────────────────────

const WOFF_TOOL_URL = process.env.WOFF_TOOL_URL || 'http://localhost:3456';
const CSS_PREFIX = 'rvi';
const CODEPOINT_START = 0xE001;
const NORM_WIDTH = 28;
const NORM_HEIGHT = 28;
const NORM_ALIGN_H = 'center';
const NORM_ALIGN_V = 'center';

// ── Helpers ────────────────────────────────────────────────

function fail(message) {
  // Output to stdout for machine parsing, log to stderr for humans
  console.error(`[rv-icon] ERROR: ${message}`);
  console.log(JSON.stringify({ success: false, error: message }));
  process.exit(1);
}

/**
 * Check if the WOFF Tool server is running.
 */
async function isServerRunning() {
  try {
    const res = await fetch(`${WOFF_TOOL_URL}/api/latest-bundle`, { method: 'GET', signal: AbortSignal.timeout(3000) });
    // Any response (even 404) means server is running
    return true;
  } catch {
    return false;
  }
}

/**
 * Start the WOFF Tool server in the background and wait for it to be ready.
 */
async function ensureServerRunning(workspaceRoot) {
  if (await isServerRunning()) return;

  console.error('[rv-icon] WOFF Tool server not running, starting...');

  const { spawn } = require('child_process');
  const serverPath = path.join(workspaceRoot, 'server.js');

  if (!fs.existsSync(serverPath)) {
    fail(`WOFF Tool server.js not found at ${serverPath}`);
  }

  const child = spawn('node', [serverPath], {
    cwd: workspaceRoot,
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, PORT: '3456' },
  });
  child.unref();

  // Wait for server to be ready (up to 10 seconds)
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 500));
    if (await isServerRunning()) {
      console.error('[rv-icon] WOFF Tool server started successfully');
      return;
    }
  }

  fail('Failed to start WOFF Tool server within 10 seconds');
}

/**
 * Build an SVG string from path data (mirrors app.js buildSvgFromPath).
 */
function buildSvgFromPath(pathData, unitsPerEm = 1000) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${unitsPerEm} ${unitsPerEm}" fill="currentColor"><path d="${pathData}"/></svg>`;
}

/**
 * Parse the existing .woff file via the WOFF Tool API.
 * Returns glyph metadata.
 */
async function parseWoff(woffPath) {
  const woffBuffer = fs.readFileSync(woffPath);

  // Build multipart form data manually (Node 18+ FormData)
  const formData = new FormData();
  const blob = new Blob([woffBuffer], { type: 'font/woff' });
  formData.append('woffFile', blob, 'RV-Icon.woff');

  const res = await fetch(`${WOFF_TOOL_URL}/api/parse-woff`, {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    fail(`Failed to parse existing .woff: ${err.error}`);
  }

  return res.json();
}

/**
 * Normalize an SVG via the WOFF Tool API.
 */
async function normalizeSvg(svgContent) {
  const res = await fetch(`${WOFF_TOOL_URL}/api/normalize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      svgContent,
      targetWidth: NORM_WIDTH,
      targetHeight: NORM_HEIGHT,
      alignH: NORM_ALIGN_H,
      alignV: NORM_ALIGN_V,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    fail(`SVG normalization failed: ${err.error}`);
  }

  const data = await res.json();
  return data.normalizedSvg;
}

/**
 * Generate .woff from glyph metadata via the WOFF Tool API.
 * Returns a Buffer.
 */
async function generateWoff(glyphMeta, fontFamily) {
  const formData = new FormData();
  formData.append('fontName', fontFamily);
  formData.append('glyphMeta', JSON.stringify(glyphMeta));
  formData.append('cssPrefix', CSS_PREFIX);

  const res = await fetch(`${WOFF_TOOL_URL}/api/generate`, {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    fail(`WOFF generation failed: ${err.error}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Generate CSS text via the WOFF Tool API.
 */
async function generateCss(glyphs, fontFamily, fontPath) {
  const res = await fetch(`${WOFF_TOOL_URL}/api/generate-css`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fontFamily,
      prefix: CSS_PREFIX,
      fontPath,
      glyphs: glyphs.map(g => ({
        name: g.name,
        codepoint: g.codepoint,
      })),
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    fail(`CSS generation failed: ${err.error}`);
  }

  return res.text();
}

/**
 * Extract the manually-maintained emoji alias header from existing icon.css.
 * Returns the header text (everything before the first `\e` codepoint rule),
 * or null if no header is found.
 */
function extractEmojiHeader(cssPath) {
  if (!fs.existsSync(cssPath)) return null;

  const cssContent = fs.readFileSync(cssPath, 'utf-8');

  // Find the line that marks the start of generated content.
  // The emoji section uses Unicode emoji characters like ⚽, 🏀, etc.
  // The generated section uses codepoint escapes like \e001.
  // We look for the FIRST rule that has `content: '\\e` pattern.
  const lines = cssContent.split('\n');
  let headerEndIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].match(/content:\s*'\\e[0-9a-fA-F]/)) {
      // Found first generated codepoint rule.
      // Walk backwards to find the start of its selector block.
      let j = i - 1;
      while (j >= 0 && !lines[j].match(/^\.[a-zA-Z]/)) {
        j--;
      }
      headerEndIndex = j;
      break;
    }
  }

  if (headerEndIndex <= 0) return null;

  // Return everything up to (but not including) the first generated rule's selector
  return lines.slice(0, headerEndIndex).join('\n') + '\n';
}

/**
 * Patch the generated CSS to use the custom font path and preserve emoji header.
 */
function patchCss(generatedCss, emojiHeader) {
  if (emojiHeader) {
    // The emoji header already contains @font-face + base rules + emoji aliases.
    // We only need the per-glyph codepoint rules from the generated CSS.
    // These are lines like: .rvi-name:before { content: '\eXXX'; }
    //
    // The generated CSS structure is:
    //   @font-face { ... }\n[class^='rvi-']...{ ... }\n\n.rvi-xxx:before {...}\n
    //
    // We extract everything starting from the first .rvi-* individual rule.
    const glyphRulesMatch = generatedCss.match(/(\n\.[a-zA-Z][\s\S]*)/);
    if (glyphRulesMatch) {
      return emojiHeader + glyphRulesMatch[1].trimStart() + '\n';
    }
    // Fallback: just append generated after header
    return emojiHeader + generatedCss;
  }

  // No emoji header — just replace the font path in the generated CSS
  const patched = generatedCss.replace(
    new RegExp(`url\\('${FONT_PATH.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g'),
    `url('${CSS_FONT_PATH}`
  );

  return patched;
}

// ── Main Pipeline ──────────────────────────────────────────

async function main() {
  const [,, action, svgPath, woffPathArg, cssPathArg] = process.argv;

  // ── Validate args ────────────────────────────────────────

  if (!action || !['add', 'update'].includes(action)) {
    fail('Usage: node rv-icon-manage.js <add|update> <svg-path> <woff-path> [css-output-path]');
  }

  if (!svgPath) {
    fail('SVG file path is required');
  }

  if (!woffPathArg) {
    fail('.woff file path is required');
  }

  // Resolve paths
  const resolvedSvgPath = path.resolve(svgPath);
  const woffPath = path.resolve(woffPathArg);

  // Derive font family from .woff filename (e.g. RV-Icon.woff → RV-Icon)
  const fontFamily = path.basename(woffPath, path.extname(woffPath));

  // CSS output path: explicit arg, or sibling icon.css next to the .woff's parent dir
  const cssPath = cssPathArg
    ? path.resolve(cssPathArg)
    : path.join(path.dirname(path.dirname(woffPath)), 'icon.css');

  // Derive CSS font path for @font-face src (relative from CSS to .woff)
  const cssFontRelPath = path.relative(path.dirname(cssPath), woffPath);

  if (!fs.existsSync(resolvedSvgPath)) {
    fail(`SVG file not found: ${resolvedSvgPath}`);
  }

  if (!resolvedSvgPath.toLowerCase().endsWith('.svg')) {
    fail(`File is not an SVG: ${resolvedSvgPath}`);
  }

  // ── Read and validate SVG ────────────────────────────────

  const svgContent = fs.readFileSync(resolvedSvgPath, 'utf-8');
  if (!svgContent.includes('<svg') && !svgContent.includes('<SVG')) {
    fail(`File is not a valid SVG: ${resolvedSvgPath}`);
  }

  if (!fs.existsSync(woffPath)) {
    fail(`Existing .woff not found: ${woffPath}`);
  }

  // ── Ensure WOFF Tool server is running ───────────────────

  const workspaceRoot = path.dirname(path.dirname(path.dirname(woffPath)));
  await ensureServerRunning(workspaceRoot);

  // ── Parse existing .woff ─────────────────────────────────

  console.error('[rv-icon] Parsing existing .woff...');
  const parsed = await parseWoff(woffPath);
  const unitsPerEm = parsed.unitsPerEm || 1000;

  // Build glyph list with SVG content
  const existingGlyphs = (parsed.glyphs || [])
    .filter(g => g.svgPathData && g.index !== 0)
    .map(g => ({
      name: g.name || `glyph_${g.index}`,
      codepoint: g.unicode || null,
      svgContent: buildSvgFromPath(g.svgPathData, unitsPerEm),
    }));

  const existingNames = new Set(existingGlyphs.map(g => g.name));

  console.error(`[rv-icon] Found ${existingGlyphs.length} existing glyphs`);

  // ── Derive icon name ─────────────────────────────────────

  const baseName = addPrefix(toKebabCase(path.basename(resolvedSvgPath, '.svg')));

  let targetName;
  let targetIndex = -1;

  if (action === 'add') {
    // For add: resolve duplicates
    targetName = deriveIconName(resolvedSvgPath, existingNames);
    console.error(`[rv-icon] Adding icon: ${targetName}`);
  } else {
    // For update: find existing icon
    targetName = baseName;
    targetIndex = existingGlyphs.findIndex(g => g.name === targetName);

    if (targetIndex === -1) {
      fail(`Icon "${targetName}" not found in existing font. Use "add" to create a new icon.`);
    }
    console.error(`[rv-icon] Updating icon: ${targetName} (index ${targetIndex})`);
  }

  // ── Normalize SVG ────────────────────────────────────────

  console.error('[rv-icon] Normalizing SVG (28×28, center)...');
  const normalizedSvg = await normalizeSvg(svgContent);

  // ── Build glyph list ─────────────────────────────────────

  let allGlyphs;

  if (action === 'add') {
    allGlyphs = [
      ...existingGlyphs,
      { name: targetName, codepoint: null, svgContent: normalizedSvg },
    ];
  } else {
    allGlyphs = [...existingGlyphs];
    allGlyphs[targetIndex] = {
      ...allGlyphs[targetIndex],
      svgContent: normalizedSvg,
    };
  }

  // ── Sort by name ─────────────────────────────────────────

  console.error('[rv-icon] Sorting glyphs by name...');
  allGlyphs.sort((a, b) => a.name.localeCompare(b.name));

  // ── Reindex codepoints ───────────────────────────────────

  console.error('[rv-icon] Reindexing codepoints...');
  allGlyphs.forEach((g, i) => {
    g.codepoint = CODEPOINT_START + i;
  });

  // ── Generate .woff ───────────────────────────────────────

  console.error('[rv-icon] Generating .woff...');
  const woffBuffer = await generateWoff(allGlyphs, fontFamily);

  // ── Generate CSS ─────────────────────────────────────────

  console.error('[rv-icon] Generating CSS...');
  const generatedCss = await generateCss(allGlyphs, fontFamily, cssFontRelPath);

  // Extract and preserve emoji header from existing CSS
  const emojiHeader = extractEmojiHeader(cssPath);
  const finalCss = patchCss(generatedCss, emojiHeader);

  // ── Write output files ───────────────────────────────────

  console.error('[rv-icon] Writing output files...');

  fs.writeFileSync(woffPath, woffBuffer);
  console.error(`[rv-icon] ✓ Wrote ${woffPath} (${woffBuffer.length} bytes)`);

  fs.writeFileSync(cssPath, finalCss, 'utf-8');
  console.error(`[rv-icon] ✓ Wrote ${cssPath} (${finalCss.length} bytes)`);

  // ── Find the target glyph's final codepoint ──────────────

  const finalGlyph = allGlyphs.find(g => g.name === targetName);
  const codepoint = finalGlyph ? finalGlyph.codepoint : null;
  const codepointHex = codepoint ? codepoint.toString(16).toLowerCase() : 'unknown';

  // ── Output result report ─────────────────────────────────

  const result = {
    success: true,
    action,
    source: resolvedSvgPath,
    iconName: targetName,
    cssClass: `.${CSS_PREFIX}-${targetName}:before`,
    codepoint: codepointHex,
    totalGlyphs: allGlyphs.length,
    updatedFiles: [
      woffPath,
      cssPath,
    ],
  };

  console.log(JSON.stringify(result, null, 2));
}

main().catch(err => {
  fail(`Unexpected error: ${err.message}`);
});
