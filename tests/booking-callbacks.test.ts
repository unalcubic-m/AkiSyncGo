import { expect, it } from 'vitest';
import { bookingCallbacksDue, dismissBookingCallback, requestBookingCallback, updateCallbacksForBookings } from '../src/domain/booking-callbacks';
import { decodeRecords, type Records, type Visit, type Wait } from '../src/domain/model';
import { openTasks } from '../src/domain/workflows';
import { fictionalRecords } from '../src/storage/fixtures';

const now = new Date(2026, 10, 23, 9);
const today = '2026-11-23';
const patientId = 'demo-ada';
const base: Records = { ...fictionalRecords(now), waits: [], appointments: [] };
const returned: Wait = { id: 'job', patientId, title: 'Crown', type: 'Laboratory return', status: 'Resolved',
  startedOn: '2026-11-20', reviewOn: null, endedOn: today, blocks: false, notes: '' };
const hold: Wait = { ...returned, id: 'hold', type: 'Patient reply', status: 'Waiting', endedOn: null, blocks: true };
const visit: Visit = { id: 'visit', patientId, title: 'Follow-up', status: 'Scheduled', kind: 'Visit',
  date: '2026-11-24', start: '09:00', end: '10:00', notes: '', procedure: '', exceptions: [] };
const due = (records: Records) => bookingCallbacksDue(records, today, now);

it('queues returned lab work once per ready patient and remembers explicitly dismissed returns', () => {
  expect(due({ ...base, waits: [returned, hold] })).toEqual([]);
  const second = { ...returned, id: 'second-job' };
  const records = { ...base, waits: [returned, second] };
  const callbacks = due(records);
  expect(callbacks).toHaveLength(1);
  expect(callbacks[0].returns.map(job => job.id)).toEqual(['job', 'second-job']);

  const dismissed = decodeRecords(dismissBookingCallback(records, callbacks[0], today, 'callback', 'Appointment callback'));
  expect(due(dismissed)).toEqual([]);
  expect(due({ ...dismissed, waits: [...dismissed.waits, { ...returned, id: 'third-job' }] })[0].returns)
    .toMatchObject([{ id: 'third-job' }]);
  expect(due({ ...records, appointments: [visit] })).toEqual([]);
});

it('shows a manual callback after other holds clear and reopens it when its booking is postponed', () => {
  const queued = requestBookingCallback({ ...base, waits: [hold] }, patientId, 'callback', 'Appointment callback');
  expect(openTasks(queued.tasks)).toEqual([]);
  expect(due(queued)).toEqual([]);
  const ready = { ...queued, waits: [] };
  expect(due(ready)).toMatchObject([{ patient: { id: patientId }, returns: [] }]);

  const booked = updateCallbacksForBookings(ready, { ...ready, appointments: [visit] }, today);
  expect(booked.tasks[0]).toMatchObject({ completedOn: today, bookingCallback: { bookedVisit: visit.id } });
  expect(due(booked)).toEqual([]);
  const postponed = updateCallbacksForBookings(booked, { ...booked, appointments: [{ ...visit, status: 'Postponed' }] }, today);
  expect(due(postponed)).toMatchObject([{ patient: { id: patientId } }]);
});
