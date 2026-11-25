import { describe, expect, it } from 'vitest';
import { findBookingOptions } from '../src/domain/booking-optimum';
import { emptyRecords, type Records } from '../src/domain/model';

const monday = '2026-11-23';
const tuesday = '2026-11-24';
const search = { now: new Date(2026, 10, 23, 8), from: monday, through: '2026-12-01' };

describe('Optimum opening explanation', () => {
  it('shows the same opening for the protected choice and when an earlier booking uses it', () => {
    const records: Records = { ...emptyRecords(), workingHours: [
      { day: 1, start: '09:00', end: '12:00' },
      { day: 2, start: '14:00', end: '15:30' },
      { day: 3, start: '14:00', end: '15:30' },
    ] };
    const options = findBookingOptions(records, 90, search);
    const preferred = { date: tuesday, start: '14:00', end: '15:30' };
    const earlier = { date: monday, start: '09:00', end: '10:30' };
    const opening = { date: monday, start: '09:00', end: '12:00' };

    expect(options.reserve(preferred)).toBe('preserved');
    expect(options.reserveOpening(preferred)).toEqual(opening);
    expect(options.reserve(earlier)).toBe('lost');
    expect(options.reserveOpening(earlier)).toEqual(opening);
  });

  it('shows the remaining part of the earliest opening after a visit at its edge', () => {
    const records: Records = { ...emptyRecords(), workingHours: [
      { day: 1, start: '09:02', end: '13:03' },
      { day: 2, start: '09:00', end: '12:00' },
    ] };
    const options = findBookingOptions(records, 30, search);
    const selected = { date: monday, start: '09:05', end: '09:35' };

    expect(options.reserve(selected)).toBe('preserved');
    expect(options.reserveOpening(selected))
      .toEqual({ date: monday, start: '09:35', end: '13:00' });
  });

  it('shows the next opening if a selection uses an entire earlier opening', () => {
    const records: Records = { ...emptyRecords(), workingHours: [
      { day: 1, start: '09:00', end: '12:00' },
      { day: 2, start: '10:00', end: '13:00' },
    ] };
    const options = findBookingOptions(records, 30, search);
    const selected = { date: monday, start: '10:00', end: '10:30' };

    expect(options.reserve(selected)).toBe('preserved');
    expect(options.reserveOpening(selected))
      .toEqual({ date: tuesday, start: '10:00', end: '13:00' });
  });
});
