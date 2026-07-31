import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parse } from 'graphql';
import { generateQueryId, parseXCacheTagsResponseHeader } from '../dist/cache-tags/utils.js';

const document = parse('{ item { id } }');

describe('parseXCacheTagsResponseHeader', () => {
  it('parses space-delimited tags', () => {
    assert.deepEqual(parseXCacheTagsResponseHeader('tag-a tag-2 other-tag'), ['tag-a', 'tag-2', 'other-tag']);
  });

  it('filters empty tags from repeated whitespace', () => {
    assert.deepEqual(parseXCacheTagsResponseHeader('tag-a  tag-b'), ['tag-a', 'tag-b']);
    assert.deepEqual(parseXCacheTagsResponseHeader('tag-a '), ['tag-a']);
    assert.deepEqual(parseXCacheTagsResponseHeader(''), []);
  });

  it('returns an empty array for nullish input', () => {
    assert.deepEqual(parseXCacheTagsResponseHeader(null), []);
    assert.deepEqual(parseXCacheTagsResponseHeader(undefined), []);
  });
});

describe('generateQueryId', () => {
  it('produces the same ID for equivalent variable key orders', () => {
    const left = generateQueryId(document, { a: 1, nested: { b: 2, c: 3 } });
    const right = generateQueryId(document, { nested: { c: 3, b: 2 }, a: 1 });

    assert.equal(left, right);
  });

  it('normalizes Headers, record, and tuple header inputs', () => {
    const fromHeaders = generateQueryId(
      document,
      undefined,
      new Headers([
        ['Authorization', 'Bearer token'],
        ['X-Locale', 'en'],
      ]),
    );
    const fromRecord = generateQueryId(document, undefined, {
      'x-locale': 'en',
      authorization: 'Bearer token',
    });
    const fromTuples = generateQueryId(document, undefined, [
      ['X-Locale', 'en'],
      ['Authorization', 'Bearer token'],
    ]);

    assert.equal(fromHeaders, fromRecord);
    assert.equal(fromHeaders, fromTuples);
  });

  it('changes the ID when authorization headers differ', () => {
    const left = generateQueryId(document, undefined, new Headers({ Authorization: 'Bearer abc' }));
    const right = generateQueryId(document, undefined, new Headers({ Authorization: 'Bearer xyz' }));
    const empty = generateQueryId(document, undefined, new Headers());

    assert.notEqual(left, right);
    assert.notEqual(left, empty);
  });

  it('frames document, variables, and headers to avoid concatenation collisions', () => {
    const left = generateQueryId(document, { value: 'a' }, { 'x-test': 'bc' });
    const right = generateQueryId(document, { value: 'ab' }, { 'x-test': 'c' });

    assert.notEqual(left, right);
  });
});
