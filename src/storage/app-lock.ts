import { requirePassphrase } from './encryption';

async function fingerprint(passphrase: string, salt: Uint8Array<ArrayBuffer>) {
  const secret = new TextEncoder().encode(passphrase);
  try {
    const material = await crypto.subtle.importKey('raw', secret, 'PBKDF2', false, ['deriveBits']);
    const digest = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', iterations: 600_000, salt }, material, 256);
    return btoa(String.fromCharCode(...new Uint8Array(digest)));
  } finally {
    secret.fill(0);
  }
}

export async function appLockVerifier(passphrase: string) {
  requirePassphrase(passphrase);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...salt)) + ':' + await fingerprint(passphrase, salt);
}

export async function verifyAppPassphrase(passphrase: string, verifier: string) {
  const [encodedSalt, expected] = verifier.split(':');
  const salt = Uint8Array.from(atob(encodedSalt), char => char.charCodeAt(0));
  const actual = await fingerprint(passphrase, salt);
  let different = 0;
  for (let i = 0; i < actual.length; i += 1) different |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  if (actual.length !== expected.length || different) throw new Error('The app passphrase is incorrect.');
}
