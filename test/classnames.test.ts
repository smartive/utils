import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classNames } from '../dist/classnames.js';

describe('classNames', () => {
  it('joins strings and finite numbers, filtering falsy and non-finite values', () => {
    const inactive = false;
    const active = true;
    assert.equal(classNames('btn', inactive && 'btn-active', undefined, null, 'btn-primary'), 'btn btn-primary');
    assert.equal(classNames('btn', active && 'btn-active', 42), 'btn btn-active 42');
    assert.equal(classNames('', 'ok', Number.NaN, Number.POSITIVE_INFINITY), 'ok');
  });

  it('keeps the number 0 (so `count && class` emits a literal 0 class)', () => {
    const count = 0 as number;
    assert.equal(classNames(count && 'badge', 'item'), '0 item');
  });
});
