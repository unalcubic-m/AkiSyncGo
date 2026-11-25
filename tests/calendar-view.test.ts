import { expect, it } from 'vitest';
import { calendarDateFilter, calendarDateRun, placeCalendarEntries, weekDates } from '../src/domain/calendar-view';
import { fictionalRecords } from '../src/storage/fixtures';

it('uses every combination of working weekdays and includes a booked appointment on any closed day', () => {
  const records = fictionalRecords(new Date(2026, 10, 23, 8));
  const appointment = records.appointments.find(item => item.kind === 'Visit')!;
  const dates = weekDates('2026-11-23');

  for (let combination = 0; combination < 128; combination++) {
    const working = dates.map((_, index) => Boolean(combination & (1 << index)));
    const workingHours = working.flatMap((enabled, index) => enabled
      ? [{ day: (index + 1) % 7, start: '09:00', end: '17:00' }] : []);
    const schedule = { ...records, workingHours, appointments: [] };
    const filter = calendarDateFilter(schedule, true);
    expect(dates.filter(filter.includes)).toEqual(dates.filter((_, index) => working[index]));

    for (const [bookedIndex, date] of dates.entries()) {
      if (working[bookedIndex]) continue;
      const withBooking = calendarDateFilter({ ...schedule, appointments: [{ ...appointment, date }] }, true);
      expect(dates.filter(withBooking.includes)).toEqual(dates.filter((_, index) => working[index] || index === bookedIndex));
    }
  }
});

it('keeps a booked day during a long closure and resumes on the next working day', () => {
  const records = fictionalRecords(new Date(2026, 10, 23, 8));
  records.timeOff = [{ id: 'leave', title: 'Clinic leave', from: '2026-11-24', through: '2026-12-31', hours: null }];
  const filter = calendarDateFilter(records, true);
  expect(calendarDateRun(filter, '2026-11-24', 3)).toEqual(['2026-11-25', '2026-11-27', '2027-01-01']);
  expect(calendarDateRun(filter, '2027-01-01', 3, -1)).toEqual(['2027-01-01', '2026-11-27', '2026-11-25']);
});

it('gives overlapping timeline entries separate lanes and resets at the next free slot', () => {
  const lunch = { start: 720, end: 780 };
  const first = { start: 540, end: 600 };
  const overlap = { start: 570, end: 630 };
  expect(placeCalendarEntries([lunch, overlap, first])).toEqual([
    { entry: first, lane: 0, lanes: 2 },
    { entry: overlap, lane: 1, lanes: 2 },
    { entry: lunch, lane: 0, lanes: 1 },
  ]);
});
