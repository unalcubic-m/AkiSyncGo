import { describe, expect, it } from 'vitest';
import { decodeRecords } from '../src/domain/model';
import { addPatientsFromList, deletePatient, planPatientImport, readPatientList } from '../src/domain/patient-management';
import { fictionalRecords } from '../src/storage/fixtures';
import { readRecordsSnapshot } from '../src/storage/repository';

const today = '2026-11-23';
const fixture = () => fictionalRecords(new Date(2026, 10, 23, 8));
const list = (patients: unknown) => JSON.stringify({ format: 'akisync-patient-list', version: 1, patients });

describe('patient list import', () => {
  it('preserves matching records, keeps supplied statuses and is safe to repeat', () => {
    const records = fixture();
    const entries = readPatientList(list([
      { name: 'Míra  Arden', status: 'Passive' },
      { name: 'Fictional Active Roster', status: 'Active' },
      { name: 'Fictional Passive Roster', status: 'Passive' },
    ]));
    expect(planPatientImport(records, entries)).toMatchObject({ active: 1, passive: 1, skipped: 1 });
    let nextId = 0;
    const imported = decodeRecords(addPatientsFromList(records, entries, today, () => 'import-' + nextId++));
    expect(imported.patients.find(item => item.id === 'demo-mira')).toEqual(records.patients.find(item => item.id === 'demo-mira'));
    expect(imported.patients.slice(-2).map(({ name, status, createdOn }) => ({ name, status, createdOn }))).toEqual([
      { name: 'FİCTİONAL ACTİVE ROSTER', status: 'Active', createdOn: today },
      { name: 'FİCTİONAL PASSİVE ROSTER', status: 'Passive', createdOn: today },
    ]);
    expect(imported.appointments).toEqual(records.appointments);
    expect(addPatientsFromList(imported, entries, today, () => 'unused')).toEqual(imported);
  });

  it('rejects unrecognized lists, invalid states, and duplicate names', () => {
    expect(() => readPatientList('{"patients":[]}')).toThrow('valid names');
    expect(() => readPatientList(list([{ name: 'Fictional Archive', status: 'Closed' }]))).toThrow('Active or Passive');
    expect(() => readPatientList(list([
      { name: 'Fictional İrem', status: 'Active' },
      { name: 'fictional  irem', status: 'Passive' },
    ]))).toThrow('repeats a patient name');
  });
});

it('deletes all rows owned by a patient and preserves unrelated patients and blocked time', () => {
  const records = fixture();
  const deletedId = 'demo-mira';
  const task = { title: 'Prepare materials', notes: '', completedOn: null, blocks: false };
  records.tasks = [
    { ...task, id: 'patient-task', patientId: deletedId, blocks: true },
    { ...task, id: 'clinic-task', patientId: null },
  ];
  const next = decodeRecords(deletePatient(records, deletedId));
  expect(next.patients).toEqual(records.patients.filter(patient => patient.id !== deletedId));
  for (const list of ['appointments', 'notes', 'treatments', 'alerts', 'waits', 'tasks'] as const) {
    expect(next[list]).toEqual(records[list].filter(item => item.patientId !== deletedId));
    expect(next[list].every(item => item.patientId !== deletedId)).toBe(true);
  }
  expect(next.appointments.some(item => item.kind === 'Block')).toBe(true);
  expect(next.workingHours).toEqual(records.workingHours);
  expect(() => deletePatient(next, deletedId)).toThrow('already unavailable');
});

it('opens existing patient records without a tasks field', () => {
  const { tasks, ...existing } = fixture();
  expect(decodeRecords(existing)).toEqual({ ...existing, tasks });
});

it('repairs names in an existing snapshot without changing other saved fields', () => {
  const baseline = fixture();
  const { tasks, ...old } = baseline;
  const source = {
    ...old,
    patients: [
      { ...old.patients[0], name: '  i\u0307pek ışık ' },
      { ...old.patients[1], name: 'ß'.repeat(255) },
      ...old.patients.slice(2),
    ],
  };
  const { records, repaired } = readRecordsSnapshot(JSON.stringify(source));
  const patients = [
    { ...source.patients[0], name: 'İPEK IŞIK' },
    { ...source.patients[1], name: 'SS'.repeat(255) },
    ...source.patients.slice(2),
  ];
  expect(records).toEqual({ ...source, patients, tasks });
  expect(JSON.parse(repaired!)).toEqual({ ...source, patients });
  expect(readRecordsSnapshot(repaired!).repaired).toBeUndefined();
});
