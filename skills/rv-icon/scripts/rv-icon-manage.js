#!/usr/bin/env node
'use strict';

/**
 * RV-Icon Management CLI (thin wrapper).
 *
 * Adds/updates SVG icon(s) in an icon font and writes the updated .woff + .css
 * back to disk. The heavy lifting lives in lib/icon-pipeline.js, so this works
 * WITHOUT a running web server.
 *
 * Usage:
 *   node rv-icon-manage.js add    <svg-path|svg-dir> <woff-path> [css-output-path]
 *   node rv-icon-manage.js update <svg-path|svg-dir> <woff-path> [css-output-path]
 *
 * Notes:
 *   - <svg-path> may be a single .svg file OR a folder of .svg files (batch).
 *   - Pipeline: parse -> derive name -> normalize 28x28 -> add/update ->
 *     sort by name -> reindex from 0xE001 -> generate .woff -> merge .css.
 */

const fs = require('fs');
const path = require('path');
const { addIconsToFont } = require('../../../lib/icon-pipeline');

const CSS_PREFIX = 'rvi';

function fail(message) {
  console.error(`[rv-icon] ERROR: ${message}`);
  console.log(JSON.stringify({ success: false, error: message }));
  process.exit(1);
}

async function main() {
  const [, , action, svgPathArg, woffPathArg, cssPathArg] = process.argv;

  if (!action || !['add', 'update'].includes(action)) {
    fail('Usage: node rv-icon-manage.js <add|update> <svg-path|svg-dir> <woff-path> [css-output-path]');
  }
  if (!svgPathArg) fail('SVG file/folder path is required');
  if (!woffPathArg) fail('.woff file path is required');

  const resolvedSvgPath = path.resolve(svgPathArg);
  const woffPath = path.resolve(woffPathArg);

  if (!fs.existsSync(resolvedSvgPath)) fail(`SVG path not found: ${resolvedSvgPath}`);
  if (!fs.existsSync(woffPath)) fail(`Existing .woff not found: ${woffPath}`);

  // CSS output: explicit arg, or sibling icon.css next to the .woff's parent dir.
  const cssPath = cssPathArg
    ? path.resolve(cssPathArg)
    : path.join(path.dirname(path.dirname(woffPath)), 'icon.css');

  let result;
  try {
    result = await addIconsToFont({
      woffPath,
      svgPaths: [resolvedSvgPath],
      cssPath,
      prefix: CSS_PREFIX,
      update: action === 'update',
    });
  } catch (err) {
    fail(err.message);
  }

  fs.writeFileSync(woffPath, result.woffBuffer);
  console.error(`[rv-icon] ✓ Wrote ${woffPath} (${result.woffBuffer.length} bytes)`);
  if (result.cssText != null) {
    fs.writeFileSync(cssPath, result.cssText, 'utf-8');
    console.error(`[rv-icon] ✓ Wrote ${cssPath} (${result.cssText.length} bytes)`);
  }

  const addedNames = result.added.map((g) => g.name);
  const finalGlyphs = result.glyphs.filter((g) => addedNames.includes(g.name));
  const report = {
    success: true,
    action,
    source: resolvedSvgPath,
    prefix: result.prefix,
    addedIcons: finalGlyphs.map((g) => ({
      name: g.name,
      cssClass: `.${result.prefix}-${g.name}:before`,
      codepoint: (g.codepoint || 0).toString(16).toLowerCase(),
    })),
    skipped: result.skipped,
    totalGlyphs: result.glyphs.length,
    updatedFiles: [woffPath, ...(result.cssText != null ? [cssPath] : [])],
  };
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => fail(`Unexpected error: ${err.message}`));
