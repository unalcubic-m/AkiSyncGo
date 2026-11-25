import { registerPlugin } from '@capacitor/core';
import { decodeRecords } from '../domain/model';
import { readRecordsSnapshot, type Repository } from './repository';

type Folder = { name: string; records?: string };
type Selection<T> = { cancelled: true } | ({ cancelled: false } & T);

type RecordsPlugin = {
  configuration(): Promise<{ folder?: string; verifier?: string; legacy: boolean }>;
  setVerifier(options: { verifier: string | null }): Promise<void>;
  chooseFolder(): Promise<Selection<{ uri: string }>>;
  inspectFolder(options: { uri: string }): Promise<Folder>;
  setFolder(options: { uri: string; seed?: string; adopted?: string; migrated?: boolean }): Promise<{ name: string }>;
  readRecords(): Promise<{ revision: number; records: string }>;
  writeRecords(options: { revision: number; records: string }): Promise<void>;
  readLegacy(): Promise<{ encrypted?: string }>;
  chooseRecordsFile(options: { kind: 'patient-list' | 'legacy-backup' }): Promise<Selection<{ content: string }>>;
};

export const bridge = registerPlugin<RecordsPlugin>('AkiSyncRecords');

export const folderRepository: Repository = {
  async load() {
    const row = await bridge.readRecords();
    const { records, repaired } = readRecordsSnapshot(row.records);
    if (repaired) {
      try {
        await bridge.writeRecords({ revision: row.revision, records: repaired });
      } catch {
        // Keep the records usable and prefer any newer revision. The next open or save can persist the names.
        const latest = await bridge.readRecords().catch(() => row);
        return decodeRecords(JSON.parse(latest.records));
      }
    }
    return records;
  },
  async update(change) {
    const row = await bridge.readRecords();
    const next = decodeRecords(change(decodeRecords(JSON.parse(row.records))));
    await bridge.writeRecords({ revision: row.revision, records: JSON.stringify(next) });
    return next;
  },
};
