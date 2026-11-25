import { dismissBookingCallback, requestBookingCallback } from '../../src/domain/booking-callbacks';
import { addDays, localDate } from '../../src/domain/dates';
import { decodeRecords, type Records, type Visit, type Wait } from '../../src/domain/model';
import { fictionalRecords } from '../../src/storage/fixtures';
import type { Repository } from '../../src/storage/repository';

const consultationId = 'preview-consultation-reply';

function seed(now = new Date()): Records {
  const today = localDate(now);
  const tomorrow = addDays(today, 1);
  const sample = fictionalRecords(now);
  const visit = (id: string, patientId: string, title: string, start: string, end: string): Visit => ({
    id, patientId, title, kind: 'Visit', status: 'Scheduled', start, end, date: tomorrow, notes: '', procedure: '', exceptions: [],
  });
  const wait = (id: string, patientId: string, title: string, type: Wait['type'], endedOn: string | null): Wait => ({
    id, patientId, title, type, endedOn, status: endedOn ? 'Resolved' : 'Waiting',
    startedOn: addDays(today, -4), reviewOn: null, notes: '', blocks: true,
  });
  return {
    ...sample,
    appointments: [
      visit('preview-patient-reply-visit', 'demo-jonah', 'Kontrol randevusu', '09:30', '10:15'),
      visit('preview-lab-visit', 'demo-nora', 'Köprü provası', '11:00', '11:45'),
    ],
    waits: [
      wait('preview-patient-reply', 'demo-jonah', 'Hasta yanıtı bekleniyor', 'Patient reply', null),
      wait('preview-pending-lab', 'demo-nora', 'Köprü provası laboratuvardan bekleniyor', 'Laboratory return', null),
      wait('preview-returned-lab', 'demo-ada', 'Seramik kron', 'Laboratory return', today),
      wait(consultationId, 'demo-mira', 'Konsültasyon sonucu', 'Consultation', today),
    ],
  };
}

const key = 'akisync-appointment-follow-up-synthetic';
type Draft = { records: Records; closedCalls?: string[] };

function load(): Records {
  const stored = sessionStorage.getItem(key);
  const draft: Draft = stored ? JSON.parse(stored) : { records: seed() };
  let records = decodeRecords(draft.records);
  const today = localDate();
  // Keep confirmations made in the first version of the synthetic preview.
  for (const id of draft.closedCalls ?? []) {
    const wait = records.waits.find(item => item.id === id);
    const patient = records.patients.find(item => item.id === wait?.patientId);
    if (patient && wait?.endedOn) {
      records = dismissBookingCallback(records, {
        patient, returns: wait.type === 'Laboratory return' ? [{ ...wait, endedOn: wait.endedOn }] : [],
      }, today, 'preview-closed-call-' + id, 'Randevu için aranacak');
    }
  }
  const consultation = records.waits.find(wait => wait.id === consultationId);
  if (consultation && !records.tasks.some(task => task.patientId === consultation.patientId && task.bookingCallback)) {
    records = requestBookingCallback(records, consultation.patientId, 'preview-consultation-callback', 'Randevu için aranacak');
  }
  return records;
}

let records = load();
export const repository: Repository = {
  async load() { return records; },
  async update(change) {
    const next = decodeRecords(change(records));
    sessionStorage.setItem(key, JSON.stringify({ records: next }));
    records = next;
    return records;
  },
};
