'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { discoverFonts, findSiblingCss } = require('../../lib/repo-fonts');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'repo-fonts-'));
}

test('discoverFonts finds .woff files and ignores node_modules/data', () => {
  const root = mkTmp();
  try {
    fs.mkdirSync(path.join(root, 'public', 'fonts'), { recursive: true });
    fs.mkdirSync(path.join(root, 'node_modules', 'pkg'), { recursive: true });
    fs.mkdirSync(path.join(root, 'data', 'latest'), { recursive: true });

    fs.writeFileSync(path.join(root, 'public', 'fonts', 'RV-Icon.woff'), 'x');
    fs.writeFileSync(path.join(root, 'public', 'icon.css'), '.rvi-a:before{content:"\\e001"}');
    fs.writeFileSync(path.join(root, 'node_modules', 'pkg', 'ignored.woff'), 'x');
    fs.writeFileSync(path.join(root, 'data', 'latest', 'font.woff'), 'x');

    const fonts = discoverFonts(root);
    assert.equal(fonts.length, 1, 'only the public/fonts woff is discovered');
    assert.equal(fonts[0].family, 'RV-Icon');
    assert.equal(fonts[0].relPath, path.join('public', 'fonts', 'RV-Icon.woff'));
    assert.ok(fonts[0].cssPath && fonts[0].cssPath.endsWith('icon.css'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('findSiblingCss resolves icon.css in the fonts parent dir', () => {
  const root = mkTmp();
  try {
    fs.mkdirSync(path.join(root, 'fonts'), { recursive: true });
    const woff = path.join(root, 'fonts', 'MyFont.woff');
    fs.writeFileSync(woff, 'x');
    assert.equal(findSiblingCss(woff), null, 'no css yet');
    fs.writeFileSync(path.join(root, 'icon.css'), '/* */');
    assert.equal(findSiblingCss(woff), path.join(root, 'icon.css'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
