import { bookingMinuteStep, isCustomBookingDuration, isOnBookingMinuteGrid, maximumCustomBookingDuration } from '../../src/domain/booking-durations';
import { gridBookingSlotsOnDate } from '../../src/domain/booking-time-grid';
import { addDays } from '../../src/domain/dates';
import type { Records, Slot } from '../../src/domain/model';
import type { SlotSearch as Search } from '../../src/domain/workflows';

export { bookingMinuteStep, maximumCustomBookingDuration as maximumGridDuration, isCustomBookingDuration as isGridDuration,
  isOnBookingMinuteGrid as isGridSlot };

export function gridSlotsOnDate(records: Records, date: string, length: number, search: Search, opening?: Slot) {
  return isCustomBookingDuration(length) ? gridBookingSlotsOnDate(records, date, length, search, opening) : [];
}

export function findGridDay(records: Records, range: { from: string; through: string }, direction: -1 | 1, length: number, search: Search) {
  if (!isCustomBookingDuration(length)) return;
  for (let date = direction === 1 ? range.from : range.through; date >= range.from && date <= range.through; date = addDays(date, direction)) {
    const first = gridSlotsOnDate(records, date, length, search)[0];
    if (first) return first;
  }
}
