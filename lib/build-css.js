'use strict';

/**
 * Format a codepoint as a lowercase CSS escape string.
 * @param {number} codepoint
 * @returns {string} e.g. "\\e904"
 */
function formatCssEscape(codepoint) {
  return `\\${codepoint.toString(16).toLowerCase()}`;
}

/**
 * Build a complete CSS file string for an icon font.
 *
 * @param {object} opts
 * @param {string} opts.fontFamily
 * @param {string} opts.prefix
 * @param {string} opts.fontPath
 * @param {Array<{name: string, codepoint: number}>} opts.glyphs
 * @param {string} [opts.hash]
 * @returns {string}
 */
function buildCssText({ fontFamily = 'CustomFont', prefix = 'icon', fontPath = 'fonts/font.woff', glyphs = [], hash }) {
  const cacheBuster = hash || Date.now().toString(36);

  let css = `@font-face {
  font-family: '${fontFamily}';
  src: url('${fontPath}?${cacheBuster}') format('woff');
  font-weight: normal;
  font-style: normal;
  font-display: block;
}

[class^='${prefix}-'],
[class*=' ${prefix}-'] {
  font-family: '${fontFamily}' !important;
  speak: never;
  font-style: normal;
  font-weight: normal;
  font-variant: normal;
  text-transform: none;
  line-height: 1;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
`;

  for (const g of glyphs) {
    const name = (g.name || 'glyph').replace(/[^a-zA-Z0-9_-]/g, '-');
    const escape = formatCssEscape(g.codepoint || 0xE001);
    css += `\n.${prefix}-${name}:before {\n  content: '${escape}';\n}\n`;
  }

  return css;
}

module.exports = { buildCssText, formatCssEscape };
