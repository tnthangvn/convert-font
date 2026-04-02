'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeSvg } = require('../../lib/normalize-svg');

// Helper: extract viewBox from SVG string
function getViewBox(svg) {
  const m = svg.match(/viewBox="([^"]*)"/);
  return m ? m[1].split(/\s+/).map(Number) : null;
}

// Helper: extract transform from the norm wrapper <g>
function getTransform(svg) {
  const m = svg.match(/data-norm-wrapper="true" transform="([^"]*)"/);
  return m ? m[1] : null;
}

// Helper: check data-original-viewbox attribute
function getOriginalViewBox(svg) {
  const m = svg.match(/data-original-viewbox="([^"]*)"/);
  return m ? m[1] : null;
}

describe('normalizeSvg', () => {
  const baseSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M10 10L90 90"/></svg>';

  it('normalizes to center/center by default', () => {
    const result = normalizeSvg({ svgContent: baseSvg, targetWidth: 28, targetHeight: 28 });
    assert.ok(!result.error, 'should not return error');
    assert.ok(result.normalizedSvg);

    const vb = getViewBox(result.normalizedSvg);
    assert.deepEqual(vb, [0, 0, 28, 28]);

    const transform = getTransform(result.normalizedSvg);
    assert.ok(transform, 'should have a transform');
    // scale should be 28/100 = 0.28
    assert.ok(transform.includes('scale(0.28)'), `transform is ${transform}`);
    // center offset = (28 - 100*0.28) / 2 = 0
    assert.ok(transform.includes('translate(0, 0)'), `transform is ${transform}`);
  });

  it('handles left/top alignment', () => {
    const result = normalizeSvg({ svgContent: baseSvg, targetWidth: 50, targetHeight: 50, alignH: 'left', alignV: 'top' });
    assert.ok(!result.error);
    const transform = getTransform(result.normalizedSvg);
    // scale = 50/100 = 0.5, left/top => tx=0, ty=0
    assert.ok(transform.includes('translate(0, 0)'));
    assert.ok(transform.includes('scale(0.5)'));
  });

  it('handles right/bottom alignment', () => {
    const result = normalizeSvg({ svgContent: baseSvg, targetWidth: 50, targetHeight: 50, alignH: 'right', alignV: 'bottom' });
    assert.ok(!result.error);
    const transform = getTransform(result.normalizedSvg);
    // scale = 0.5, scaledW=50, scaledH=50 => offset=0 for both (aspect fills perfectly)
    assert.ok(transform.includes('translate(0, 0)'));
    assert.ok(transform.includes('scale(0.5)'));
  });

  it('handles non-square source with center alignment', () => {
    const wideSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><rect/></svg>';
    const result = normalizeSvg({ svgContent: wideSvg, targetWidth: 28, targetHeight: 28, alignH: 'center', alignV: 'center' });
    assert.ok(!result.error);

    const transform = getTransform(result.normalizedSvg);
    // scale = min(28/200, 28/100) = min(0.14, 0.28) = 0.14
    // scaledW = 200*0.14 = 28, scaledH = 100*0.14 = 14
    // tx = (28-28)/2 = 0, ty = (28-14)/2 = 7
    assert.ok(transform.includes('scale(0.14)'), `transform is ${transform}`);
    assert.ok(transform.includes('translate(0, 7)'), `transform is ${transform}`);
  });

  it('preserves original viewBox on first normalization', () => {
    const result = normalizeSvg({ svgContent: baseSvg, targetWidth: 28, targetHeight: 28 });
    assert.ok(!result.error);
    const origVb = getOriginalViewBox(result.normalizedSvg);
    assert.equal(origVb, '0 0 100 100');
  });

  it('re-normalization does not compound transforms', () => {
    // First normalization
    const first = normalizeSvg({ svgContent: baseSvg, targetWidth: 28, targetHeight: 28 });
    assert.ok(!first.error);

    // Re-normalize the result with different target
    const second = normalizeSvg({ svgContent: first.normalizedSvg, targetWidth: 50, targetHeight: 50 });
    assert.ok(!second.error);

    // Should still reference original viewBox 0 0 100 100
    const origVb = getOriginalViewBox(second.normalizedSvg);
    assert.equal(origVb, '0 0 100 100');

    // viewBox should now be 0 0 50 50
    const vb = getViewBox(second.normalizedSvg);
    assert.deepEqual(vb, [0, 0, 50, 50]);

    // Scale should be 50/100 = 0.5 (from original, not from first normalized)
    const transform = getTransform(second.normalizedSvg);
    assert.ok(transform.includes('scale(0.5)'), `expected scale(0.5), got: ${transform}`);
  });

  it('re-normalization with same settings produces identical output', () => {
    const opts = { svgContent: baseSvg, targetWidth: 28, targetHeight: 28, alignH: 'center', alignV: 'center' };
    const first = normalizeSvg(opts);
    const second = normalizeSvg({ ...opts, svgContent: first.normalizedSvg });
    assert.equal(first.normalizedSvg, second.normalizedSvg);
  });

  it('falls back to 0 0 1000 1000 viewBox when none is present', () => {
    const noVbSvg = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L100 100"/></svg>';
    const result = normalizeSvg({ svgContent: noVbSvg, targetWidth: 28, targetHeight: 28 });
    assert.ok(!result.error);
    const origVb = getOriginalViewBox(result.normalizedSvg);
    assert.equal(origVb, '0 0 1000 1000');
  });

  it('derives viewBox from width/height attributes', () => {
    const whSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><circle/></svg>';
    const result = normalizeSvg({ svgContent: whSvg, targetWidth: 28, targetHeight: 28 });
    assert.ok(!result.error);
    const origVb = getOriginalViewBox(result.normalizedSvg);
    assert.equal(origVb, '0 0 64 64');
  });

  it('returns error for empty input', () => {
    const result = normalizeSvg({ svgContent: '', targetWidth: 28, targetHeight: 28 });
    assert.ok(result.error);
    assert.ok(result.error.includes('No SVG content'));
  });

  it('returns error for null input', () => {
    const result = normalizeSvg({ svgContent: null, targetWidth: 28, targetHeight: 28 });
    assert.ok(result.error);
  });

  it('returns error for zero target dimensions', () => {
    const result = normalizeSvg({ svgContent: baseSvg, targetWidth: 0, targetHeight: 28 });
    assert.ok(result.error);
    assert.ok(result.error.includes('positive'));
  });

  it('returns error for negative target dimensions', () => {
    const result = normalizeSvg({ svgContent: baseSvg, targetWidth: -5, targetHeight: 28 });
    assert.ok(result.error);
  });

  // All 9 alignment combos
  const aligns = [
    ['left', 'top'], ['left', 'center'], ['left', 'bottom'],
    ['center', 'top'], ['center', 'center'], ['center', 'bottom'],
    ['right', 'top'], ['right', 'center'], ['right', 'bottom'],
  ];

  for (const [h, v] of aligns) {
    it(`handles alignment ${h}/${v}`, () => {
      const result = normalizeSvg({ svgContent: baseSvg, targetWidth: 28, targetHeight: 28, alignH: h, alignV: v });
      assert.ok(!result.error, `should not error for ${h}/${v}`);
      assert.ok(result.normalizedSvg);
      const vb = getViewBox(result.normalizedSvg);
      assert.deepEqual(vb, [0, 0, 28, 28]);
    });
  }
});
