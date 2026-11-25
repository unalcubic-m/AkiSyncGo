import { describe, expect, it } from 'vitest';
import { confirmLab } from '../src/domain/daily-lab';
import { labClearedPatientIds, trackLabClearance } from '../src/domain/lab-planning';
import { decodeRecords, emptyRecords, type Patient, type Records, type Task, type Visit, type Wait } from '../src/domain/model';

const today = '2026-11-25';
const patient: Patient = { id: 'demo', name: 'ADA', phone: '', email: '', status: 'Active', priority: 'Normal',
  priorityNote: '', createdOn: '2026-11-01', summary: '', nextAction: '' };
const wait: Wait = { id: 'lab', patientId: patient.id, title: 'Lab work', type: 'Laboratory return', status: 'Waiting',
  startedOn: '2026-11-10', reviewOn: null, endedOn: null, blocks: true, notes: '' };
const task: Task = { id: 'task', patientId: patient.id, title: 'Confirm details', notes: '', completedOn: null, blocks: true };
const visit: Visit = { id: 'visit', patientId: patient.id, date: today, start: '09:00', end: '10:00', title: 'Review',
  kind: 'Visit', status: 'Scheduled', procedure: '', notes: '', exceptions: [] };
const records: Records = { ...emptyRecords(), patients: [patient], waits: [wait] };

function completeTask(snapshot: Records, completedOn = today): Records {
  return { ...snapshot, tasks: [{ ...task, completedOn }] };
}

function roundTrip(snapshot: Records) {
  return decodeRecords(JSON.parse(JSON.stringify(snapshot)));
}

describe('Planning LabCheck filter', () => {
  it('uses older records when the last recorded blocker was a completed LabCheck', () => {
    const older = roundTrip(confirmLab(records, wait.id, '2026-11-24'));
    expect(older.labPlanning).toBeUndefined();
    expect(labClearedPatientIds(completeTask(older, '2026-11-23'), today)).toEqual(new Set([patient.id]));
    expect(labClearedPatientIds(completeTask(older, '2026-11-24'), today)).toEqual(new Set());
    expect(labClearedPatientIds(completeTask(older), today)).toEqual(new Set());
    expect(labClearedPatientIds({ ...older, tasks: [task] }, today)).toEqual(new Set());
    expect(labClearedPatientIds({ ...older, appointments: [visit] }, today)).toEqual(new Set());
  });

  it('excludes nonblocking and cancelled LabChecks from older records', () => {
    const older = confirmLab(records, wait.id, '2026-11-24');
    expect(labClearedPatientIds({ ...older, waits: [{ ...older.waits[0], blocks: false }] }, today)).toEqual(new Set());
    expect(labClearedPatientIds({ ...older, waits: [{ ...older.waits[0], status: 'Cancelled' }] }, today)).toEqual(new Set());
  });

  it('remembers that the lab completion cleared the last blocker on the same day', () => {
    const bothOpen = { ...records, tasks: [task] };
    const taskDone = trackLabClearance(bothOpen, completeTask(bothOpen), today);
    const ready = roundTrip(trackLabClearance(taskDone, confirmLab(taskDone, wait.id, today), today));
    expect(ready.labPlanning).toEqual({ [patient.id]: true });
    expect(labClearedPatientIds(ready, '2026-11-26')).toEqual(new Set([patient.id]));
  });

  it('keeps a patient in the regular list if another blocker clears after the lab', () => {
    const bothOpen = { ...records, tasks: [task] };
    const labDone = trackLabClearance(bothOpen, confirmLab(bothOpen, wait.id, '2026-11-24'), '2026-11-24');
    expect(labClearedPatientIds(labDone, today)).toEqual(new Set());
    const ready = trackLabClearance(labDone, completeTask(labDone), today);
    expect(ready.labPlanning).toEqual({ [patient.id]: false });
    expect(labClearedPatientIds(ready, today)).toEqual(new Set());
  });

  it('does not reuse a clearance from a previous period of readiness', () => {
    const ready = trackLabClearance(records, confirmLab(records, wait.id, today), today);
    const booked = trackLabClearance(ready, { ...ready, appointments: [visit] }, today);
    expect(labClearedPatientIds(booked, today)).toEqual(new Set());
    expect(labClearedPatientIds(booked, '2026-11-26')).toEqual(new Set());
    const deleted = trackLabClearance(booked, { ...booked, patients: [], appointments: [], waits: [] }, today);
    expect(deleted.labPlanning).toBeUndefined();
  });
});
