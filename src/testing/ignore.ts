import { matchesPattern, type Pattern } from './patterns.js';

/**
 * A plain pattern ignores an entry when it matches the message text **or** the location.
 * An object ignores an entry only when every given field matches, e.g. one message from
 * one script.
 */
export type IgnoreRule = Pattern | { message?: Pattern; location?: Pattern };

export type IgnoreCandidate = {
  text: string;
  location?: string;
};

const matchesRule = ({ text, location = '' }: IgnoreCandidate, rule: IgnoreRule): boolean => {
  if (typeof rule === 'string' || rule instanceof RegExp) {
    return matchesPattern(text, rule) || (location !== '' && matchesPattern(location, rule));
  }

  // An empty object would otherwise match everything and silently disable the check.
  if (rule.message === undefined && rule.location === undefined) {
    return false;
  }

  return (
    (rule.message === undefined || matchesPattern(text, rule.message)) &&
    (rule.location === undefined || matchesPattern(location, rule.location))
  );
};

export const isIgnored = (candidate: IgnoreCandidate, rules: readonly IgnoreRule[]): boolean =>
  rules.some((rule) => matchesRule(candidate, rule));
