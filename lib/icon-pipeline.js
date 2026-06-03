'use strict';

/**
 * Icon-font pipeline (HTTP-free core).
 *
 * Generalizes the single-icon rv-icon CLI to batch input (a folder of SVGs or
 * one SVG) and a configurable prefix. Powers the CLI, the MCP `sync_font` /
 * `convert_svg_to_font` tools, and any server-side use.
 *
 * Steps: parse → derive names (dedupe) → normalize 28×28 → merge →
 *        sort by name → reindex codepoints from 0xE001 → generate woff → css.
 */

const fs = require('fs');
const path = require('path');

const { parseWoff } = require('./parse-woff');
const { generateWoff } = require('./generate-woff');
const { normalizeSvg } = require('./normalize-svg');
const { vectorizeSvg } = require('./vectorize-svg');
const { buildCssText, mergeCssText } = require('./build-css');
const { toKebabCase, resolveDuplicate } = require('./naming');

const DEFAULTS = {
  width: 28,
  height: 28,
  alignH: 'center',
  alignV: 'center',
  startCodepoint: 0xE001,
  vectorize: true,
};

/** Build an SVG string from a glyph path `d` (server-side canonical copy). */
function buildSvgFromPath(pathData, unitsPerEm = 1000) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${unitsPerEm} ${unitsPerEm}" fill="#000"><path d="${pathData}"/></svg>`;
}

/**
 * Expand a list of file/dir paths into a flat, sorted list of .svg files.
 * @param {string|string[]} inputs
 * @returns {string[]}
 */
function expandSvgInputs(inputs) {
  const list = Array.isArray(inputs) ? inputs : [inputs];
  const out = [];
  for (const input of list) {
    if (!input) continue;
    const resolved = path.resolve(input);
    let stat;
    try { stat = fs.statSync(resolved); } catch (_) { continue; }
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(resolved).sort()) {
        if (name.toLowerCase().endsWith('.svg')) out.push(path.join(resolved, name));
      }
    } else if (resolved.toLowerCase().endsWith('.svg')) {
      out.push(resolved);
    }
  }
  return out;
}

/**
 * Detect the CSS class prefix used by an existing stylesheet.
 * @param {string|null} cssPath
 * @returns {string|null}
 */
function detectPrefix(cssPath) {
  if (!cssPath || !fs.existsSync(cssPath)) return null;
  const css = fs.readFileSync(cssPath, 'utf8');
  const baseRule = css.match(/\[class\^=['"]([a-zA-Z][a-zA-Z0-9_-]*)-['"]\]/);
  if (baseRule) return baseRule[1];
  const glyphRule = css.match(/\n\.([a-zA-Z][a-zA-Z0-9_]*)-[a-zA-Z0-9_-]+\s*:\s*:?before/);
  return glyphRule ? glyphRule[1] : null;
}

/**
 * Read + normalize a batch of SVG files into glyph items.
 * @returns {{added:Array<{name,svgContent}>, skipped:Array<{svgPath,error}>}}
 */
function processSvgs(svgPaths, names, opts) {
  const added = [];
  const skipped = [];
  for (const svgPath of svgPaths) {
    let raw;
    try {
      raw = fs.readFileSync(svgPath, 'utf8');
    } catch (_) {
      skipped.push({ svgPath, error: 'unreadable' });
      continue;
    }
    if (!raw.includes('<svg') && !raw.includes('<SVG')) {
      skipped.push({ svgPath, error: 'not a valid SVG' });
      continue;
    }
    // Glyph names are stored WITHOUT the CSS prefix (e.g. "arrow-down"); the
    // prefix (".rvi-arrow-down") is applied only when rendering CSS.
    const base = toKebabCase(path.basename(svgPath, path.extname(svgPath))) || 'glyph';
    const name = opts.update ? base : resolveDuplicate(base, names);
    // Vectorize first: flatten shapes + outline strokes into black filled paths
    // so primitive-shape and outline icons render as real glyphs. Falls back to
    // the raw SVG if vectorization finds nothing usable.
    let source = raw;
    if (opts.vectorize !== false) {
      const vec = vectorizeSvg(raw);
      if (vec.vectorized) source = vec.vectorized;
    }
    const norm = normalizeSvg({
      svgContent: source,
      targetWidth: opts.width,
      targetHeight: opts.height,
      alignH: opts.alignH,
      alignV: opts.alignV,
    });
    if (norm.error) {
      skipped.push({ svgPath, error: norm.error });
      continue;
    }
    names.add(name);
    added.push({ name, svgContent: norm.normalizedSvg });
  }
  return { added, skipped };
}

/** Sort glyphs by name, then reindex codepoints sequentially. */
function sortAndReindex(glyphs, startCodepoint) {
  glyphs.sort((a, b) => a.name.localeCompare(b.name));
  glyphs.forEach((g, i) => { g.codepoint = startCodepoint + i; });
  return glyphs;
}

/**
 * Add icon(s) to an EXISTING font and produce updated woff + css.
 *
 * @param {object} opts
 * @param {string}        opts.woffPath
 * @param {string|string[]} opts.svgPaths  - file(s) and/or folder(s)
 * @param {string|null}   [opts.cssPath]
 * @param {string|null}   [opts.prefix]    - defaults: detected from css → 'rvi'
 * @param {string|null}   [opts.fontFamily]- defaults: woff filename stem
 * @returns {Promise<{family,prefix,woffBuffer,cssText,glyphs,added,skipped}>}
 */
async function addIconsToFont(opts) {
  const o = { ...DEFAULTS, ...opts };
  if (!o.woffPath || !fs.existsSync(o.woffPath)) {
    throw new Error(`Existing .woff not found: ${o.woffPath}`);
  }
  const family = o.fontFamily || path.basename(o.woffPath, path.extname(o.woffPath));
  const prefix = o.prefix || detectPrefix(o.cssPath) || 'rvi';

  const parsed = parseWoff(fs.readFileSync(o.woffPath));
  const unitsPerEm = parsed.unitsPerEm || 1000;
  const existing = (parsed.glyphs || [])
    .filter((g) => g.svgPathData && g.index !== 0)
    .map((g) => ({
      name: g.name || `glyph_${g.index}`,
      svgContent: buildSvgFromPath(g.svgPathData, unitsPerEm),
    }));
  const names = new Set(existing.map((g) => g.name));

  const svgPaths = expandSvgInputs(o.svgPaths);
  if (svgPaths.length === 0) {
    throw new Error('No SVG files found in the provided input.');
  }
  const { added, skipped } = processSvgs(svgPaths, names, { ...o, prefix, update: !!o.update });
  if (added.length === 0) {
    throw new Error(`No valid SVG icons to ${o.update ? 'update' : 'add'} (skipped ${skipped.length}).`);
  }

  // Merge: in update mode replace an existing glyph of the same name; otherwise append.
  const byName = new Map(existing.map((g) => [g.name, g]));
  for (const item of added) {
    if (o.update && byName.has(item.name)) byName.get(item.name).svgContent = item.svgContent;
    else byName.set(item.name, { name: item.name, svgContent: item.svgContent });
  }
  const all = sortAndReindex([...byName.values()], o.startCodepoint);
  const woffBuffer = await generateWoff([], family, null, all);
  const cssText = renderCss(all, { cssPath: o.cssPath, woffPath: o.woffPath, family, prefix });

  return { family, prefix, woffBuffer, cssText, glyphs: all, added, skipped };
}

/**
 * Create a NEW font from a batch of SVGs (no existing woff). Used by the MCP
 * `convert_svg_to_font` tool.
 *
 * @param {object} opts
 * @param {string|string[]} opts.svgPaths
 * @param {string} [opts.fontFamily='CustomFont']
 * @param {string} [opts.prefix='icon']
 * @param {string} [opts.cssFontPath] - the url() path written into the CSS
 * @returns {Promise<{family,prefix,woffBuffer,cssText,metadata,glyphs,added,skipped}>}
 */
async function createFontFromSvgs(opts) {
  const o = { ...DEFAULTS, fontFamily: 'CustomFont', prefix: 'icon', ...opts };
  const family = o.fontFamily;
  const prefix = o.prefix;

  const svgPaths = expandSvgInputs(o.svgPaths);
  if (svgPaths.length === 0) {
    throw new Error('No SVG files found in the provided input.');
  }
  const names = new Set();
  const { added, skipped } = processSvgs(svgPaths, names, { ...o, prefix });
  if (added.length === 0) {
    throw new Error(`No valid SVG icons to convert (skipped ${skipped.length}).`);
  }

  const all = sortAndReindex(added, o.startCodepoint);
  const woffBuffer = await generateWoff([], family, null, all);
  const fontPath = o.cssFontPath || `fonts/${family}.woff`;
  const cssText = buildCssText({
    fontFamily: family,
    prefix,
    fontPath,
    glyphs: all.map((g) => ({ name: g.name, codepoint: g.codepoint })),
  });
  const metadata = buildMetadata(all, family, prefix);

  return { family, prefix, woffBuffer, cssText, metadata, glyphs: all, added, skipped };
}

/** Render (or merge) the stylesheet for an updated glyph set. */
function renderCss(glyphs, { cssPath, woffPath, family, prefix }) {
  if (!cssPath) return null;
  const fontRel = path
    .relative(path.dirname(path.resolve(cssPath)), path.resolve(woffPath))
    .replace(/\\/g, '/');
  const glyphsForCss = glyphs.map((g) => ({ name: g.name, codepoint: g.codepoint }));
  return fs.existsSync(cssPath)
    ? mergeCssText({
        existingCss: fs.readFileSync(cssPath, 'utf8'),
        fontFamily: family, prefix, fontPath: fontRel, glyphs: glyphsForCss,
      })
    : buildCssText({ fontFamily: family, prefix, fontPath: fontRel, glyphs: glyphsForCss });
}

/** Build the metadata.json shape used by persistLatestBundle / MCP resources. */
function buildMetadata(glyphs, family, prefix) {
  return {
    fontFamily: family,
    generatedAt: new Date().toISOString(),
    glyphs: glyphs.map((g) => {
      const cp = g.codepoint || 0;
      const safe = (g.name || 'glyph').replace(/[^a-zA-Z0-9_-]/g, '-');
      return {
        name: g.name,
        codepoint: cp,
        unicodeHex: 'U+' + cp.toString(16).toUpperCase().padStart(4, '0'),
        cssSelector: `.${prefix}-${safe}`,
        cssContent: `\\${cp.toString(16).toLowerCase()}`,
        previewSvg: g.svgContent || '',
      };
    }),
  };
}

module.exports = {
  addIconsToFont,
  createFontFromSvgs,
  expandSvgInputs,
  detectPrefix,
  buildSvgFromPath,
  sortAndReindex,
  buildMetadata,
};
