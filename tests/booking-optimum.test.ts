import { describe, expect, it } from 'vitest';
import { findBookingOptions } from '../src/domain/booking-optimum';
import { localTimestamp, type DeviceCalendarEvent } from '../src/domain/device-calendar';
import { emptyRecords, type Records } from '../src/domain/model';

const monday = '2026-11-23';
const tuesday = '2026-11-24';
const wednesday = '2026-11-25';
const nextMonday = '2026-11-30';
const now = new Date(2026, 10, 23, 8);
const search = { from: monday, through: '2026-12-09', now };

const demo: Records = {
  ...emptyRecords(),
  workingHours: [
    { day: 1, start: '09:00', end: '12:00' },
    { day: 1, start: '13:00', end: '14:00' },
    { day: 1, start: '15:30', end: '16:00' },
    { day: 2, start: '09:00', end: '17:00' },
    { day: 3, start: '14:00', end: '15:30' },
  ],
  appointments: [{
    id: 'busy', kind: 'Block', date: tuesday, start: '09:00', end: '17:00', title: 'Blocked', notes: '',
    status: 'Blocked time', patientId: null, procedure: '', exceptions: [],
  }],
  hoursOverrides: [{ date: nextMonday, windows: [{ start: '09:00', end: '12:05' }] }],
};

describe('Optimum booking', () => {
  it('moves a 90-minute visit to Wednesday to keep the only three-hour opening', () => {
    const options = findBookingOptions(demo, 90, search);
    const first = { date: monday, start: '09:00', end: '10:30' };
    const optimum = { date: wednesday, start: '14:00', end: '15:30' };

    expect(options.first).toEqual(first);
    expect(options.optimum).toEqual(optimum);
    expect(options.reserve(optimum)).toBe('preserved');
    expect(options.earlier(optimum)).toEqual([first]);
    expect(options.reserve(first)).toBe('lost');
    expect(options.earlier(first)).toEqual([]);
  });

  it('moves through strictly earlier choices on the same day before giving up the reserve', () => {
    const options = findBookingOptions(demo, 30, search);
    const optimum = { date: monday, start: '15:30', end: '16:00' };
    const earlier = { date: monday, start: '13:00', end: '13:30' };
    const first = { date: monday, start: '09:00', end: '09:30' };

    expect(options.optimum).toEqual(optimum);
    expect(options.earlier(optimum)).toEqual([earlier, first]);
    expect(options.earlier(earlier)).toEqual([first]);
    expect(options.earlier(first)).toEqual([]);
    expect(options.reserve(earlier)).toBe('preserved');
  });

  it('uses the first continuous slot that fits the full duration for 180+ minutes', () => {
    const threeHours = findBookingOptions(demo, 180, search);
    const threeHoursFiveMinutes = findBookingOptions(demo, 185, search);

    expect(threeHours.optimum).toEqual({ date: monday, start: '09:00', end: '12:00' });
    expect(threeHoursFiveMinutes.first).toEqual({ date: nextMonday, start: '09:00', end: '12:05' });
    expect(threeHoursFiveMinutes.optimum).toEqual(threeHoursFiveMinutes.first);
  });

  it('uses the reserve when the next fitting opening is more than seven calendar days away', () => {
    const laterWednesday = '2026-12-02';
    const records = {
      ...emptyRecords(), workingHours: [],
      hoursOverrides: [
        { date: monday, windows: [{ start: '09:00', end: '12:00' }] },
        { date: laterWednesday, windows: [{ start: '13:00', end: '14:30' }] },
      ],
    };
    const options = findBookingOptions(records, 90, search);
    const first = { date: monday, start: '09:00', end: '10:30' };

    expect(options.optimum).toEqual(first);
    expect(options.reserve(first)).toBe('lost');
  });

  it('respects the current-time cutoff, breaks, grid rounding, date bounds, and an excluded appointment', () => {
    const records = {
      ...demo,
      breaks: [{ id: 'br', title: 'Break', from: monday, hours: { start: '10:13', end: '10:39' }, repeat: null, changes: [] }],
    };
    const first = findBookingOptions(records, 30, { ...search, now: new Date(2026, 10, 23, 9, 47, 30), requestNow: now });

    expect(first.first).toEqual({ date: monday, start: '10:40', end: '11:10' });
    expect(findBookingOptions(records, 90, { ...search, from: tuesday }).first?.date).toBe(wednesday);
    expect(findBookingOptions(records, 90, { ...search, from: tuesday, excludeId: 'busy' }).first?.date).toBe(tuesday);
  });

  it('treats visible device calendar conflicts as occupied while respecting ignored events', () => {
    const event: DeviceCalendarEvent = {
      id: 'calendar-busy', eventId: 'calendar-busy', ignored: false, title: 'Calendar event', calendar: 'Clinic', allDay: false,
      begin: localTimestamp(monday, '09:00'), end: localTimestamp(monday, '09:31') + 12_000,
    };
    const busy = findBookingOptions(demo, 90, { ...search, events: [event] });

    expect(busy.first).toEqual({ date: monday, start: '09:35', end: '11:05' });
    expect(busy.optimum).toEqual(busy.first);
    expect(busy.reserve(busy.first!)).toBeUndefined();
    expect(findBookingOptions(demo, 90, { ...search, events: [{ ...event, ignored: true }] }).optimum?.date).toBe(wednesday);
  });

  it('honors existing minute durations and requires a 5-minute grid for multiples of five', () => {
    const records = { ...emptyRecords(), workingHours: [
      { day: 1, start: '09:02', end: '09:18' },
      { day: 2, start: '09:00', end: '09:30' },
    ] };

    expect(findBookingOptions(records, 16, search).first).toEqual({ date: monday, start: '09:02', end: '09:18' });
    expect(findBookingOptions(records, 15, search).first).toEqual({ date: tuesday, start: '09:00', end: '09:15' });
  });

  it('does not span separate working-hours ranges even when they touch', () => {
    const records = { ...emptyRecords(), workingHours: [
      { day: 1, start: '09:00', end: '10:30' },
      { day: 1, start: '10:30', end: '12:00' },
      { day: 2, start: '10:00', end: '13:00' },
    ] };

    expect(findBookingOptions(records, 180, search).first).toEqual({ date: tuesday, start: '10:00', end: '13:00' });
  });
});
