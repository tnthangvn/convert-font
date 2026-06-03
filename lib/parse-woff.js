'use strict';

/**
 * WOFF parsing utilities (HTTP-free).
 *
 * Extracted from server.js so the same logic can be reused by the Express
 * server, the MCP server, and the CLI without a running web server.
 */

const opentype = require('opentype.js');

/**
 * Convert opentype.js path commands into an SVG path `d` string.
 * Font glyph coordinates are y-up; SVG is y-down, so callers pass a
 * `yTransform` (typically `v => unitsPerEm - v`) to flip the axis.
 *
 * @param {Array} commands
 * @param {(value:number)=>number|null} [yTransform]
 * @returns {string}
 */
function pathCommandsToData(commands, yTransform = null) {
  if (!Array.isArray(commands) || commands.length === 0) return '';
  const y = (value) => yTransform ? yTransform(value) : value;
  return commands.map((cmd) => {
    switch (cmd.type) {
      case 'M': return `M ${cmd.x} ${y(cmd.y)}`;
      case 'L': return `L ${cmd.x} ${y(cmd.y)}`;
      case 'C': return `C ${cmd.x1} ${y(cmd.y1)} ${cmd.x2} ${y(cmd.y2)} ${cmd.x} ${y(cmd.y)}`;
      case 'Q': return `Q ${cmd.x1} ${y(cmd.y1)} ${cmd.x} ${y(cmd.y)}`;
      case 'A': return `A ${cmd.rX} ${cmd.rY} ${cmd.xRot} ${cmd.lArcFlag} ${cmd.sweepFlag ? 0 : 1} ${cmd.x} ${y(cmd.y)}`;
      case 'Z': return 'Z';
      default: return '';
    }
  }).filter(Boolean).join(' ');
}

/**
 * Parse an existing .woff buffer and return glyph metadata.
 *
 * @param {Buffer} buffer
 * @returns {{fontFamily:string, unitsPerEm:number, ascender:number, numGlyphs:number, glyphs:Array}}
 */
function parseWoff(buffer) {
  const fontBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const font = opentype.parse(fontBuffer, { lowMemory: false });
  const ascender = font.ascender || font.unitsPerEm * 0.8;
  const unitsPerEm = font.unitsPerEm || 1000;
  const glyphs = [];

  for (let i = 0; i < font.glyphs.length; i++) {
    const g = font.glyphs.get(i);
    if (!g.unicode && g.index !== 0) continue;

    let svgPath = '';
    try {
      const commands = g.path?.commands || (typeof g.getPath === 'function' ? g.getPath(0, 0, unitsPerEm).commands : null);
      svgPath = pathCommandsToData(commands, (value) => unitsPerEm - value);
    } catch (_) { /* ignore */ }

    glyphs.push({
      index: g.index,
      name: g.name || `glyph_${g.index}`,
      unicode: g.unicode,
      unicodeHex: g.unicode ? 'U+' + g.unicode.toString(16).toUpperCase().padStart(4, '0') : null,
      svgPathData: svgPath,
      advanceWidth: g.advanceWidth,
    });
  }
  return {
    fontFamily: font.names?.fontFamily?.en || font.names?.fontFamily || 'Unknown',
    unitsPerEm,
    ascender,
    numGlyphs: font.glyphs.length,
    glyphs,
  };
}

module.exports = { parseWoff, pathCommandsToData };
