import { describe, expect, it } from 'vitest';
import { labAppointmentsAtRisk, returnedLabPatients } from '../src/domain/lab-returns';
import type { Records, Visit, Wait } from '../src/domain/model';
import { fictionalRecords } from '../src/storage/fixtures';

const now = new Date(2026, 10, 23, 12);
const today = '2026-11-23';
const yesterday = '2026-11-22';
const tomorrow = '2026-11-24';
const base = { ...fictionalRecords(now), waits: [], appointments: [] } satisfies Records;

function lab(id: string, patientId: string, endedOn: string | null, overrides: Partial<Wait> = {}): Wait {
  return { id, patientId, title: id, type: 'Laboratory return', status: endedOn ? 'Resolved' : 'Waiting',
    startedOn: '2026-11-20', reviewOn: null, endedOn, blocks: true, notes: '', ...overrides };
}

function visit(id: string, patientId: string, date: string, overrides: Partial<Visit> = {}): Visit {
  return { id, patientId, date, kind: 'Visit', status: 'Scheduled', start: '09:00', end: '10:00',
    title: id, notes: '', procedure: '', exceptions: [], ...overrides };
}

describe('patients with work returned from lab', () => {
  it('groups manual returns alongside earlier work and ignores old filter flags', () => {
    const profile = 'demo-ada';
    const records = { ...base, labPlanning: { [profile]: false }, waits: [
      lab('older', profile, yesterday), lab('manual', profile, today, { blocks: false }),
      lab('pending', profile, null, { blocks: false }), lab('cancelled', profile, today, { status: 'Cancelled' }),
    ], appointments: [visit('initial', profile, '2026-11-21', { status: 'Completed' })] };
    const { ready } = returnedLabPatients(records, today, now);
    expect(ready.map(row => row.jobs.map(job => job.id))).toEqual([['manual', 'older']]);

    const next = { ...records, appointments: [...records.appointments, visit('follow-up', profile, yesterday, { status: 'Completed' })] };
    expect(returnedLabPatients(next, today, now).ready[0].jobs.map(job => job.id)).toEqual(['manual']);
    next.appointments.push(visit('same-day', profile, today, { status: 'Completed' }));
    expect(returnedLabPatients(next, today, now)).toEqual({ ready: [], booked: [], blocked: [] });
  });

  it('keeps booked work through the visit outcome and shows a remaining hold after cancellation', () => {
    const profile = 'demo-eli';
    const task = { id: 'hold', patientId: profile, title: 'Call first', notes: '', completedOn: null, blocks: true };
    const scheduled = visit('booked', profile, today);
    const records: Records = { ...base, waits: [lab('returned', profile, yesterday)], tasks: [task], appointments: [scheduled] };
    expect(returnedLabPatients(records, today, now)).toMatchObject({ ready: [], blocked: [],
      booked: [{ visit: scheduled, outcomePending: true }] });

    const future = visit('next', profile, tomorrow);
    expect(returnedLabPatients({ ...records, appointments: [scheduled, future] }, today, now).booked[0])
      .toMatchObject({ visit: future, outcomePending: false });
    for (const status of ['Cancelled', 'Postponed', 'No-show'] as const) {
      expect(returnedLabPatients({ ...records, appointments: [{ ...scheduled, status }] }, today, now))
        .toMatchObject({ ready: [], booked: [], blocked: [{ holds: [{ id: task.id }], jobs: [{ id: 'returned' }] }] });
    }
  });
});

it('warns for today and tomorrow only while a visit has a blocking lab follow-up', () => {
  const profile = 'demo-ada';
  const pending = lab('pending', profile, null);
  const records: Records = { ...base, waits: [pending, lab('advisory', 'demo-eli', null, { blocks: false })], appointments: [
    visit('tomorrow', profile, tomorrow), visit('today', profile, today), visit('later', profile, '2026-11-25'),
    visit('yesterday', profile, yesterday), visit('advisory', 'demo-eli', tomorrow),
    visit('cancelled', profile, tomorrow, { status: 'Cancelled' }),
  ] };
  expect(labAppointmentsAtRisk(records, today).map(({ visit, jobs }) => [visit.id, jobs[0].id]))
    .toEqual([['today', 'pending'], ['tomorrow', 'pending']]);
  expect(labAppointmentsAtRisk({ ...records, waits: [{ ...pending, status: 'Resolved', endedOn: today }] }, today)).toEqual([]);
});
