import { z } from 'zod';
import { patientStatuses, uppercasePatientName, type Patient, type Records } from './model';
import { normalizePatientSearch } from './workflows';

const roster = z.strictObject({
  format: z.literal('akisync-patient-list'),
  version: z.literal(1),
  patients: z.array(z.strictObject({
    name: z.string().trim().min(1).max(255).regex(/[\p{L}\p{N}]/u).transform(uppercasePatientName),
    status: z.enum(patientStatuses),
  })).min(1).max(5_000),
});

type RosterEntry = z.infer<typeof roster>['patients'][number];
const nameKey = (name: string) => normalizePatientSearch(name).trim().replace(/\s+/g, ' ');

export function readPatientList(raw: string): RosterEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.replace(/^\uFEFF/, ''));
  } catch {
    throw new Error('Choose a valid AkiSync patient list in JSON format.');
  }
  const result = roster.safeParse(parsed);
  if (!result.success) throw new Error('Choose an AkiSync patient list with valid names and Active or Passive status.');
  const entries = result.data.patients;
  if (new Set(entries.map(patient => nameKey(patient.name))).size !== entries.length) {
    throw new Error('The list repeats a patient name. Check the list before importing.');
  }
  return entries;
}

export function planPatientImport(records: Records, entries: RosterEntry[]) {
  const existing = new Set(records.patients.map(patient => nameKey(patient.name)));
  const additions = entries.filter(patient => !existing.has(nameKey(patient.name)));
  const active = additions.filter(patient => patient.status === 'Active').length;
  return { additions, active, passive: additions.length - active, skipped: entries.length - additions.length };
}

export function addPatientsFromList(records: Records, entries: RosterEntry[], today: string, createId: () => string) {
  const { additions } = planPatientImport(records, entries);
  const patients: Patient[] = additions.map(({ name, status }) => ({
    id: createId(),
    name,
    status,
    phone: '',
    email: '',
    priority: 'Normal',
    priorityNote: '',
    createdOn: today,
    summary: '',
    nextAction: '',
  }));
  return { ...records, patients: [...records.patients, ...patients] };
}

export function deletePatient(records: Records, patientId: string): Records {
  if (!records.patients.some(patient => patient.id === patientId)) throw new Error('This patient is already unavailable.');
  const belongsToAnotherPatient = (record: { patientId: string | null }) => record.patientId !== patientId;
  return {
    ...records,
    patients: records.patients.filter(patient => patient.id !== patientId),
    appointments: records.appointments.filter(belongsToAnotherPatient),
    notes: records.notes.filter(belongsToAnotherPatient),
    treatments: records.treatments.filter(belongsToAnotherPatient),
    alerts: records.alerts.filter(belongsToAnotherPatient),
    waits: records.waits.filter(belongsToAnotherPatient),
    tasks: records.tasks.filter(belongsToAnotherPatient),
  };
}
