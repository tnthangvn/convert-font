'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { toKebabCase, addPrefix, resolveDuplicate, deriveIconName } = require('./naming');

describe('toKebabCase', () => {
  it('converts simple filenames', () => {
    assert.equal(toKebabCase('user'), 'user');
  });

  it('converts camelCase', () => {
    assert.equal(toKebabCase('calendarGrid'), 'calendar-grid');
  });

  it('converts PascalCase', () => {
    assert.equal(toKebabCase('CalendarGrid'), 'calendar-grid');
  });

  it('converts snake_case', () => {
    assert.equal(toKebabCase('calendar_grid'), 'calendar-grid');
  });

  it('handles mixed separators', () => {
    assert.equal(toKebabCase('arrow 2 down'), 'arrow-2-down');
  });

  it('handles already kebab-case', () => {
    assert.equal(toKebabCase('arrow-down'), 'arrow-down');
  });

  it('strips special characters', () => {
    assert.equal(toKebabCase('icon@2x!'), 'icon-2x');
  });

  it('collapses multiple hyphens', () => {
    assert.equal(toKebabCase('a--b---c'), 'a-b-c');
  });

  it('trims leading/trailing hyphens', () => {
    assert.equal(toKebabCase('-hello-'), 'hello');
  });

  it('returns empty string for empty input', () => {
    assert.equal(toKebabCase(''), '');
  });
});

describe('addPrefix', () => {
  it('adds rvi- prefix', () => {
    assert.equal(addPrefix('user'), 'rvi-user');
  });

  it('does not double-prefix', () => {
    assert.equal(addPrefix('rvi-user'), 'rvi-user');
  });

  it('supports custom prefix', () => {
    assert.equal(addPrefix('icon', 'my'), 'my-icon');
  });
});

describe('resolveDuplicate', () => {
  it('returns base name if not taken', () => {
    assert.equal(resolveDuplicate('rvi-calendar', new Set(['rvi-user'])), 'rvi-calendar');
  });

  it('appends -1 if base name is taken', () => {
    assert.equal(resolveDuplicate('rvi-user', new Set(['rvi-user'])), 'rvi-user-1');
  });

  it('appends -2 if -1 is also taken', () => {
    assert.equal(resolveDuplicate('rvi-user', new Set(['rvi-user', 'rvi-user-1'])), 'rvi-user-2');
  });

  it('handles array input', () => {
    assert.equal(resolveDuplicate('rvi-user', ['rvi-user', 'rvi-user-1', 'rvi-user-2']), 'rvi-user-3');
  });
});

describe('deriveIconName', () => {
  it('derives from simple filename', () => {
    assert.equal(deriveIconName('path/to/user.svg', []), 'rvi-user');
  });

  it('derives from kebab filename', () => {
    assert.equal(deriveIconName('./assets/calendar-grid.svg', []), 'rvi-calendar-grid');
  });

  it('handles duplicates', () => {
    const existing = new Set(['rvi-user', 'rvi-user-1', 'rvi-user-2']);
    assert.equal(deriveIconName('user.svg', existing), 'rvi-user-3');
  });

  it('handles camelCase filename', () => {
    assert.equal(deriveIconName('arrowDown.svg', []), 'rvi-arrow-down');
  });

  it('handles snake_case filename', () => {
    assert.equal(deriveIconName('arrow_up_right.svg', []), 'rvi-arrow-up-right');
  });

  it('returns rvi-glyph for empty stem', () => {
    assert.equal(deriveIconName('.svg', []), 'rvi-glyph');
  });
});
