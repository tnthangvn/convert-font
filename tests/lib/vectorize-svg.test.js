'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { vectorizeSvg, shapeToPath, flattenToPolylines, strokeOutline } = require('../../lib/vectorize-svg');

test('rejects non-SVG input', () => {
  assert.ok(vectorizeSvg('not svg').error);
  assert.ok(vectorizeSvg('').error);
});

test('filled path → single black path, preserves viewBox', () => {
  const r = vectorizeSvg('<svg viewBox="0 0 28 28"><path d="M4 0L24 0L24 28L4 28Z" fill="black"/></svg>');
  assert.equal(r.paths, 1);
  assert.match(r.vectorized, /viewBox="0 0 28 28"/);
  assert.match(r.vectorized, /fill="#000"/);
  assert.doesNotMatch(r.vectorized, /currentColor/);
});

test('default fill (no attributes) is treated as black fill', () => {
  const r = vectorizeSvg('<svg viewBox="0 0 10 10"><path d="M0 0h10v10h-10Z"/></svg>');
  assert.equal(r.paths, 1);
});

test('stroke-only outline icon produces filled geometry (not empty)', () => {
  const svg = '<svg viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round">'
    + '<path d="M5 12h14"/><path d="M12 5v14"/></svg>';
  const r = vectorizeSvg(svg);
  assert.equal(r.paths, 2, 'one outline path per stroked path');
  // outlined geometry must contain real coordinates
  const dTotal = (r.vectorized.match(/d="([^"]*)"/g) || []).join('').length;
  assert.ok(dTotal > 100, 'stroke outline should be non-trivial');
});

test('primitive shapes convert to paths', () => {
  assert.match(shapeToPath('rect', { width: '10', height: '10' }), /^M0 0h10v10h-10Z$/);
  assert.match(shapeToPath('rect', { width: '10', height: '10', rx: '2' }), /a2 2/);
  assert.match(shapeToPath('circle', { cx: '5', cy: '5', r: '5' }), /a5 5/);
  assert.match(shapeToPath('polygon', { points: '0,0 10,0 10,10' }), /Z$/);
  assert.doesNotMatch(shapeToPath('polyline', { points: '0,0 10,10' }), /Z$/);
  assert.equal(shapeToPath('rect', { width: '0', height: '5' }), null);
});

test('group transform is baked into coordinates', () => {
  // rect 0,0 5x5 under translate(2 2) scale(2) → spans 2,2 .. 12,12
  const r = vectorizeSvg('<svg viewBox="0 0 24 24"><g transform="translate(2 2) scale(2)"><rect x="0" y="0" width="5" height="5"/></g></svg>');
  assert.equal(r.paths, 1);
  const d = r.vectorized.match(/d="([^"]*)"/)[1];
  const coords = d.match(/-?\d+(?:\.\d+)?/g).map(Number);
  const maxCoord = Math.max(...coords.map(Math.abs));
  assert.ok(maxCoord >= 10 && maxCoord <= 13, `expected scaled coords ~12, got max ${maxCoord}`);
});

test('flattenToPolylines samples curves into points', () => {
  const polys = flattenToPolylines('M0 0 C0 10 10 10 10 0');
  assert.equal(polys.length, 1);
  assert.ok(polys[0].points.length > 5, 'cubic should be sampled into multiple points');
  assert.equal(polys[0].closed, false);
});

test('strokeOutline returns empty for zero width', () => {
  assert.equal(strokeOutline([{ points: [{ x: 0, y: 0 }, { x: 10, y: 0 }], closed: false }], 0), '');
});
