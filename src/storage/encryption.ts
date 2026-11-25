import { z } from 'zod';
import { decodeRecords, type Records } from '../domain/model';

const iterations = 600_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const alphabet = /^[A-Za-z0-9+/]+={0,2}$/;
export const maximumFileBytes = 32 * 1024 * 1024;
const base64 = z.string().regex(alphabet).refine(value => value.length % 4 === 0);
const envelopeSchema = z.object({
  format: z.enum(['akisync-vault', 'akisync-backup']),
  version: z.literal(1),
  salt: base64.length(24),
  iv: base64.length(16),
  payload: base64.min(24),
});

type Format = z.infer<typeof envelopeSchema>['format'];
type Envelope = z.infer<typeof envelopeSchema>;
export type EncryptionKey = { salt: Uint8Array<ArrayBuffer>; key: CryptoKey };

function encode(bytes: Uint8Array): string {
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 8_192) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 8_192)));
  }
  return btoa(chunks.join(''));
}

function decode(encoded: string): Uint8Array<ArrayBuffer> {
  const raw = atob(encoded);
  return Uint8Array.from(raw, char => char.charCodeAt(0));
}

export function requirePassphrase(passphrase: string) {
  if ([...passphrase.trim()].length < 12) throw new Error('Use a passphrase with at least 12 characters.');
  if (passphrase.length > 256) throw new Error('Use a passphrase with 256 characters or fewer.');
}

export async function deriveKey(passphrase: string, salt = crypto.getRandomValues(new Uint8Array(16))): Promise<EncryptionKey> {
  const raw = encoder.encode(passphrase);
  try {
    const material = await crypto.subtle.importKey('raw', raw, 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, material,
      { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
    );
    return { salt, key };
  } finally {
    raw.fill(0);
  }
}

function authHeader(format: Format, salt: string) {
  return encoder.encode(`${format}/1/pbkdf2-sha256/${iterations}/aes-256-gcm/${salt}`);
}

export async function sealRecords(records: Records, key: EncryptionKey, format: Format): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const salt = encode(key.salt);
  const plain = encoder.encode(JSON.stringify(records));
  try {
    const payload = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: authHeader(format, salt) }, key.key, plain);
    const result = JSON.stringify({ format, version: 1, salt, iv: encode(iv), payload: encode(new Uint8Array(payload)) });
    if (result.length > maximumFileBytes) throw new Error('The encrypted records exceed the current 32 MiB vault limit.');
    return result;
  } finally {
    plain.fill(0);
  }
}

export function readEnvelope(serialized: string, format: Format): Envelope {
  try {
    if (serialized.length > maximumFileBytes) throw new Error();
    const envelope = envelopeSchema.parse(JSON.parse(serialized));
    if (envelope.format !== format || decode(envelope.salt).length !== 16 || decode(envelope.iv).length !== 12) throw new Error();
    return envelope;
  } catch {
    throw new Error(format === 'akisync-backup' ? 'Choose a supported AkiSync encrypted backup.' : 'The encrypted vault format is invalid.');
  }
}

export async function keyForEnvelope(passphrase: string, envelope: Envelope) {
  if (!passphrase || passphrase.length > 256) throw new Error('Enter the passphrase.');
  return deriveKey(passphrase, decode(envelope.salt));
}

export async function openRecords(envelope: Envelope, key: EncryptionKey): Promise<Records> {
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt({
      name: 'AES-GCM', iv: decode(envelope.iv), additionalData: authHeader(envelope.format, envelope.salt),
    }, key.key, decode(envelope.payload));
  } catch {
    throw new Error('The passphrase is incorrect or the encrypted file was changed.');
  }
  try {
    return decodeRecords(JSON.parse(decoder.decode(plaintext)));
  } finally {
    new Uint8Array(plaintext).fill(0);
  }
}

export async function makeBackup(records: Records, passphrase: string) {
  requirePassphrase(passphrase);
  return sealRecords(records, await deriveKey(passphrase), 'akisync-backup');
}

export async function readBackup(serialized: string, passphrase: string) {
  const envelope = readEnvelope(serialized, 'akisync-backup');
  return openRecords(envelope, await keyForEnvelope(passphrase, envelope));
}
