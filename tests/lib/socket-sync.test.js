const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseChannelUrl, normalizeIconPayload } = require('../../lib/socket-sync');

describe('parseChannelUrl', () => {
  it('parses channel param', () => {
    const result = parseChannelUrl('http://localhost:3456/?channel=abc123');
    assert.equal(result.url, 'http://localhost:3456');
    assert.equal(result.channel, 'abc123');
  });

  it('supports chanel typo param', () => {
    const result = parseChannelUrl('http://localhost:3456/?chanel=room_1');
    assert.equal(result.channel, 'room_1');
  });

  it('throws when missing channel query', () => {
    assert.throws(() => parseChannelUrl('http://localhost:3456/'), /Missing channel id/);
  });

  it('throws when channel has invalid chars', () => {
    assert.throws(() => parseChannelUrl('http://localhost:3456/?channel=a b'), /Invalid channel id/);
  });
});

describe('normalizeIconPayload', () => {
  it('normalizes valid icon payload', () => {
    const payload = normalizeIconPayload([
      { name: 'rvi-star', svgContent: '<svg><path d="M0 0"/></svg>', codepoint: 0xE001 },
    ]);

    assert.equal(payload.length, 1);
    assert.equal(payload[0].name, 'rvi-star');
    assert.equal(payload[0].codepoint, 0xE001);
  });

  it('throws on empty icons', () => {
    assert.throws(() => normalizeIconPayload([]), /non-empty array/);
  });

  it('throws on invalid svg', () => {
    assert.throws(
      () => normalizeIconPayload([{ name: 'rvi-x', svgContent: 'not-svg' }]),
      /must be a valid SVG string/
    );
  });
});
