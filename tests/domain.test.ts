import { describe, expect, it } from 'vitest';
import { decodeRecords, emptyRecords, type Appointment, type BreakRule, type Records, type Task, type Wait } from '../src/domain/model';
import { breakPreviewDates, breaksForDate, nextClinicDates } from '../src/domain/availability';
import { addDays } from '../src/domain/dates';
import { calendarConflicts, localTimestamp, normalizeCalendarEvent, type DeviceCalendarEvent } from '../src/domain/device-calendar';
import { pruneScheduleOverlapIgnores, scheduleConflicts, setLocalOverlapIgnored } from '../src/domain/schedule-conflicts';
import { adjacentAppointmentSlots, alternativeSlots, appointmentOpeningsOn, appointmentSlotsOnDate, assessSlot, availableDayRange, findAvailableDay, newlyBookablePatients, openTasks, planningCandidates, preferredSlotOnDate, responseReviews, saveAppointment, saveVisitOutcome, searchBookingPatients, suggestAppointmentTimes, upcomingVisits } from '../src/domain/workflows';

const now = new Date(2026, 10, 23, 8);
const slot = { date: '2026-11-23', start: '09:30', end: '10:00' };
const records: Records = {
  ...emptyRecords(),
  patients: [
    { id: 'a', name: 'Ada', phone: '', email: '', status: 'Active', priority: 'Urgent', priorityNote: '', createdOn: '2026-10-01', summary: '', nextAction: '' },
    { id: 'b', name: 'Bea', phone: '', email: '', status: 'Active', priority: 'Normal', priorityNote: '', createdOn: '2026-10-01', summary: '', nextAction: '' },
  ],
};
const visit: Appointment = { ...slot, id: 'visit', patientId: 'a', title: 'Visit', notes: '', kind: 'Visit', status: 'Scheduled', procedure: '', exceptions: [] };
const wait: Wait = { id: 'wait', patientId: 'a', title: 'Healing', type: 'Healing', status: 'Waiting', startedOn: '2026-11-06', reviewOn: null, endedOn: null, blocks: true, notes: '' };
const event = (id: string, begin: number, end: number, allDay = false): DeviceCalendarEvent =>
  ({ id, eventId: id, ignored: false, begin, end, allDay, title: 'Calendar event', calendar: 'Personal' });

describe('booking patient search', () => {
  const patients: Records['patients'] = [
    { ...records.patients[0], id: 'middle', name: 'Dilİpek Aydın', phone: '535 123 4567', email: 'clinic@example.test' },
    { ...records.patients[0], id: 'passive', name: 'İpek Durak', phone: '542 000 1234', status: 'Passive' },
    { ...records.patients[0], id: 'active', name: 'İpek Çelik', phone: '555 000 1234' },
    { ...records.patients[0], id: 'exact', name: 'İpek', phone: '+90 (532) 555-12-34', email: 'ipek@example.test', status: 'Passive' },
  ];
  const ids = (query: string) => searchBookingPatients(patients, query).map(patient => patient.id);

  it('shows no blank-query rows and ranks Turkish name matches by exactness, prefix, and status', () => {
    expect(ids('  ')).toEqual([]);
    expect(ids('()+')).toEqual([]);
    expect(ids(' Ipek ')).toEqual(['exact', 'active', 'passive', 'middle']);
    expect(ids('cel ipek')).toEqual(['active']);
  });

  it('matches formatted phones, phone fragments, email, and combined searches', () => {
    expect(ids('+90 (532) 555–12 34')).toEqual(['exact']);
    expect(ids('1234')).toEqual(['active', 'exact', 'passive', 'middle']);
    expect(ids('İPEK@EXAMPLE.TEST')).toEqual(['exact']);
    expect(ids('cel 1234')).toEqual(['active']);
    expect(ids('missing')).toEqual([]);
  });
});

describe('scheduling and planning', () => {
  it('uses the next three clinic dates even when a clinic date is booked out', () => {
    const schedule: Records = {
      ...records,
      hoursOverrides: [{ date: '2026-11-25', windows: [] }, { date: '2026-11-28', windows: [{ start: '09:00', end: '10:00' }] }],
      timeOff: [{ id: 'off', title: 'Closed', from: '2026-11-26', through: '2026-11-26', hours: null }],
      appointments: [{ ...visit, date: '2026-11-24', start: '09:00', end: '17:00' }],
    };
    expect(nextClinicDates(schedule, slot.date)).toEqual(['2026-11-24', '2026-11-27', '2026-11-28']);
    expect(nextClinicDates({ ...schedule, workingHours: [] }, slot.date)).toEqual(['2026-11-28']);
    expect(appointmentOpeningsOn(schedule, '2026-11-24')).toEqual([]);
  });

  it('reports continuous bookable gaps with minute-accurate device conflicts and configured durations', () => {
    const date = '2026-11-24';
    const schedule: Records = {
      ...records,
      appointments: [
        { ...visit, date, start: '09:00', end: '09:30' },
        { ...visit, id: 'block', date, start: '10:00', end: '11:00', kind: 'Block', patientId: null, status: 'Blocked time' },
        { ...visit, id: 'cancelled', date, start: '14:00', end: '15:00', status: 'Cancelled' },
      ],
      breaks: [{ id: 'lunch', title: 'Lunch', from: date, hours: { start: '12:31', end: '13:00' }, repeat: null, changes: [] }],
      timeOff: [{ id: 'off', title: 'Leave early', from: date, through: date, hours: { start: '16:01', end: '17:00' } }],
    };
    const events = [
      event('busy', localTimestamp(date, '12:30') + 30_000, localTimestamp(date, '13:00') + 30_000),
      { ...event('ignored', localTimestamp(date, '14:00'), localTimestamp(date, '15:00')), ignored: true },
    ];
    const openings = [
      { date, start: '11:00', end: '12:30', duration: 90 },
      { date, start: '13:01', end: '16:01', duration: 180 },
    ];
    expect(appointmentOpeningsOn(schedule, date, events)).toEqual(openings);
    expect(appointmentOpeningsOn({ ...schedule, appointmentDurations: { Easy: 120, Medium: 150, Hard: 180 } }, date, events))
      .toEqual(openings.slice(1));
  });

  it('accepts touching intervals and requires confirmation for each overlapping visit', () => {
    const booked = saveAppointment(records, visit, {}, now);
    const touching = { ...visit, id: 'touch', start: '10:00', end: '10:30' };
    expect(assessSlot(booked, touching, 'a', undefined, now)).toEqual([]);
    const schedule = saveAppointment(booked, touching, {}, now);
    const conflicting = { ...touching, id: 'double-booking', patientId: 'b', start: '09:59', end: '10:15' };
    const confirmations = assessSlot(schedule, conflicting, conflicting.patientId, undefined, now)
      .flatMap(issue => issue.confirmationKey ? [issue.confirmationKey] : []);
    expect(confirmations).toHaveLength(2);
    const reasons = { 'Working hours / time off': 'A reason' };
    expect(() => saveAppointment(schedule, conflicting, reasons, now, confirmations.slice(0, 1))).toThrow('Confirm each overlapping appointment');
    const saved = decodeRecords(saveAppointment(schedule, conflicting, {}, now, confirmations));
    expect(scheduleConflicts(saved, upcomingVisits(saved, slot.date, now)).map(item => item.ignored)).toEqual([true, true]);
    expect(saved.appointments.find(appointment => appointment.id === conflicting.id)?.exceptions).toEqual([
      { kind: 'Overlapping appointments', reason: 'Confirmed before saving.', recordedAt: now.toISOString(),
        conditions: ['overlap:visit', 'overlap:touch'] },
    ]);
    expect(() => saveAppointment(saved, { ...conflicting, start: '09:58' }, {}, now, confirmations)).toThrow('Confirm each overlapping appointment');
    const morning = { ...saved, hoursOverrides: [{ date: slot.date, windows: [{ start: '09:00', end: '11:30' }] }] };
    expect(preferredSlotOnDate(morning, slot.date, 30, { now: new Date(2026, 10, 23, 9, 30) }))
      .toEqual({ date: slot.date, start: '10:30', end: '11:00' });
  });

  it('confirms a visit and reserved time in either booking order and keeps it busy for suggestions', () => {
    const long = { ...visit, start: '09:00', end: '11:00' };
    const nested = { ...visit, id: 'nested', start: '09:30', end: '10:00' };
    const block: Appointment = {
      ...visit, id: 'block', kind: 'Block', patientId: null, status: 'Blocked time', start: '10:30', end: '11:30', title: 'Reserved',
    };
    const schedule = decodeRecords({ ...records, appointments: [long, nested] });
    const otherSchedule = { ...records, appointments: [block] };
    for (const [before, booking] of [[schedule, block], [otherSchedule, long]] as const) {
      expect(() => saveAppointment(before, booking, {}, now)).toThrow('Confirm each overlapping appointment');
      const confirmations = assessSlot(before, booking, booking.patientId, undefined, now).flatMap(issue => issue.confirmationKey ?? []);
      const saved = decodeRecords(saveAppointment(before, booking, {}, now, confirmations));
      expect(preferredSlotOnDate(saved, slot.date, 60, { now })?.start >= block.end).toBe(true);
      expect(appointmentOpeningsOn(saved, slot.date)).toContainEqual({ date: slot.date, start: '11:30', end: '17:00', duration: 330 });
      const conflicts = scheduleConflicts(saved, upcomingVisits(saved, slot.date, now));
      const conflict = conflicts.find(item => item.kind === 'local' && item.overlap.kind === 'appointment' && item.overlap.item.id === block.id);
      if (!conflict || conflict.kind !== 'local') throw new Error('Missing conflict with reserved time');
      expect(conflict.ignored).toBe(true);
      const restored = decodeRecords(setLocalOverlapIgnored(saved, conflict.appointment, conflict.overlap, false));
      expect(restored.appointments).toHaveLength(saved.appointments.length);
      expect(scheduleConflicts(restored, upcomingVisits(restored, slot.date, now)).find(item => item.key === conflict.key)?.ignored).toBe(false);
    }
  });

  it('confirms time off separately from a blocking wait reason and offers slots outside time off', () => {
    const blocked: Records = { ...records, waits: [wait], timeOff: [{ id: 'off', title: 'Leave', from: slot.date, through: slot.date, hours: { start: '09:00', end: '11:00' } }] };
    const confirmation = assessSlot(blocked, visit, visit.patientId, undefined, now).flatMap(issue => issue.confirmationKey ?? []);
    expect(confirmation).toHaveLength(1);
    expect(() => saveAppointment(blocked, visit, {}, now, confirmation)).toThrow('Healing');
    expect(() => saveAppointment(blocked, visit, { 'Blocking waits': 'Reviewed' }, now)).toThrow('Confirm each scheduling overlap');
    const saved = saveAppointment(blocked, visit, { 'Blocking waits': 'Reviewed' }, now, confirmation);
    expect(saved.appointments[0].exceptions.map(item => item.reason)).toEqual(['Reviewed', 'Confirmed before saving.']);
    expect(alternativeSlots(blocked, slot, records.patients[0], undefined, now)[0]).toMatchObject({ start: '11:00' });
  });

  it('includes patients with zero treatments and filters booked, passive or blocked patients', () => {
    expect(planningCandidates(records, slot.date).map(item => item.patient.id)).toEqual(['a', 'b']);
    expect(planningCandidates({ ...records, appointments: [visit] }, slot.date).map(item => item.patient.id)).toEqual(['b']);
    expect(planningCandidates({ ...records, waits: [wait] }, slot.date).map(item => item.patient.id)).toEqual(['b']);
    expect(planningCandidates({ ...records, waits: [{ ...wait, status: 'Resolved', endedOn: slot.date }] }, slot.date)[0].patient.id).toBe('a');
    expect(planningCandidates({ ...records, patients: [{ ...records.patients[0], status: 'Passive' }] }, slot.date)).toEqual([]);
  });

  it('finds a newly eligible patient when the planning count stays the same', () => {
    const before = { ...records, appointments: [visit] };
    const completed = saveVisitOutcome(before, visit, 'Completed');
    const after: Records = {
      ...completed,
      patients: [completed.patients[0], { ...completed.patients[1], status: 'Passive' }],
    };
    expect(planningCandidates(before, slot.date)).toHaveLength(1);
    expect(planningCandidates(after, slot.date)).toHaveLength(1);
    expect(newlyBookablePatients(before, after, slot.date).map(patient => patient.id)).toEqual(['a']);
    expect(newlyBookablePatients(after, after, slot.date)).toEqual([]);
  });

  it('balances urgency with the time since a visit or the patient was added', () => {
    const seenRecently: Appointment = { ...visit, date: '2026-11-21', status: 'Completed' };
    expect(planningCandidates({ ...records, appointments: [seenRecently] }, slot.date).map(item => item.patient.id))
      .toEqual(['b', 'a']);
    const otherVisit = { ...seenRecently, id: 'other', patientId: 'b', date: '2026-11-12' };
    expect(planningCandidates({ ...records, appointments: [seenRecently, otherVisit] }, slot.date).map(item => item.patient.id))
      .toEqual(['a', 'b']);
  });

  it('keeps old task dates as data and opens previously saved tasks without a booking hold', () => {
    const oldTask = { id: 'old', patientId: 'a', title: 'Call supplier', notes: '', completedOn: null, dueOn: '2026-12-01' };
    const upgraded = decodeRecords({ ...records, tasks: [oldTask] });
    expect(openTasks(upgraded.tasks)).toEqual([{ ...oldTask, blocks: false }]);
    expect(planningCandidates(upgraded, slot.date).map(item => item.patient.id)).toEqual(['a', 'b']);
  });

  it('applies task and response holds independently and records manual booking exceptions', () => {
    const task: Task = { id: 'parts', patientId: 'a', title: 'Receive components', notes: '', completedOn: null, blocks: true };
    const blocked = { ...records, tasks: [task], waits: [wait] };
    expect(planningCandidates(blocked, slot.date).map(item => item.patient.id)).toEqual(['b']);
    expect(() => saveAppointment(blocked, visit, { 'Blocking waits': 'Wait reviewed' }, now)).toThrow('Receive components');
    const saved = decodeRecords(saveAppointment(blocked, visit, {
      'Blocking waits': 'Wait reviewed', 'Blocking tasks': 'Task reviewed',
    }, now));
    expect(saved.appointments[0].exceptions.map(({ kind, conditions }) => ({ kind, conditions }))).toEqual([
      { kind: 'Blocking waits', conditions: ['wait:wait'] }, { kind: 'Blocking tasks', conditions: ['task:parts'] },
    ]);
    const completedTask = { ...task, completedOn: slot.date };
    const clearedWait = { ...wait, status: 'Resolved', endedOn: slot.date } as const;
    expect(planningCandidates({ ...blocked, tasks: [completedTask] }, slot.date).map(item => item.patient.id)).toEqual(['b']);
    expect(planningCandidates({ ...blocked, waits: [clearedWait] }, slot.date).map(item => item.patient.id)).toEqual(['b']);
    expect(planningCandidates({ ...blocked, tasks: [completedTask], waits: [clearedWait] }, slot.date).map(item => item.patient.id)).toEqual(['a', 'b']);
  });

  it('shows all undated waiting responses and defers responses with future review dates', () => {
    const waits: Wait[] = [
      { ...wait, id: 'healing' },
      { ...wait, id: 'lab', type: 'Laboratory return' },
      { ...wait, id: 'today', reviewOn: slot.date },
      { ...wait, id: 'future', reviewOn: '2026-11-24' },
      { ...wait, id: 'closed', status: 'Cancelled', endedOn: slot.date },
    ];
    expect(responseReviews({ ...records, waits }, slot.date).map(item => item.id)).toEqual(['healing', 'lab', 'today']);
    expect(responseReviews({ ...records, waits }, '2026-11-24').map(item => item.id)).toEqual(['healing', 'lab', 'today', 'future']);
  });
});

describe('device calendar suggestions', () => {
  it('keeps all-day dates in local time and only warns on actual overlap', () => {
    const allDay = normalizeCalendarEvent(event('all-day', Date.UTC(2026, 10, 23), Date.UTC(2026, 10, 24), true));
    const touching = event('touching', localTimestamp(slot.date, '08:00'), localTimestamp(slot.date, '09:30'));
    expect(allDay.begin).toBe(localTimestamp(slot.date));
    expect(calendarConflicts(slot, [touching, allDay])).toEqual([allDay]);
    expect(calendarConflicts({ ...slot, date: '2026-11-24' }, [allDay])).toEqual([]);
    expect(calendarConflicts(slot, [{ ...allDay, ignored: true }])).toEqual([]);
    expect(suggestAppointmentTimes(records, 30, undefined, now, [{ ...allDay, ignored: true }])[0]?.slot)
      .toEqual({ date: slot.date, start: '09:00', end: '09:30' });
  });

  it('uses the earliest fitting block from each anchor, starting after a calendar conflict', () => {
    const today = slot.date;
    const nextWeek = addDays(today, 7);
    const weeks = addDays(today, 14);
    const events = [
      event('today', localTimestamp(today, '09:00'), localTimestamp(today, '09:45')),
      event('next-week', localTimestamp(nextWeek), localTimestamp(addDays(nextWeek, 1)), true),
    ];
    expect(suggestAppointmentTimes({ ...records, waits: [wait] }, 60, undefined, now, events)).toEqual([
      { label: 'First availability', slot: { date: today, start: '09:45', end: '10:45' } },
      { label: 'Next week', slot: { date: addDays(nextWeek, 1), start: '09:00', end: '10:00' } },
      { label: 'Two weeks', slot: { date: weeks, start: '09:00', end: '10:00' } },
    ]);
  });

  it('falls back to the end of a conflicting calendar event and deduplicates later anchors', () => {
    const day = addDays(slot.date, 14);
    const windows = [{ day: 1, start: '09:00', end: '10:15' }];
    const timeOff = [{ id: 'off', title: 'Leave', from: slot.date, through: addDays(day, -1), hours: null }];
    const events = [event('meeting', localTimestamp(day, '09:00'), localTimestamp(day, '09:17'))];
    expect(suggestAppointmentTimes({ ...records, timeOff, workingHours: windows }, 45, undefined, now, events)).toEqual([
      { label: 'First availability', slot: { date: day, start: '09:17', end: '10:02' } },
    ]);
  });
});

describe('appointment presets and availability', () => {
  it.each([['12:00', '10:30'], ['11:40', '10:10'], ['11:30', '10:00']])(
    'keeps both 90-minute morning visits when hours end at %s and starts the second at %s', (morningEnd, secondStart) => {
      const date = slot.date;
      const windows = [{ start: '08:30', end: morningEnd }, { start: '13:00', end: '17:00' }];
      const schedule = { ...records, hoursOverrides: [{ date, windows }] };
      const expected = [
        { date, start: '08:30', end: '10:00' }, { date, start: secondStart, end: morningEnd },
        { date, start: '13:30', end: '15:00' }, { date, start: '15:30', end: '17:00' },
      ];
      expect(appointmentSlotsOnDate(schedule, date, 90, { now })).toEqual(expected);
      const firstBooked = { ...schedule, appointments: [{ ...visit, ...expected[0] }] };
      expect(appointmentSlotsOnDate(firstBooked, date, 90, { now })).toEqual(expected.slice(1));
      const morningBooked = { ...firstBooked, appointments: [...firstBooked.appointments, { ...visit, ...expected[1], id: 'second' }] };
      expect(appointmentSlotsOnDate(morningBooked, date, 90, { now })).toEqual(expected.slice(2));
    },
  );

  it('recalculates full blocks for the selected duration and offers both edges when only one full visit fits', () => {
    const date = slot.date;
    const schedule = { ...records, hoursOverrides: [{ date, windows: [{ start: '08:30', end: '10:30' }] }] };
    expect(appointmentSlotsOnDate(schedule, date, 60, { now }).map(item => item.start)).toEqual(['08:30', '09:30']);
    expect(appointmentSlotsOnDate(schedule, date, 90, { now })).toEqual([
      { date, start: '08:30', end: '10:00' }, { date, start: '09:00', end: '10:30' },
    ]);
    expect(appointmentSlotsOnDate(schedule, date, 180, { now })).toEqual([]);
  });

  it('requires a full hour of lead time, with the first fitting minute as a fallback', () => {
    const date = slot.date;
    const schedule = { ...records, hoursOverrides: [{ date, windows: [{ start: '09:00', end: '10:30' }] }] };
    const exact = new Date(2026, 10, 23, 8);
    const after = new Date(2026, 10, 23, 8, 0, 1);
    expect(suggestAppointmentTimes(schedule, 60, undefined, exact)[0]?.slot)
      .toEqual({ date, start: '09:00', end: '10:00' });
    expect(suggestAppointmentTimes(schedule, 60, undefined, after)[0]?.slot)
      .toEqual({ date, start: '09:01', end: '10:01' });
    expect(preferredSlotOnDate(schedule, date, 60, { now: after })?.start).toBe('09:00');
  });

  it('carries the one-hour lead time across midnight', () => {
    const date = addDays(slot.date, 1);
    const schedule = { ...records, hoursOverrides: [{ date, windows: [{ start: '00:00', end: '02:00' }] }] };
    expect(suggestAppointmentTimes(schedule, 60, undefined, new Date(2026, 10, 23, 23, 30))[0]?.slot)
      .toEqual({ date, start: '00:30', end: '01:30' });
  });

  it('uses the time of each search to set the one-hour cutoff', () => {
    const earlier = new Date(2026, 10, 23, 13, 45);
    const later = new Date(2026, 10, 23, 15, 15);
    expect(suggestAppointmentTimes(records, 120, undefined, earlier)[0]?.slot.start).toBe('14:45');
    expect(suggestAppointmentTimes(records, 30, undefined, later)[0]?.slot.start).toBe('16:15');
  });

  it('loads old records with the new defaults and preserves saved appointment lengths', () => {
    const { appointmentDurations, hoursOverrides, breaks, ...legacy } = records;
    const decoded = decodeRecords({ ...legacy, appointments: [visit] });
    expect(decoded.appointmentDurations).toEqual({ Easy: 60, Medium: 90, Hard: 180 });
    expect(decoded.hoursOverrides).toEqual([]);
    expect(decoded.breaks).toEqual([]);
    expect(decoded.appointments[0]).toEqual(visit);
    expect(() => decodeRecords({ ...decoded, appointmentDurations: { ...appointmentDurations, Medium: 0 } })).toThrow();
  });

  it('picks the earliest block in both day directions and skips closed and past dates', () => {
    const today = slot.date;
    const tuesday = addDays(today, 1);
    const wednesday = addDays(today, 2);
    const thursday = addDays(today, 3);
    const schedule = { ...records, hoursOverrides: [{ date: wednesday, windows: [] }] };
    const options = { now, events: [event('morning', localTimestamp(tuesday, '09:00'), localTimestamp(tuesday, '10:00'))] };
    for (const [from, direction] of [[today, 1], [thursday, -1]] as const) {
      expect(findAvailableDay(schedule, availableDayRange(from, direction, today)!, direction, 90, options))
        .toEqual({ date: tuesday, start: '10:00', end: '11:30' });
    }
    expect(availableDayRange(today, -1, today)).toBeUndefined();
  });

  it('browses non-overlapping slots on one date and respects break and calendar boundaries', () => {
    const date = slot.date;
    const lunch = { id: 'lunch', title: 'Lunch', from: date, hours: { start: '12:00', end: '13:00' }, repeat: null, changes: [] };
    const schedule = { ...records, breaks: [lunch] };
    const options = { now, events: [event('meeting', localTimestamp(date, '14:30') + 20_000, localTimestamp(date, '15:10') + 25_000)] };
    expect(adjacentAppointmentSlots(schedule, { date, start: '11:00', end: '12:00' }, options).next[0])
      .toEqual({ date, start: '13:00', end: '14:00' });
    expect(adjacentAppointmentSlots(schedule, { date, start: '15:30', end: '16:30' }, options).previous[0])
      .toEqual({ date, start: '13:00', end: '14:00' });
    expect(adjacentAppointmentSlots(schedule, { date, start: '13:30', end: '14:30' }, options).next[0])
      .toEqual({ date, start: '16:00', end: '17:00' });
    expect(adjacentAppointmentSlots(schedule, { date, start: '16:00', end: '17:00' }, options).next).toEqual([]);
    expect(adjacentAppointmentSlots(schedule, { date, start: '09:00', end: '10:00' }, options).previous).toEqual([]);
  });

  it('uses a date override, time off and a break to find the next uninterrupted gap', () => {
    const id = 'lunch';
    const lunch = { id, title: 'Lunch', from: slot.date, hours: { start: '11:45', end: '13:05' }, repeat: null, changes: [] };
    const schedule = { ...records, breaks: [lunch], hoursOverrides: [{ date: slot.date, windows: [{ start: '10:00', end: '16:20' }] }],
      timeOff: [{ id: 'leave', title: 'Time off', from: slot.date, through: slot.date, hours: { start: '16:15', end: '16:20' } }] };
    expect(preferredSlotOnDate(schedule, slot.date, 180, { now })).toEqual({ date: slot.date, start: '13:05', end: '16:05' });
    const crossing = { ...visit, start: '10:30', end: '13:30' };
    const confirmation = assessSlot(schedule, crossing, crossing.patientId, undefined, now).flatMap(issue => issue.confirmationKey ?? []);
    expect(() => saveAppointment(schedule, crossing, {}, now)).toThrow('Confirm each scheduling overlap');
    expect(saveAppointment(schedule, crossing, {}, now, confirmation).appointments[0].exceptions[0].conditions)
      .toEqual([`break:${id}:${slot.date}`]);
  });

  it('scopes break ignores to one visit and one occurrence and drops ended visits from review', () => {
    const lunch: BreakRule = { id: 'lunch', title: 'Lunch', from: slot.date, hours: { start: '12:00', end: '13:00' },
      repeat: { weekdays: [1, 2], end: { type: 'never' } }, changes: [] };
    const first = { ...visit, start: '12:10', end: '12:30' };
    const later = { ...first, id: 'later', date: '2026-11-24' };
    const schedule = { ...records, breaks: [lunch], appointments: [first, later] };
    const conflicts = (data: Records, clock = now) => scheduleConflicts(data, upcomingVisits(data, slot.date, clock));
    const selected = conflicts(schedule)[0];
    if (selected.kind !== 'local') throw new Error('Missing lunch conflict');
    const saved = decodeRecords(setLocalOverlapIgnored(schedule, first, selected.overlap, true));
    expect(conflicts(saved).map(item => item.ignored)).toEqual([true, false]);
    const moved = pruneScheduleOverlapIgnores({ ...saved, breaks: [{ ...lunch, changes: [{ date: first.date,
      replacement: { date: first.date, start: '12:05', end: '13:00' } }] }] });
    expect(conflicts(moved).map(item => item.ignored)).toEqual([false, false]);
    expect(conflicts({ ...moved, breaks: [lunch] }).map(item => item.ignored)).toEqual([false, false]);
    expect(conflicts(saved, new Date(2026, 10, 23, 12, 30)).map(item => item.appointment.id)).toEqual(['later']);
  });

  it('counts two matching dates from the start and moves or skips just those occurrences', () => {
    const from = '2026-11-26';
    const rule: BreakRule = { id: 'lunch', title: 'Lunch', from, hours: { start: '12:00', end: '13:00' },
      repeat: { weekdays: [2, 4], end: { type: 'count', count: 2 } }, changes: [] };
    const second = '2026-12-01';
    const moved = '2026-12-02';
    const schedule = { ...records, breaks: [{ ...rule, changes: [
      { date: from, replacement: null }, { date: second, replacement: { date: moved, start: '13:00', end: '14:00' } },
    ] }] };
    expect(breakPreviewDates(rule, 5)).toEqual([from, second]);
    expect([from, second, '2026-12-03'].map(date => breaksForDate(schedule, date))).toEqual([[], [], []]);
    expect(breaksForDate(schedule, moved)[0]).toMatchObject({ start: '13:00', end: '14:00', source: second });
  });
});
