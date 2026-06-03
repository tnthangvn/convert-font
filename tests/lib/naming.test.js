'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { toKebabCase, resolveDuplicate } = require('../../lib/naming');

describe('toKebabCase', () => {
  it('keeps simple names unchanged', () => {
    assert.equal(toKebabCase('user'), 'user');
  });

  it('converts camelCase', () => {
    assert.equal(toKebabCase('calendarGrid'), 'calendar-grid');
  });

  it('converts PascalCase', () => {
    assert.equal(toKebabCase('ArrowUpRight'), 'arrow-up-right');
  });

  it('converts snake_case', () => {
    assert.equal(toKebabCase('arrow_up_right'), 'arrow-up-right');
  });

  it('collapses spaces, dots and mixed separators', () => {
    assert.equal(toKebabCase('My Icon.v2'), 'my-icon-v2');
  });

  it('strips invalid characters and trims hyphens', () => {
    assert.equal(toKebabCase('  --héllo!! --  '), 'hllo');
  });

  it('returns empty string for separator-only input', () => {
    assert.equal(toKebabCase('___'), '');
  });
});

describe('resolveDuplicate', () => {
  it('returns the base name when unique', () => {
    assert.equal(resolveDuplicate('user', []), 'user');
  });

  it('appends -1 on first collision', () => {
    assert.equal(resolveDuplicate('user', ['user']), 'user-1');
  });

  it('increments past existing suffixes', () => {
    assert.equal(resolveDuplicate('user', ['user', 'user-1', 'user-2']), 'user-3');
  });

  it('accepts a Set as existing names', () => {
    assert.equal(resolveDuplicate('star', new Set(['star'])), 'star-1');
  });
});
