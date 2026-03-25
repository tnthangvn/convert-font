const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildCssText, formatCssEscape } = require('../../lib/build-css');

describe('buildCssText', () => {
  const baseOpts = {
    fontFamily: 'TestFont',
    prefix: 'icon',
    fontPath: 'fonts/test.woff',
    glyphs: [
      { name: 'rvi-eyes', codepoint: 0xE904 },
      { name: 'rvi-heart', codepoint: 0xE905 },
    ],
    hash: 'testhash',
  };

  it('generates valid @font-face block', () => {
    const css = buildCssText(baseOpts);
    assert.match(css, /@font-face\s*\{/);
    assert.match(css, /font-family:\s*'TestFont'/);
    assert.match(css, /url\('fonts\/test\.woff\?testhash'\)/);
    assert.match(css, /format\('woff'\)/);
  });

  it('generates correct selector attribute rules', () => {
    const css = buildCssText(baseOpts);
    assert.match(css, /\[class\^='icon-'\]/);
    assert.match(css, /\[class\*=' icon-'\]/);
  });

  it('generates correct glyph class with content escape', () => {
    const css = buildCssText(baseOpts);
    assert.match(css, /\.icon-rvi-eyes:before/);
    assert.match(css, /content: '\\e904';/);
    assert.match(css, /\.icon-rvi-heart:before/);
    assert.match(css, /content: '\\e905';/);
  });

  it('uses default values when options are omitted', () => {
    const css = buildCssText({
      glyphs: [{ name: 'test', codepoint: 0xE001 }],
    });
    assert.match(css, /font-family:\s*'CustomFont'/);
    assert.match(css, /url\('fonts\/font\.woff\?/);
    assert.match(css, /\.icon-test:before/);
  });

  it('sanitizes glyph names with special characters', () => {
    const css = buildCssText({
      ...baseOpts,
      glyphs: [{ name: 'bad name!@#', codepoint: 0xE001 }],
    });
    assert.match(css, /\.icon-bad-name---:before/);
  });
});

describe('formatCssEscape', () => {
  it('formats codepoint as lowercase hex escape', () => {
    assert.equal(formatCssEscape(0xE904), '\\e904');
    assert.equal(formatCssEscape(0xE001), '\\e001');
    assert.equal(formatCssEscape(0xF000), '\\f000');
  });
});
