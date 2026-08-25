import crypto from 'node:crypto';

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const ALPHABET_LENGTH = BASE58_ALPHABET.length;

export function generateSlug(length = 12): string {
  let slug = '';
  while (slug.length < length) {
    const bytes = crypto.randomBytes(length * 2);
    for (const byte of bytes) {
      slug += BASE58_ALPHABET[byte % ALPHABET_LENGTH] ?? '';
      if (slug.length === length) break;
    }
  }
  return slug;
}
