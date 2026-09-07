// Reversible encryption for business passwords, so the platform admin can view
// the credentials it assigned. Authentication still uses a one-way bcrypt hash;
// this stored ciphertext is ONLY for admin display, gated behind the admin password.
import crypto from 'node:crypto';

const RAW = process.env.CRED_ENC_KEY ?? 'sadran-dev-cred-encryption-key-01';
// derive a stable 32-byte key from whatever secret is configured
const KEY = crypto.createHash('sha256').update(RAW).digest();

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join('.');
}

export function decryptSecret(blob: string | null | undefined): string | null {
  if (!blob) return null;
  try {
    const parts = blob.split('.');
    if (parts.length !== 3) return null;
    const [ivB, tagB, encB] = parts as [string, string, string];
    const iv = Buffer.from(ivB, 'base64');
    const tag = Buffer.from(tagB, 'base64');
    const enc = Buffer.from(encB, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
