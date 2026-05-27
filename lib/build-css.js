'use strict';

/**
 * Format a codepoint as a lowercase CSS escape string.
 * @param {number} codepoint
 * @returns {string} e.g. "\\e904"
 */
function formatCssEscape(codepoint) {
  return `\\${codepoint.toString(16).toLowerCase()}`;
}

function sanitizeGlyphCssName(name) {
  return (name || 'glyph').replace(/[^a-zA-Z0-9_-]/g, '-');
}

function renderFontFace({ fontFamily = 'CustomFont', fontPath = 'fonts/font.woff', hash }) {
  const cacheBuster = hash || Date.now().toString(36);
  return `@font-face {
  font-family: '${fontFamily}';
  src: url('${fontPath}?${cacheBuster}') format('woff');
  font-weight: normal;
  font-style: normal;
  font-display: block;
}
`;
}

function renderBaseRule({ fontFamily = 'CustomFont', prefix = 'icon' }) {
  return `
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
}

function renderGlyphRule(prefix, name, glyph) {
  return `
.${prefix}-${name}:before {
  content: '${formatCssEscape(glyph.codepoint || 0xE001)}';
}
`;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseCssBlocks(css) {
  const blocks = [];
  let start = 0;
  let depth = 0;
  let quote = null;
  let inComment = false;

  for (let i = 0; i < css.length; i += 1) {
    const ch = css[i];
    const next = css[i + 1];
    const prev = css[i - 1];

    if (inComment) {
      if (ch === '*' && next === '/') {
        inComment = false;
        i += 1;
      }
      continue;
    }
    if (ch === '/' && next === '*') {
      inComment = true;
      i += 1;
      continue;
    }

    if ((ch === "'" || ch === '"') && prev !== '\\') {
      quote = quote === ch ? null : quote || ch;
      continue;
    }
    if (quote) continue;

    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        blocks.push(css.slice(start, i + 1));
        start = i + 1;
      }
    }
  }

  if (start < css.length) blocks.push(css.slice(start));
  return blocks;
}

function splitSelectorAndBody(block) {
  const start = block.indexOf('{');
  const end = block.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  return {
    leading: block.slice(0, start).match(/^\s*/)?.[0] || '',
    selector: block.slice(0, start).trim(),
    body: block.slice(start + 1, end),
  };
}

function extractContentValue(body) {
  const match = body.match(/content\s*:\s*(['"])(.*?)\1/);
  return match ? match[2] : null;
}

function extractFontFacePath(block) {
  const match = block.match(/url\(\s*(['"]?)([^)'"?]+)(?:\?[^)'"]*)?\1\s*\)/);
  return match ? match[2] : null;
}

function isCssEscapeContent(value) {
  return /^\\[0-9a-fA-F]+$/.test(value || '');
}

function normalizeSelector(selector) {
  return selector.replace(/\/\*[\s\S]*?\*\//g, '').trim();
}

function extractSingleIconName(selector, prefix) {
  const pattern = new RegExp(`^\\.${escapeRegExp(prefix)}-([a-zA-Z0-9_-]+)::?before$`);
  const match = normalizeSelector(selector).match(pattern);
  return match ? match[1] : null;
}

function isBaseRule(selector, prefix) {
  const normalized = normalizeSelector(selector);
  return normalized.includes(`[class^='${prefix}-']`) && normalized.includes(`[class*=' ${prefix}-']`);
}

function replaceContent(block, escape) {
  return block.replace(/content\s*:\s*(['"])(.*?)\1/, `content: '${escape}'`);
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
  let css = renderFontFace({ fontFamily, fontPath, hash }) + renderBaseRule({ fontFamily, prefix });

  for (const g of glyphs) {
    css += renderGlyphRule(prefix, sanitizeGlyphCssName(g.name), g);
  }

  return css;
}

function mergeCssText({ existingCss = '', fontFamily = 'CustomFont', prefix = 'icon', fontPath = 'fonts/font.woff', glyphs = [], hash }) {
  const glyphByName = new Map(glyphs.map((glyph) => [sanitizeGlyphCssName(glyph.name), glyph]));
  const managedBlocks = new Map();
  const output = [];
  let preservedFontPath = null;
  let sawFontFace = false;
  let sawBaseRule = false;

  for (const block of parseCssBlocks(existingCss)) {
    const parsed = splitSelectorAndBody(block);
    if (!parsed) {
      output.push(block);
      continue;
    }

    if (normalizeSelector(parsed.selector) === '@font-face') {
      preservedFontPath ||= extractFontFacePath(block);
      sawFontFace = true;
      continue;
    }

    if (isBaseRule(parsed.selector, prefix)) {
      if (!sawBaseRule) {
        output.push(renderBaseRule({ fontFamily, prefix }));
        sawBaseRule = true;
      }
      continue;
    }

    const iconName = extractSingleIconName(parsed.selector, prefix);
    if (iconName) {
      const content = extractContentValue(parsed.body);
      if (isCssEscapeContent(content)) {
        const glyph = glyphByName.get(iconName);
        if (glyph) {
          managedBlocks.set(iconName, replaceContent(block, formatCssEscape(glyph.codepoint || 0xE001)));
        }
        continue;
      }

      output.push(block);
      continue;
    }

    output.push(block);
  }

  const fontFace = renderFontFace({ fontFamily, fontPath: preservedFontPath || fontPath, hash });
  output.unshift(fontFace);
  if (!sawBaseRule) {
    const insertAt = output.findIndex((block) => block.includes('@font-face')) + 1;
    output.splice(insertAt > 0 ? insertAt : 0, 0, renderBaseRule({ fontFamily, prefix }));
  }

  for (const glyph of glyphs) {
    const name = sanitizeGlyphCssName(glyph.name);
    output.push(managedBlocks.get(name) || renderGlyphRule(prefix, name, glyph));
  }

  const merged = output.join('');
  return merged.endsWith('\n') ? merged : `${merged}\n`;
}

module.exports = { buildCssText, formatCssEscape, mergeCssText };
