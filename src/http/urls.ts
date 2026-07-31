const DECODED_ABSOLUTE_URL = /^[a-zA-Z][a-zA-Z\d+\-.]*:/;

const hasForbiddenPathCharacters = (url: string): boolean => {
  for (const char of url) {
    const code = char.charCodeAt(0);

    if (code <= 0x1f || code === 0x7f || char === '\\') {
      return true;
    }
  }

  return false;
};

/**
 * Returns true when `url` is a same-origin absolute path safe to use as a
 * redirect target. Rejects protocol-relative URLs, backslash tricks, control
 * characters, percent-decoded `//` / scheme prefixes, and anything that
 * resolves to a foreign origin.
 */
export const isSafeRelativePath = (url: string | null | undefined): url is string => {
  if (!url || !url.startsWith('/') || url.startsWith('//') || hasForbiddenPathCharacters(url)) {
    return false;
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(url);
  } catch {
    return false;
  }

  if (hasForbiddenPathCharacters(decoded) || decoded.startsWith('//') || DECODED_ABSOLUTE_URL.test(decoded)) {
    return false;
  }

  try {
    const parsed = new URL(url, 'https://example.invalid');

    return parsed.origin === 'https://example.invalid' && parsed.pathname.startsWith('/');
  } catch {
    return false;
  }
};
