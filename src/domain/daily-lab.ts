import { t } from '../i18n';
import { uppercasePatientName, type Patient, type Records, type Wait } from './model';
import type { LabResult } from './notification-settings';
import { normalizePatientSearch } from './workflows';

export const labRoute = '/daily-lab';
export const labFollowUpsRoute = '/work?view=responses';
export const labNotificationUrl = 'akisync://daily-lab';

export const labResultMessage = (result: LabResult) => ({
  finished: 'Today’s laboratory check is complete.',
  nothing: 'No laboratory work arrived today.',
  dismissed: 'Laboratory check dismissed for today.',
} as const)[result];

export function labResultToday(records: Records, today: string) {
  return records.dailyLabCheck?.date === today ? records.dailyLabCheck.result : undefined;
}

export function pendingLabs(records: Records) {
  return records.waits.filter(wait => wait.type === 'Laboratory return' && wait.status === 'Waiting');
}

export function confirmedLabs(records: Records, date: string) {
  return records.waits.filter(wait => wait.type === 'Laboratory return' && wait.status === 'Resolved' && wait.endedOn === date);
}

export function confirmLab(records: Records, id: string, today: string): Records {
  return { ...records, waits: records.waits.map(wait => wait.id === id && wait.type === 'Laboratory return' && wait.status === 'Waiting'
    ? { ...wait, status: 'Resolved', endedOn: today } : wait) };
}

const compareName = (name: string) => normalizePatientSearch(name).trim().replace(/\s+/g, ' ');
export function exactLabPatientMatches(patients: Patient[], name: string) {
  return patients.filter(patient => compareName(patient.name) === compareName(name));
}

export function confirmPatientLab(records: Records, patientId: string, today: string, taskId: string): Records {
  if (!records.patients.some(patient => patient.id === patientId)) throw new Error('This patient could not be found.');
  const pending = pendingLabs(records).find(wait => wait.patientId === patientId);
  if (pending) return confirmLab(records, pending.id, today);
  if (confirmedLabs(records, today).some(wait => wait.patientId === patientId)) return records;
  const done: Wait = { id: taskId, patientId, title: t('Lab check'), type: 'Laboratory return', status: 'Resolved',
    startedOn: today, reviewOn: null, endedOn: today, blocks: false, notes: '' };
  return { ...records, waits: [...records.waits, done] };
}

export function createLabPatient(records: Records, name: string, today: string, id: string, taskId: string): Records {
  const patient: Patient = { id, name: uppercasePatientName(name), phone: '', email: '', priority: 'Normal', status: 'Active',
    createdOn: today, priorityNote: '', summary: '', nextAction: '' };
  return confirmPatientLab({ ...records, patients: [...records.patients, patient] }, id, today, taskId);
}
