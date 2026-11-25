import { describe, expect, it } from 'vitest';
import { fictionalRecords } from '../src/storage/fixtures';
import { deriveKey, keyForEnvelope, makeBackup, openRecords, readBackup, readEnvelope, sealRecords } from '../src/storage/encryption';
import { appLockVerifier, verifyAppPassphrase } from '../src/storage/app-lock';

const password = 'fictional set of words';
const records = fictionalRecords(new Date(2026, 10, 23, 8));
const legacyRecords = { ...records, patients: [{ ...records.patients[0], name: 'Mira Arden' }, ...records.patients.slice(1)] };

describe('migration from encrypted AkiSync files', () => {
  it('unlocks the previous encrypted SQLite snapshot and normalizes patient names', async () => {
    const serialized = await sealRecords(legacyRecords, await deriveKey(password), 'akisync-vault');
    const saved = readEnvelope(serialized, 'akisync-vault');
    await expect(openRecords(saved, await keyForEnvelope('wrong passphrase', saved))).rejects.toThrow('incorrect');
    await expect(openRecords(saved, await keyForEnvelope(password, saved))).resolves.toEqual(records);
  });

  it('authenticates old backups and validates their patient links before import', async () => {
    const serialized = await makeBackup(legacyRecords, password);
    await expect(readBackup(serialized, password)).resolves.toEqual(records);
    const file = JSON.parse(serialized);
    file.payload = (file.payload.startsWith('A') ? 'B' : 'A') + file.payload.slice(1);
    await expect(readBackup(JSON.stringify(file), password)).rejects.toThrow('changed');
    const invalid = await makeBackup({ ...records, patients: [] }, password);
    await expect(readBackup(invalid, password)).rejects.toThrow('missing patient');
  });
});

it('checks the optional app passphrase independently of the records', async () => {
  const verifier = await appLockVerifier(password);
  expect(verifier).not.toContain(password);
  await expect(verifyAppPassphrase(password, verifier)).resolves.toBeUndefined();
  await expect(verifyAppPassphrase(password + ' wrong', verifier)).rejects.toThrow('incorrect');
});
