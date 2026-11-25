import { decodeRecords, type RecordChange, type Records } from '../domain/model';
import { fictionalRecords } from './fixtures';

export interface Repository {
  load(): Promise<Records>;
  update(change: RecordChange): Promise<Records>;
}

export function readRecordsSnapshot(serialized: string) {
  const source: Records = JSON.parse(serialized);
  const records = decodeRecords(source);
  if (records.patients.every((patient, index) => patient.name === source.patients[index].name)) return { records };

  return {
    records,
    repaired: JSON.stringify({
      ...source,
      patients: source.patients.map((patient, index) => ({ ...patient, name: records.patients[index].name })),
    }),
  };
}

const fictionalPreviewKey = 'akisync-fictional-preview-v1';
export const phoneSnapshotKey = 'akisync-phone-preview-v1';

export class PreviewRepository implements Repository {
  constructor(private readonly storage: Storage = localStorage, private readonly key = fictionalPreviewKey) {}

  async load(): Promise<Records> {
    const saved = this.storage.getItem(this.key);
    if (!saved) return fictionalRecords();
    const { records, repaired } = readRecordsSnapshot(saved);
    if (repaired) this.storage.setItem(this.key, repaired);
    return records;
  }

  async update(change: RecordChange): Promise<Records> {
    const records = decodeRecords(change(await this.load()));
    this.storage.setItem(this.key, JSON.stringify(records));
    return records;
  }

  reset() {
    this.storage.removeItem(this.key);
  }
}
