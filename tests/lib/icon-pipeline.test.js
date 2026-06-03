'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { addIconsToFont, createFontFromSvgs, expandSvgInputs, detectPrefix } = require('../../lib/icon-pipeline');
const { parseWoff } = require('../../lib/parse-woff');

const REPO_WOFF = path.join(__dirname, '..', '..', 'public', 'fonts', 'RV-Icon.woff');
const STAR = path.join(__dirname, '..', '..', 'test-star.svg');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'icon-pipeline-'));
}

test('expandSvgInputs expands a folder and a single file', () => {
  const dir = mkTmp();
  try {
    fs.writeFileSync(path.join(dir, 'a.svg'), '<svg></svg>');
    fs.writeFileSync(path.join(dir, 'b.svg'), '<svg></svg>');
    fs.writeFileSync(path.join(dir, 'note.txt'), 'x');
    const fromDir = expandSvgInputs([dir]);
    assert.equal(fromDir.length, 2, 'only .svg files, txt ignored');
    const fromFile = expandSvgInputs([path.join(dir, 'a.svg')]);
    assert.equal(fromFile.length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('detectPrefix reads the prefix from a base rule', () => {
  const dir = mkTmp();
  try {
    const css = path.join(dir, 'icon.css');
    fs.writeFileSync(css, "[class^='rvi-'],[class*=' rvi-']{font-family:'X'}\n.rvi-a:before{content:'\\e001'}");
    assert.equal(detectPrefix(css), 'rvi');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('addIconsToFont: batch add → sorted names, sequential codepoints, single-prefix CSS', async () => {
  const dir = mkTmp();
  try {
    const woff = path.join(dir, 'RV-Icon.woff');
    const css = path.join(dir, 'icon.css');
    fs.copyFileSync(REPO_WOFF, woff);
    // two svgs from one folder — distinct outlines so svg2ttf keeps both
    fs.writeFileSync(path.join(dir, 'alpha.svg'),
      '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18"/></svg>');
    fs.writeFileSync(path.join(dir, 'zeta.svg'),
      '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/></svg>');

    const result = await addIconsToFont({ woffPath: woff, svgPaths: [dir], cssPath: css, prefix: 'rvi' });

    // names stored WITHOUT prefix
    assert.ok(result.added.map((g) => g.name).includes('alpha'));
    assert.ok(result.added.map((g) => g.name).includes('zeta'));

    // sorted by name
    const names = result.glyphs.map((g) => g.name);
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    assert.deepEqual(names, sorted, 'glyphs are sorted by name');

    // sequential codepoints from 0xE001
    result.glyphs.forEach((g, i) => assert.equal(g.codepoint, 0xE001 + i));

    // CSS uses single prefix
    assert.ok(result.cssText.includes('.rvi-alpha:before'));
    assert.ok(!result.cssText.includes('.rvi-rvi-'), 'no double prefix');

    // generated woff parses and round-trips the new glyphs
    fs.writeFileSync(woff, result.woffBuffer);
    const parsed = parseWoff(fs.readFileSync(woff));
    const parsedNames = parsed.glyphs.map((g) => g.name);
    assert.ok(parsedNames.includes('alpha') && parsedNames.includes('zeta'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('addIconsToFont: update mode replaces same-named glyph instead of duplicating', async () => {
  const dir = mkTmp();
  try {
    const woff = path.join(dir, 'RV-Icon.woff');
    fs.copyFileSync(REPO_WOFF, woff);
    const before = parseWoff(fs.readFileSync(woff)).glyphs.filter((g) => g.svgPathData && g.index !== 0).length;

    fs.copyFileSync(STAR, path.join(dir, 'activity.svg')); // 'activity' already exists in the font
    const result = await addIconsToFont({ woffPath: woff, svgPaths: [path.join(dir, 'activity.svg')], prefix: 'rvi', update: true });

    const occurrences = result.glyphs.filter((g) => g.name === 'activity').length;
    assert.equal(occurrences, 1, 'no duplicate "activity"');
    assert.equal(result.glyphs.length, before, 'count unchanged on update');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('createFontFromSvgs builds a new font + css + metadata with no existing woff', async () => {
  const result = await createFontFromSvgs({ svgPaths: [STAR], fontFamily: 'MyIcons', prefix: 'mi' });
  assert.equal(result.glyphs[0].name, 'test-star');
  assert.equal(result.glyphs[0].codepoint, 0xE001);
  assert.ok(result.cssText.includes('.mi-test-star:before'));
  assert.equal(result.metadata.glyphs.length, 1);
  assert.ok(Buffer.isBuffer(result.woffBuffer) && result.woffBuffer.length > 0);
});
