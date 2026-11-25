import { describe, expect, it } from 'vitest';
import { findBookingOptions } from '../src/domain/booking-optimum';
import { localTimestamp, type DeviceCalendarEvent } from '../src/domain/device-calendar';
import { emptyRecords, type Records } from '../src/domain/model';

const monday = '2026-11-30';
const tuesday = '2026-12-01';
const wednesday = '2026-12-02';
const nextMonday = '2026-12-07';
const nextTuesday = '2026-12-08';
const search = { now: new Date(2026, 10, 30, 7), from: monday, through: '2026-12-15' };

describe('later Optimum suggestions', () => {
  it('ranks later openings within seven days and adds one fixed working day', () => {
    const records: Records = { ...emptyRecords(), workingHours: [
      { day: 1, start: '09:00', end: '12:00' },
      { day: 2, start: '09:00', end: '10:30' },
      { day: 3, start: '09:00', end: '11:30' },
      { day: 3, start: '14:02', end: '15:35' },
    ], hoursOverrides: [{ date: nextMonday, windows: [{ start: '09:00', end: '10:30' }] }] };
    const ranked = findBookingOptions(records, 90, search);

    expect(ranked.optimum).toEqual({ date: tuesday, start: '09:00', end: '10:30' });
    expect(ranked.regularThrough).toBe(nextMonday);
    const candidates = ranked.later(ranked.optimum!);
    expect(candidates).toEqual([
      { date: wednesday, start: '14:05', end: '15:35' },
      { date: nextMonday, start: '09:00', end: '10:30' },
      { date: nextTuesday, start: '09:00', end: '10:30' },
    ]);
    expect(candidates.map(ranked.reserve)).toEqual(['preserved', 'preserved', 'preserved']);
    expect(ranked.later(candidates[2])).toEqual([]);
  });

  it('preserves the reserve before choosing a tighter gap', () => {
    const throughThursday = { ...search, through: '2026-12-03' };
    const records: Records = { ...emptyRecords(), workingHours: [
      { day: 1, start: '08:00', end: '08:30' },
      { day: 1, start: '09:00', end: '12:00' },
      { day: 2, start: '09:00', end: '09:15' },
      { day: 3, start: '09:00', end: '09:15' },
      { day: 4, start: '09:00', end: '13:00' },
    ] };
    const ranked = findBookingOptions(records, 30, throughThursday);
    const current = { date: monday, start: '08:00', end: '08:30' };
    expect(ranked.reserve({ date: monday, start: '09:00', end: '09:30' })).toBe('lost');
    expect(ranked.later(current)[0])
      .toEqual({ date: '2026-12-03', start: '09:00', end: '09:30' });
  });

  it('picks a later exact fit ahead of a wider gap on an earlier day', () => {
    const records: Records = { ...emptyRecords(), workingHours: [
      { day: 1, start: '09:00', end: '12:00' },
      { day: 1, start: '13:00', end: '14:00' },
      { day: 2, start: '09:00', end: '11:00' },
      { day: 3, start: '11:00', end: '12:00' },
    ] };
    const ranked = findBookingOptions(records, 60, search);

    expect(ranked.optimum).toEqual({ date: monday, start: '13:00', end: '14:00' });
    expect(ranked.reserve({ date: tuesday, start: '09:00', end: '10:00' })).toBe('preserved');
    expect(ranked.reserve({ date: wednesday, start: '11:00', end: '12:00' })).toBe('preserved');
    expect(ranked.later(ranked.optimum!)[0]).toEqual({ date: wednesday, start: '11:00', end: '12:00' });
  });

  it('uses best fit for later long visits while the initial Optimum uses the earliest fitting time', () => {
    const records: Records = { ...emptyRecords(), workingHours: [
      { day: 1, start: '09:00', end: '13:00' },
      { day: 2, start: '09:00', end: '13:00' },
      { day: 3, start: '14:00', end: '17:00' },
    ] };
    const ranked = findBookingOptions(records, 180, search);

    expect(ranked.optimum).toEqual({ date: monday, start: '09:00', end: '12:00' });
    expect(ranked.later(ranked.optimum!)[0]).toEqual({ date: wednesday, start: '14:00', end: '17:00' });
  });

  it('skips a closed date and respects the existing search scope', () => {
    const records: Records = { ...emptyRecords(), workingHours: [
      { day: 1, start: '09:00', end: '10:30' },
      { day: 2, start: '09:00', end: '10:30' },
      { day: 3, start: '09:00', end: '10:30' },
    ], hoursOverrides: [{ date: nextTuesday, windows: [] }] };
    const current = { date: nextMonday, start: '09:00', end: '10:30' };
    expect(findBookingOptions(records, 90, search).later(current))
      .toEqual([{ date: '2026-12-09', start: '09:00', end: '10:30' }]);
    expect(findBookingOptions(records, 90, { ...search, through: nextTuesday }).later(current))
      .toEqual([]);
  });

  it('honors device events on the fixed extra working day', () => {
    const records = { ...emptyRecords(), workingHours: [1, 2, 3].map(day => ({ day, start: '09:00', end: '10:30' })) };
    const current = { date: nextMonday, start: '09:00', end: '10:30' };
    const event: DeviceCalendarEvent = {
      id: 'calendar-busy', eventId: 'calendar-busy', ignored: false, title: 'Calendar event', calendar: 'Clinic', allDay: false,
      begin: localTimestamp(nextTuesday, '09:00'), end: localTimestamp(nextTuesday, '09:15'),
    };

    expect(findBookingOptions(records, 90, { ...search, events: [event] }).later(current)).toEqual([]);
    expect(findBookingOptions(records, 90, { ...search, events: [{ ...event, ignored: true }] }).later(current))
      .toEqual([{ date: nextTuesday, start: '09:00', end: '10:30' }]);
  });

  it('fits an existing duration that uses whole minutes outside the five-minute grid', () => {
    const records = { ...emptyRecords(), workingHours: [
      { day: 1, start: '09:01', end: '09:17' },
      { day: 2, start: '09:01', end: '09:23' },
      { day: 3, start: '11:02', end: '11:18' },
    ] };
    const ranked = findBookingOptions(records, 16, search);

    expect(ranked.optimum).toEqual({ date: monday, start: '09:01', end: '09:17' });
    expect(ranked.later(ranked.optimum!)[0]).toEqual({ date: wednesday, start: '11:02', end: '11:18' });
  });
});
