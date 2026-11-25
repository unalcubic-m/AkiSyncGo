import { slotForDuration } from './availability';
import { bookingMinuteStep, isCustomBookingDuration } from './booking-durations';
import { clockTime, minutes } from './dates';
import type { Records, Slot } from './model';
import { appointmentSlotsOnDate, isSlotAvailable, type SlotSearch } from './workflows';

export function gridBookingSlotsOnDate(records: Records, date: string, duration: number, search: SlotSearch, opening?: Slot) {
  if (opening && opening.date !== date) return [];
  const suggestions = appointmentSlotsOnDate(records, date, duration, search);
  const withinOpening = (slot: Slot) => !opening || slot.start >= opening.start && slot.end <= opening.end;
  if (!isCustomBookingDuration(duration)) return suggestions.filter(withinOpening);

  const slots = new Map<string, Slot>();
  for (const suggestion of suggestions) {
    const start = minutes(suggestion.start);
    const before = Math.floor(start / bookingMinuteStep) * bookingMinuteStep;
    const after = Math.ceil(start / bookingMinuteStep) * bookingMinuteStep;
    const closest = start - before <= after - start ? [before, after] : [after, before];
    for (const minute of closest) {
      const slot = slotForDuration(date, clockTime(minute), duration);
      if (!withinOpening(slot) || !isSlotAvailable(records, slot, search)) continue;
      slots.set(slot.start, slot);
      break;
    }
  }
  return [...slots.values()].sort((a, b) => a.start.localeCompare(b.start));
}
