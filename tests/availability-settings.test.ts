import { describe, expect, it } from 'vitest';
import { availabilityAlertDates, defaultAvailabilitySettings } from '../src/domain/availability-settings';
import { emptyRecords, type Records } from '../src/domain/model';
import { appointmentOpeningsOn } from '../src/domain/workflows';

const schedule: Records = {
  ...emptyRecords(),
  workingHours: [1, 2, 3].map(day => ({ day, start: '09:00', end: '17:00' })),
};
const monday = '2026-11-30';
const tuesday = '2026-12-01';

describe('Today availability dates', () => {
  it.each([
    { weekday: 'Monday', today: '2026-11-23', dates: ['2026-11-24', '2026-11-25'] },
    { weekday: 'Wednesday', today: '2026-11-25', dates: [monday] },
    { weekday: 'Thursday', today: '2026-11-26', dates: [monday] },
    { weekday: 'Friday', today: '2026-11-27', dates: [monday] },
  ])('finds the expected working dates on $weekday', ({ today, dates }) => {
    expect(availabilityAlertDates(schedule, today)).toEqual(dates);
  });

  it('respects a wider configured calendar limit', () => {
    expect(availabilityAlertDates(schedule, '2026-11-27', { ...defaultAvailabilitySettings, calendarDays: 4 }))
      .toEqual([monday, tuesday]);
  });

  it('counts a fully booked working day without replacing it with a later one', () => {
    const booked: Records = {
      ...schedule,
      appointments: [{
        id: 'busy-monday', date: monday, start: '09:00', end: '17:00', kind: 'Block', status: 'Blocked time',
        patientId: null, title: 'Booked', procedure: '', notes: '', exceptions: [],
      }],
    };
    expect(availabilityAlertDates(booked, '2026-11-27')).toEqual([monday]);
    expect(appointmentOpeningsOn(booked, monday)).toEqual([]);
  });

  it('skips closed days during the fallback and never extends it beyond five calendar days', () => {
    const closed: Records = {
      ...schedule,
      timeOff: [{ id: 'monday-off', title: 'Closed', from: monday, through: monday, hours: null }],
    };
    expect(availabilityAlertDates(closed, '2026-11-27')).toEqual([tuesday]);
    expect(availabilityAlertDates(closed, '2026-11-25')).toEqual([]);
  });
});
