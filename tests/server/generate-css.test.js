const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildCssText, formatCssEscape, mergeCssText } = require('../../lib/build-css');

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

describe('mergeCssText', () => {
  it('preserves font face path and updates hash', () => {
    const css = mergeCssText({
      existingCss: `@font-face {
  font-family: 'Old';
  src: url('~~/public/fonts/RV-Icon.woff?mnj1teui') format('woff');
}
`,
      fontFamily: 'RVIcon',
      prefix: 'rvi',
      fontPath: 'fonts/fallback.woff',
      glyphs: [],
      hash: 'newhash',
    });

    assert.match(css, /url\('~~\/public\/fonts\/RV-Icon\.woff\?newhash'\)/);
    assert.doesNotMatch(css, /mnj1teui/);
    assert.doesNotMatch(css, /fonts\/fallback\.woff/);
  });

  it('appends generated rules in glyph order', () => {
    const css = mergeCssText({
      existingCss: `.rvi-b:before {
  content: '\\e002';
}

.rvi-a:before {
  content: '\\e001';
}
`,
      fontFamily: 'RVIcon',
      prefix: 'rvi',
      glyphs: [
        { name: 'a', codepoint: 0xe010 },
        { name: 'b', codepoint: 0xe011 },
      ],
      hash: 'hash',
    });

    assert.ok(css.indexOf('.rvi-a:before') < css.indexOf('.rvi-b:before'));
    assert.match(css, /.rvi-a:before\s*{\s*content: '\\e010';\s*}/);
    assert.match(css, /.rvi-b:before\s*{\s*content: '\\e011';\s*}/);
  });

  it('keeps custom icon rules while moving generated rules to the bottom group', () => {
    const css = mergeCssText({
      existingCss: `.rvi-activity-2:before {
  content: '\\e002';
}

.rvi-wrestling-2:before {
  content: '🤼‍♀️';
}

.rvi-activity-1:before {
  content: '\\e001';
}
`,
      fontFamily: 'RVIcon',
      prefix: 'rvi',
      glyphs: [
        { name: 'activity-1', codepoint: 0xe010 },
        { name: 'activity-2', codepoint: 0xe011 },
      ],
      hash: 'hash',
    });

    assert.ok(css.indexOf('.rvi-wrestling-2:before') < css.indexOf('.rvi-activity-1:before'));
    assert.ok(css.indexOf('.rvi-activity-1:before') < css.indexOf('.rvi-activity-2:before'));
    assert.match(css, /.rvi-wrestling-2:before\s*{\s*content: '🤼‍♀️';\s*}/);
    assert.match(css, /.rvi-activity-1:before\s*{\s*content: '\\e010';\s*}/);
    assert.match(css, /.rvi-activity-2:before\s*{\s*content: '\\e011';\s*}/);
  });
});

describe('formatCssEscape', () => {
  it('formats codepoint as lowercase hex escape', () => {
    assert.equal(formatCssEscape(0xE904), '\\e904');
    assert.equal(formatCssEscape(0xE001), '\\e001');
    assert.equal(formatCssEscape(0xF000), '\\f000');
  });
});
