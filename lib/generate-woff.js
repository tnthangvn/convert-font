'use strict';

/**
 * WOFF generation (HTTP-free).
 *
 * Extracted from server.js. Pipeline: svgicons2svgfont → svg2ttf → ttf2woff.
 * Reused by the Express server, the MCP server, and the CLI.
 */

const { Readable } = require('stream');
const { normalizeSvg } = require('./normalize-svg');
const { parseWoff } = require('./parse-woff');

/**
 * Generate a .woff buffer from SVG content strings + optional existing glyphs.
 *
 * @param {Array<{name:string, svgContent:string}>} svgItems
 * @param {string} [fontName='CustomFont']
 * @param {Buffer|null} [existingWoffBuffer]
 * @param {Array<{name:string, codepoint:number, svgContent:string}>|null} [glyphMeta]
 *   When provided, the caller controls order/names/codepoints fully.
 * @returns {Promise<Buffer>}
 */
async function generateWoff(svgItems, fontName = 'CustomFont', existingWoffBuffer = null, glyphMeta = null) {
  // Dynamic imports for ESM-only packages
  const { SVGIcons2SVGFontStream } = await import('svgicons2svgfont');
  const svg2ttf = (await import('svg2ttf')).default;
  const ttf2woff = (await import('ttf2woff')).default;

  // Determine starting codepoint (Private Use Area)
  let nextCodepoint = 0xE001;
  const skippedGlyphs = [];

  const allSvgItems = [];

  if (glyphMeta && Array.isArray(glyphMeta) && glyphMeta.length > 0) {
    // Client controls everything — use glyphMeta order/names/codepoints
    for (const meta of glyphMeta) {
      const svgContent = meta.svgContent;
      if (!svgContent) continue;
      allSvgItems.push({
        name: meta.name || 'glyph',
        codepoint: meta.codepoint || nextCodepoint++,
        svgContent,
      });
    }
  } else {
    // Legacy path: auto-assign codepoints
    if (existingWoffBuffer) {
      const parsed = parseWoff(existingWoffBuffer);
      fontName = fontName || parsed.fontFamily || 'CustomFont';
      for (const g of parsed.glyphs) {
        if (!g.svgPathData || g.index === 0) continue;
        const cp = g.unicode || nextCodepoint++;
        if (cp >= nextCodepoint) nextCodepoint = cp + 1;
        const unitsPerEm = parsed.unitsPerEm || 1000;
        const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${unitsPerEm} ${unitsPerEm}">
  <path d="${g.svgPathData}"/>
</svg>`;
        allSvgItems.push({
          name: g.name,
          codepoint: cp,
          svgContent,
        });
      }
    }

    for (const item of svgItems) {
      allSvgItems.push({
        name: item.name,
        codepoint: nextCodepoint++,
        svgContent: item.svgContent,
      });
    }
  }

  if (allSvgItems.length === 0) {
    throw new Error('No glyphs to generate. Please add at least one SVG file.');
  }

  const validSvgItems = [];
  for (const item of allSvgItems) {
    try {
      const normalized = normalizeSvg(item.svgContent);
      validSvgItems.push({ ...item, svgContent: normalized.svgContent });
    } catch (error) {
      skippedGlyphs.push(item.name || 'glyph');
    }
  }

  if (validSvgItems.length === 0) {
    throw new Error('No valid SVG glyphs to generate.');
  }

  if (skippedGlyphs.length > 0) {
    console.warn(`Skipped invalid glyphs: ${skippedGlyphs.join(', ')}`);
  }

  // Step 1: SVGs → SVG Font
  const svgFontData = await new Promise((resolve, reject) => {
    const fontStream = new SVGIcons2SVGFontStream({
      fontName,
      normalize: true,
      fontHeight: 1000,
      log: () => {},
    });

    let result = '';
    fontStream.on('data', (chunk) => {
      result += typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
    });
    fontStream.on('end', () => resolve(result));
    fontStream.on('error', reject);

    for (const item of allSvgItems) {
      const glyphStream = new Readable({ read() {} });
      glyphStream.metadata = {
        name: item.name,
        unicode: [String.fromCodePoint(item.codepoint)],
      };
      glyphStream.push(item.svgContent);
      glyphStream.push(null);
      fontStream.write(glyphStream);
    }

    fontStream.end();
  });

  // Step 2: SVG Font → TTF
  const ttfResult = svg2ttf(svgFontData, {});
  const ttfBuffer = Buffer.from(ttfResult.buffer);

  // Step 3: TTF → WOFF
  const woffResult = ttf2woff(new Uint8Array(ttfBuffer));
  return Buffer.from(woffResult.buffer);
}

module.exports = { generateWoff };
