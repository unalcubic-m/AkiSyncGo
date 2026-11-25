import { describe, expect, it } from 'vitest';
import { calendarPublishingSnapshot } from '../src/domain/calendar-publishing';
import {
  calendarUnavailabilitySnapshot, defaultUnavailabilityPreferences, externalPublishingDates,
  type UnavailabilityPreferences,
} from '../src/domain/calendar-unavailability';
import { addDays } from '../src/domain/dates';
import { localTimestamp, normalizeCalendarEvent, type DeviceCalendarEvent } from '../src/domain/device-calendar';
import { emptyRecords, type Appointment, type BreakRule, type Records } from '../src/domain/model';

const today = '2026-11-23'; // Monday
const tomorrow = addDays(today, 1);
const prefs = defaultUnavailabilityPreferences;
const timed = (date: string, start: string, end: string) => ({
  start: localTimestamp(date, start), end: localTimestamp(date, end), allDay: false,
});
const day = (from: string, through: string) => ({ start: Date.parse(from), end: Date.parse(addDays(through, 1)), allDay: true });
const closure: Extract<Appointment, { kind: 'Block' }> = {
  id: 'fictional-block', kind: 'Block', date: today, patientId: null, title: 'Private closure title',
  start: '13:30', end: '15:00', status: 'Blocked time', procedure: '', notes: 'Private closure notes', exceptions: [],
};
const lunch: BreakRule = {
  id: 'fictional-lunch', title: 'Private break name', from: today, hours: { start: '12:00', end: '13:00' }, repeat: null, changes: [],
};
const event = (date: string, start: string, end: string, fields: Partial<DeviceCalendarEvent> = {}): DeviceCalendarEvent => ({
  id: `private-event-${date}-${start}`, eventId: 'private-series-identifier', title: 'Private event title',
  calendar: 'Private calendar name', ignored: false, allDay: false,
  begin: localTimestamp(date, start), end: localTimestamp(date, end), ...fields,
});
const snapshot = (records: Partial<Records> = {}, events: DeviceCalendarEvent[] = [], settings: Partial<UnavailabilityPreferences> = {}) =>
  calendarUnavailabilitySnapshot({ ...emptyRecords(), ...records }, today, { ...prefs, ...settings }, events);

describe('calendar unavailability snapshot', () => {
  it('publishes timed and all-day dated closures without a future cap, retaining full multi-day intervals', () => {
    const far = '2036-05-02';
    const allDayStart = addDays(today, -5);
    const blocks = snapshot({
      appointments: [closure, { ...closure, id: 'far', date: far }, { ...closure, id: 'cancelled', date: tomorrow, status: 'Cancelled' }],
      timeOff: [
        { id: 'multi', title: 'A private reason', from: allDayStart, through: addDays(today, -1), hours: null },
        { id: 'single', title: 'Also private', from: '2036-05-03', through: '2036-05-03', hours: null },
        { id: 'timed-days', title: 'Private hours', from: tomorrow, through: addDays(today, 2), hours: { start: '08:00', end: '09:00' } },
        { id: 'history', title: 'History', from: addDays(today, -10), through: addDays(today, -8), hours: null },
      ],
    }, [], { horizon: 30 }).blocks;
    expect(blocks).toEqual([
      day(allDayStart, addDays(today, -1)), day('2036-05-03', '2036-05-03'), timed(today, '13:30', '15:00'),
      timed(tomorrow, '08:00', '09:00'), timed(addDays(today, 2), '08:00', '09:00'), timed(far, '13:30', '15:00'),
    ]);
  });

  it('keeps one-time breaks and uses the effective dates of moved, modified, or skipped recurring breaks', () => {
    const recurring: BreakRule = {
      ...lunch, repeat: { weekdays: [1, 2, 3], end: { type: 'count', count: 4 } },
      changes: [
        { date: today, replacement: null },
        { date: tomorrow, replacement: { date: addDays(today, 5), start: '11:00', end: '11:45' } },
        { date: addDays(today, 2), replacement: { date: addDays(today, 2), start: '13:00', end: '14:00' } },
      ],
    };
    expect(snapshot({ breaks: [recurring, { ...lunch, id: 'one', from: '2036-05-02' }] }, [], { horizon: 30 }).blocks).toEqual([
      timed(addDays(today, 2), '13:00', '14:00'), timed(addDays(today, 5), '11:00', '11:45'),
      timed(addDays(today, 7), '12:00', '13:00'), timed('2036-05-02', '12:00', '13:00'),
    ]);
  });

  it('clips external events and existing buffers to actual working hours, including a buffer on its own', () => {
    const records = { hoursOverrides: [{ date: tomorrow, windows: [{ start: '08:00', end: '12:00' }, { start: '14:00', end: '18:00' }] }] };
    const events = [
      event(today, '15:00', '20:00'), event(today, '19:00', '21:00'), event(tomorrow, '09:00', '16:00'),
      event(tomorrow, '18:30', '20:00'), event(addDays(today, 5), '10:00', '12:00'),
    ];
    expect(snapshot(records, events).blocks).toEqual([
      timed(today, '14:00', '17:00'), timed(tomorrow, '08:00', '12:00'), timed(tomorrow, '14:00', '16:00'), timed(tomorrow, '17:30', '18:00'),
    ]);
    expect(snapshot(records, events, { buffers: false }).blocks).toEqual([
      timed(today, '15:00', '17:00'), timed(tomorrow, '09:00', '12:00'), timed(tomorrow, '14:00', '16:00'),
    ]);
    expect(snapshot({ calendarEventBuffer: { enabled: false, minutes: 60 } }, [events[0]]).blocks).toEqual([timed(today, '15:00', '17:00')]);
    expect(snapshot({ calendarEventBuffer: { enabled: true, minutes: 15 } }, [events[0]]).blocks).toEqual([timed(today, '14:45', '17:00')]);
    expect(snapshot({}, events, { workingHoursOnly: false }).blocks).toEqual([
      timed(today, '14:00', '21:00'), timed(tomorrow, '08:00', '16:00'), timed(tomorrow, '17:30', '20:00'),
      timed(addDays(today, 5), '09:00', '12:00'),
    ]);
  });

  it('normalizes multi-day external events and preserves explicit all-day closures over overlapping times', () => {
    const friday = addDays(today, 4);
    const saturday = addDays(today, 5);
    const monday = addDays(today, 7);
    const external = normalizeCalendarEvent(event(friday, '00:00', '01:00', {
      allDay: true, begin: Date.parse(friday), end: Date.parse(addDays(monday, 1)),
    }));
    expect(snapshot({}, [external]).blocks).toEqual([timed(friday, '09:00', '17:00'), timed(monday, '09:00', '17:00')]);
    const closure = { id: 'all-day', title: 'Private day off', from: saturday, through: addDays(today, 6), hours: null };
    expect(snapshot({ timeOff: [closure] }, [external], { workingHoursOnly: false, buffers: false }).blocks).toEqual([
      day(saturday, addDays(today, 6)),
      { start: localTimestamp(friday), end: localTimestamp(saturday), allDay: false },
      { start: localTimestamp(monday), end: localTimestamp(addDays(monday, 1)), allDay: false },
    ]);
  });

  it('merges overlaps and adjacent blocks, then splits them when a category is disabled', () => {
    const records = { appointments: [closure], breaks: [lunch] };
    const external = [event(today, '12:30', '14:00'), event(today, '15:00', '16:00'), event(today, '16:30', '17:00')];
    const options = { buffers: false };
    expect(snapshot(records, external, options).blocks).toEqual([timed(today, '12:00', '16:00'), timed(today, '16:30', '17:00')]);
    expect(snapshot(records, external, { ...options, external: false }).blocks).toEqual([timed(today, '12:00', '13:00'), timed(today, '13:30', '15:00')]);
    expect(snapshot(records, external, { ...options, breaks: false }).blocks).toEqual([timed(today, '12:30', '16:00'), timed(today, '16:30', '17:00')]);
    expect(snapshot(records, external, { ...options, closures: false }).blocks).toEqual([
      timed(today, '12:00', '14:00'), timed(today, '15:00', '16:00'), timed(today, '16:30', '17:00'),
    ]);
  });

  it('ignores globally ignored events and keeps exceptions and overlapping appointments separate', () => {
    const restricted = event(today, '13:00', '15:00');
    const records: Records = {
      ...emptyRecords(),
      patients: [{ id: 'patient', name: 'Fictional Patient', email: '', phone: '', status: 'Active', priority: 'Normal',
        priorityNote: '', createdOn: today, summary: '', nextAction: '' }],
      appointments: [{ ...closure, id: 'visit', kind: 'Visit', status: 'Scheduled', patientId: 'patient', ignoredCalendarEventIds: [restricted.id] }],
    };
    const output = snapshot(records, [restricted, event(today, '09:00', '12:00', { ignored: true })], { buffers: false });
    expect(output.blocks).toEqual([timed(today, '13:00', '15:00')]);
    expect(Object.keys(output.blocks[0]).sort()).toEqual(['allDay', 'end', 'start']);
    expect(calendarPublishingSnapshot(records, today).visits).toEqual([
      { id: 'visit', title: 'Fictional Patient', start: localTimestamp(today, '13:30'), end: localTimestamp(today, '15:00') },
    ]);
  });

  it('limits rolling dates only for external events and recurring breaks, retaining buffers at the boundary', () => {
    const beforeEnd = addDays(today, 29);
    const horizonEnd = addDays(today, 30);
    const afterEnd = addDays(today, 31);
    const records = { ...emptyRecords(), breaks: [{
      ...lunch, from: beforeEnd, repeat: { weekdays: [2, 3], end: { type: 'never' as const } },
    }, { ...lunch, id: 'one', from: afterEnd }] };
    const events = [event(beforeEnd, '14:00', '15:00'), event(horizonEnd, '00:30', '03:00'), event(afterEnd, '16:00', '17:00')];
    expect(externalPublishingDates(records, today, { ...prefs, horizon: 30 })).toEqual({ from: addDays(today, -1), through: horizonEnd });
    expect(snapshot(records, events, { horizon: 30, workingHoursOnly: false }).blocks).toEqual([
      timed(beforeEnd, '12:00', '15:00'), { start: localTimestamp(beforeEnd, '23:30'), end: localTimestamp(horizonEnd), allDay: false },
      timed(afterEnd, '12:00', '13:00'),
    ]);
    expect(snapshot(records, events).blocks).toContainEqual(timed(afterEnd, '15:00', '17:00'));
  });
});
