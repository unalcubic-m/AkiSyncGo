import { describe, expect, it } from 'vitest';
import { getBookingDurations, isOnBookingMinuteGrid } from '../src/domain/booking-durations';
import { gridBookingSlotsOnDate } from '../src/domain/booking-time-grid';
import { decodeRecords, emptyRecords } from '../src/domain/model';

describe('booking durations', () => {
  it('keeps arbitrary legacy presets and the existing Medium default', () => {
    const records = decodeRecords({ ...emptyRecords(), appointmentDurations: { Easy: 47, Medium: 91, Hard: 47 } });
    expect(getBookingDurations(records)).toEqual({ presets: [47, 91], defaultMinutes: 91 });
  });

  it('persists custom presets and requires the selected default to be present', () => {
    const bookingDurations = { presets: [30, 90, 185], defaultMinutes: 185 };
    const records = decodeRecords({ ...emptyRecords(), bookingDurations });
    expect(getBookingDurations(records)).toEqual(bookingDurations);
    expect(() => decodeRecords({ ...records, bookingDurations: { ...bookingDurations, defaultMinutes: 60 } })).toThrow();
  });

  it('aligns supported lengths only when the full slot fits and preserves legacy lengths', () => {
    const date = '2026-11-23';
    const search = { now: new Date(2026, 10, 23, 8) };
    const records = {
      ...emptyRecords(), workingHours: [{ day: 1, start: '09:02', end: '09:34' }],
    };
    expect(gridBookingSlotsOnDate(records, date, 30, search)).toEqual([]);
    const legacy = gridBookingSlotsOnDate(records, date, 31, search);
    expect(legacy[0]).toEqual({ date, start: '09:02', end: '09:33' });
    expect(isOnBookingMinuteGrid(legacy[0])).toBe(false);
    const extended = { ...records, workingHours: [{ day: 1, start: '09:02', end: '09:36' }] };
    const slots = gridBookingSlotsOnDate(extended, date, 30, search);
    expect(slots).toEqual([{ date, start: '09:05', end: '09:35' }]);
    expect(isOnBookingMinuteGrid(slots[0])).toBe(true);
  });
});
