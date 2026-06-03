'use strict';

/**
 * Discover icon fonts that live inside the repository so an agent / the UI
 * can let the user pick which one to preview or sync into.
 */

const fs = require('fs');
const path = require('path');

// Directories that never contain "repo fonts" we care about.
const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.gitnexus', '.codex', '.gemini', '.config',
  '.ace-tool', '.antigravitycli', '.playwright-mcp', '.code-review-graph',
  'data', 'logs', 'graphify-out',
]);

/**
 * Recursively collect files with a given extension, skipping IGNORE_DIRS.
 */
function walk(dir, ext, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      walk(full, ext, out);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(ext)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Find the CSS file that pairs with a .woff font.
 *
 * Convention (matches the rv-icon skill): the stylesheet usually sits as
 * `icon.css` in the parent of the `fonts/` dir, or next to the font, or named
 * after the font family.
 *
 * @param {string} woffPath
 * @returns {string|null}
 */
function findSiblingCss(woffPath) {
  const fontsDir = path.dirname(woffPath);
  const parentDir = path.dirname(fontsDir);
  const family = path.basename(woffPath, path.extname(woffPath));
  const candidates = [
    path.join(parentDir, 'icon.css'),
    path.join(fontsDir, 'icon.css'),
    path.join(parentDir, `${family}.css`),
    path.join(fontsDir, `${family}.css`),
    path.join(parentDir, 'icons.css'),
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

/**
 * Discover all .woff fonts in the repository.
 *
 * @param {string} root - repository root
 * @returns {Array<{woffPath:string, relPath:string, family:string, cssPath:string|null}>}
 */
function discoverFonts(root) {
  return walk(root, '.woff')
    .map((woffPath) => ({
      woffPath,
      relPath: path.relative(root, woffPath),
      family: path.basename(woffPath, path.extname(woffPath)),
      cssPath: findSiblingCss(woffPath),
    }))
    .sort((a, b) => a.relPath.localeCompare(b.relPath));
}

module.exports = { discoverFonts, findSiblingCss };
