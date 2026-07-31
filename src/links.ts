/**
 * Converts a phone number into a `tel:` link.
 *
 * @param phoneNumber Phone number
 * @returns `tel:` link for the phone number
 */
export const getTelLink = (phoneNumber: string): string => {
  if (typeof phoneNumber !== 'string') {
    throw new Error('Phone number must be a string.');
  }

  const trimmed = phoneNumber.trim();
  const hasLeadingPlus = trimmed.startsWith('+');
  // Preserve only a leading '+'; strip all other non-digit characters.
  const digits = trimmed.replace(/\D/g, '');

  return `tel:${hasLeadingPlus ? `+${digits}` : digits}`;
};
