import { newId } from '../../src/components/ui';
import { addDays, parseDate } from '../../src/domain/dates';
import { decodeRecords, uppercasePatientName, type Patient, type RecordChange, type Records, type Wait } from '../../src/domain/model';
import { normalizePatientSearch } from '../../src/domain/workflows';
import { getLocale, t } from '../../src/i18n';
import { fictionalRecords } from '../../src/storage/fixtures';
import type { Repository } from '../../src/storage/repository';

export const labRoute = '/daily-lab';
export const followUpsRoute = '/work?view=responses';
export const notificationsRoute = '/data/notifications';
export const bufferRoute = '/data/event-buffer';
export const bookingRoute = '/appointments/new?from=today';

export const copy = (en: string, tr: string) => getLocale() === 'tr' ? tr : en;
const dateInIstanbul = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Istanbul', dateStyle: 'short' });
export const previewDate = () => dateInIstanbul.format(new Date());
export const bookingDate = (today: string) => {
  const tomorrow = addDays(today, 1);
  const day = parseDate(tomorrow).getDay();
  return addDays(tomorrow, day === 6 ? 2 : day === 0 ? 1 : 0);
};

export type LabResult = 'finished' | 'nothing' | 'dismissed';
export const reopenCheckedLab = new URLSearchParams(window.location.search).get('variant') === 'inline-check';
export type BufferSettings = { enabled: boolean; minutes: number };
export type LabNotificationSettings = { enabled: boolean; time: string; days: number[] };
const everyDay = [0, 1, 2, 3, 4, 5, 6];
type PreviewData = {
  records: Records;
  notification: LabNotificationSettings;
  buffer: BufferSettings;
  check?: { date: string; result: LabResult };
};

function seed(): PreviewData {
  const today = previewDate();
  const records = fictionalRecords(parseDate(today));
  const exampleDay = bookingDate(today);
  const waits: Wait[] = [
    { id: 'lab-bridge', patientId: 'demo-mira', title: 'Zirconia bridge', type: 'Laboratory return', status: 'Waiting',
      startedOn: addDays(today, -5), reviewOn: today, endedOn: null, blocks: true, notes: '' },
    { id: 'lab-crown', patientId: 'demo-eli', title: 'Ceramic crown', type: 'Laboratory return', status: 'Waiting',
      startedOn: addDays(today, -3), reviewOn: today, endedOn: null, blocks: true, notes: '' },
    { id: 'lab-guard', patientId: 'demo-ada', title: 'Night guard', type: 'Laboratory return', status: 'Waiting',
      startedOn: addDays(today, -4), reviewOn: today, endedOn: null, blocks: true, notes: '' },
  ];
  return {
    records: {
      ...records,
      appointments: records.appointments.filter(item => item.date !== exampleDay),
      waits: [...records.waits, ...waits],
    },
    notification: { enabled: true, time: '10:00', days: everyDay },
    buffer: { enabled: true, minutes: 60 },
  };
}

const storageKey = reopenCheckedLab ? 'akisync-preview-daily-lab-inline-v1' : 'akisync-preview-daily-lab-v1';
function load(): PreviewData {
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      const { labPlanning, ...data }: PreviewData & Pick<Records, 'labPlanning'> = JSON.parse(stored);
      const days = Array.isArray(data.notification.days) ? everyDay.filter(day => data.notification.days.includes(day)) : [];
      return { ...data, records: decodeRecords({ ...data.records, labPlanning: data.records.labPlanning ?? labPlanning }), notification: {
        ...data.notification, days: days.length ? days : everyDay,
      } };
    }
  } catch { /* An unreadable preview can start from fresh fictional records. */ }
  return seed();
}

let data = load();
const listeners = new Set<() => void>();
export const snapshot = () => data;
export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function update(change: (current: PreviewData) => PreviewData) {
  data = change(data);
  try { localStorage.setItem(storageKey, JSON.stringify(data)); }
  catch { /* Keep the active preview usable if browser storage is unavailable. */ }
  listeners.forEach(listener => listener());
}

window.addEventListener('storage', event => {
  if (event.key !== storageKey) return;
  data = load();
  listeners.forEach(listener => listener());
});

export function reset() { update(seed); }
export function setCheck(date: string, result: LabResult) { update(current => ({ ...current, check: { date, result } })); }

export function saveRecords(change: RecordChange) {
  update(current => {
    return { ...current, records: decodeRecords(change(current.records)) };
  });
  return data.records;
}

export const repository: Repository = {
  async load() { return snapshot().records; },
  async update(change) { return saveRecords(change); },
};

export const labWaits = (records: Records) => records.waits.filter(wait => wait.type === 'Laboratory return');
export const pendingLabs = (records: Records) => labWaits(records).filter(wait => wait.status === 'Waiting');
export const confirmedLabs = (records: Records, date: string) => labWaits(records)
  .filter(wait => wait.status === 'Resolved' && wait.endedOn === date);

export function confirmLab(id: string, today: string) {
  saveRecords(records => ({ ...records, waits: records.waits.map(wait => wait.id === id && wait.type === 'Laboratory return'
    && wait.status === 'Waiting' ? { ...wait, status: 'Resolved', endedOn: today } : wait) }));
}

const normalizedName = (name: string) => normalizePatientSearch(name).trim().replace(/\s+/g, ' ');
export function exactNameMatches(patients: Patient[], name: string) {
  const query = normalizedName(name);
  return patients.filter(patient => normalizedName(patient.name) === query);
}

function completePatientLab(records: Records, patient: Patient, today: string) {
  const pending = pendingLabs(records).find(wait => wait.patientId === patient.id);
  if (pending) {
    return { ...records, waits: records.waits.map(wait => wait.id === pending.id
      ? { ...wait, status: 'Resolved' as const, endedOn: today } : wait) };
  }
  if (confirmedLabs(records, today).some(wait => wait.patientId === patient.id)) return records;
  const done: Wait = {
    id: newId(), patientId: patient.id, title: t('Lab check'), type: 'Laboratory return', status: 'Resolved',
    startedOn: today, reviewOn: null, endedOn: today, blocks: false, notes: '',
  };
  return { ...records, waits: [...records.waits, done] };
}

export function confirmPatient(patient: Patient, today: string) {
  saveRecords(records => completePatientLab(records, patient, today));
}

export function addPatient(first: string, last: string, today: string) {
  const name = `${first.trim().replace(/\s+/g, ' ')} ${last.trim().replace(/\s+/g, ' ')}`;
  const matches = exactNameMatches(snapshot().records.patients, name);
  if (matches.length) return { matches };
  const patient: Patient = {
    id: newId(), name: uppercasePatientName(name), phone: '', email: '', priority: 'Normal', status: 'Active',
    createdOn: today, priorityNote: '', summary: '', nextAction: '',
  };
  saveRecords(records => completePatientLab({ ...records, patients: [...records.patients, patient] }, patient, today));
  return { patient };
}
