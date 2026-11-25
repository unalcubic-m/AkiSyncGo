import { addDays, localDate } from '../../src/domain/dates';
import { decodeRecords, type Records, type Wait } from '../../src/domain/model';
import { fictionalRecords } from '../../src/storage/fixtures';
import { phoneSnapshotKey, readRecordsSnapshot, type Repository } from '../../src/storage/repository';

const phoneSnapshot = sessionStorage.getItem(phoneSnapshotKey);
export const hasPhoneSnapshot = phoneSnapshot !== null;
export const usingPhone = hasPhoneSnapshot && new URLSearchParams(location.search).get('data') !== 'synthetic';
const draftKey = usingPhone ? 'akisync-lab-returns-phone-draft' : 'akisync-lab-returns-synthetic-draft';
const stored = sessionStorage.getItem(draftKey) ?? (usingPhone ? phoneSnapshot : null);
let records = stored ? readRecordsSnapshot(stored).records : syntheticLabRecords();

function syntheticLabRecords(now = new Date()): Records {
  const sample = fictionalRecords(now);
  const today = localDate(now);
  const yesterday = addDays(today, -1);
  const lab = (id: string, patientId: string, title: string, endedOn: string | null, blocks = true): Wait => ({
    id, patientId, title, endedOn, blocks, type: 'Laboratory return', status: endedOn ? 'Resolved' : 'Waiting',
    startedOn: addDays(today, -4), reviewOn: null, notes: '',
  });
  return {
    ...sample,
    waits: [...sample.waits.map(wait => ({ ...wait, title: 'Hastanın yanıtı bekleniyor' })),
      lab('demo-return-ready', 'demo-ada', 'Seramik kron', today, false),
      lab('demo-return-hold', 'demo-jonah', 'Gece plağı', yesterday),
      lab('demo-return-booked', 'demo-eli', 'Zirkonyum prova', yesterday),
      lab('demo-return-pending', 'demo-nora', 'Köprü provası', null)],
    appointments: sample.appointments.filter(visit => visit.id !== 'demo-2' && visit.id !== 'demo-3')
      .map(visit => visit.id === 'demo-5' ? { ...visit, date: addDays(today, 1), title: 'Köprü provası' } : visit),
  };
}

export const repository: Repository = {
  async load() { return records; },
  async update(change) {
    const next = decodeRecords(change(records));
    sessionStorage.setItem(draftKey, JSON.stringify(next));
    records = next;
    return records;
  },
};
