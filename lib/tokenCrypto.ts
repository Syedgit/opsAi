import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

/**
 * Encrypt secrets at rest (Gmail refresh tokens).
 * Key = SHA-256 of TOKEN_ENCRYPTION_KEY or JWT_SECRET (32 bytes).
 */

function keyBytes(): Buffer {
  const raw =
    process.env.TOKEN_ENCRYPTION_KEY?.trim() ||
    process.env.JWT_SECRET?.trim() ||
    '';
  if (!raw) {
    throw new Error('TOKEN_ENCRYPTION_KEY or JWT_SECRET is required to encrypt connector tokens');
  }
  return createHash('sha256').update(raw).digest();
}

/** Returns base64url(iv + ciphertext + authTag). */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyBytes(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, enc, tag]).toString('base64url');
}

export function decryptSecret(payload: string): string {
  const buf = Buffer.from(payload, 'base64url');
  if (buf.length < 12 + 16) throw new Error('Invalid ciphertext');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(buf.length - 16);
  const data = buf.subarray(12, buf.length - 16);
  const decipher = createDecipheriv('aes-256-gcm', keyBytes(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}
