/** A `string` matches as a substring, a `RegExp` via `test()`. */
export type Pattern = string | RegExp;

/**
 * `RegExp.prototype.test` is stateful for `g` and `y` flags (it advances `lastIndex`), so
 * the same rule would alternate between matching and not matching across calls.
 */
export const matchesPattern = (value: string, pattern: Pattern): boolean => {
  if (typeof pattern === 'string') {
    return value.includes(pattern);
  }

  pattern.lastIndex = 0;

  return pattern.test(value);
};

export const matchesAnyPattern = (value: string, patterns: readonly Pattern[]): boolean =>
  patterns.some((pattern) => matchesPattern(value, pattern));
