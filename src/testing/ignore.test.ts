import { describe, expect, it } from 'vitest';

import { isIgnored } from './ignore.js';

describe('isIgnored', () => {
  const entry = { text: 'Error: no level with compatible codecs found', location: 'https://cdn.example.com/player.js' };

  it('matches a string rule against the text', () => {
    expect(isIgnored(entry, ['compatible codecs'])).toBe(true);
  });

  it('matches a plain rule against the location', () => {
    expect(isIgnored(entry, ['cdn.example.com'])).toBe(true);
    expect(isIgnored(entry, [/player\.js$/])).toBe(true);
  });

  it('does not ignore unmatched entries', () => {
    expect(isIgnored(entry, ['hydration', /usercentrics/])).toBe(false);
    expect(isIgnored(entry, [])).toBe(false);
  });

  it('requires every field of an object rule to match', () => {
    expect(isIgnored(entry, [{ message: 'codecs', location: 'cdn.example.com' }])).toBe(true);
    expect(isIgnored(entry, [{ message: 'codecs', location: 'other.example.com' }])).toBe(false);
    expect(isIgnored(entry, [{ location: /cdn\./ }])).toBe(true);
  });

  it('never ignores with an empty object rule', () => {
    expect(isIgnored(entry, [{}])).toBe(false);
  });

  it('handles entries without a location', () => {
    expect(isIgnored({ text: 'boom' }, ['example.com'])).toBe(false);
    expect(isIgnored({ text: 'boom' }, [{ location: 'x' }])).toBe(false);
  });
});
