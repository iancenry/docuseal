import crypto from 'node:crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30;
const DIGITS = 6;
const DRIFT_STEPS = [-1, 0, 1];

export function generateBase32Secret(length = 32): string {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (const byte of bytes) {
    out += BASE32_ALPHABET[byte & 0x1f];
  }
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[=\s-]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function hotp(key: Buffer, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', key).update(msg).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const binary =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);
  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0');
}

export function totpCode(secret: string, stepOffset = 0, atMs = Date.now()): string {
  const counter = Math.floor(atMs / 1000 / STEP_SECONDS) + stepOffset;
  return hotp(base32Decode(secret), counter);
}

function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

export function verifyTotp(secret: string, token: string, atMs = Date.now()): boolean {
  const clean = token.replace(/[\s-]/g, '');
  if (!new RegExp(`^\\d{${DIGITS}}$`).test(clean)) return false;
  return DRIFT_STEPS.some((drift) => timingSafeEqual(totpCode(secret, drift, atMs), clean));
}
