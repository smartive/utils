import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getTelLink } from '../dist/links.js';

describe('getTelLink', () => {
  it('keeps a leading plus and strips other non-digits', () => {
    assert.equal(getTelLink('+1 (555) 123-4567'), 'tel:+15551234567');
  });

  it('strips a plus that is not leading', () => {
    assert.equal(getTelLink('(0)+41'), 'tel:041');
  });

  it('rejects non-string input', () => {
    assert.throws(() => getTelLink(42 as unknown as string), /must be a string/);
  });
});
