import { minutes } from './dates';
import { maxAppointmentDuration, type Records, type Slot } from './model';

export type BookingDurations = NonNullable<Records['bookingDurations']>;
export const bookingMinuteStep = 5;
export const maximumCustomBookingDuration = maxAppointmentDuration - maxAppointmentDuration % bookingMinuteStep;

export function getBookingDurations(records: Records): BookingDurations {
  if (records.bookingDurations) return records.bookingDurations;
  return {
    presets: [...new Set(Object.values(records.appointmentDurations))].sort((a, b) => a - b),
    defaultMinutes: records.appointmentDurations.Medium,
  };
}

export function isCustomBookingDuration(minutes: number) {
  return minutes >= bookingMinuteStep && minutes <= maximumCustomBookingDuration && minutes % bookingMinuteStep === 0;
}

export function isOnBookingMinuteGrid({ start, end }: Slot) {
  return !!start && end > start && minutes(start) % bookingMinuteStep === 0 && minutes(end) % bookingMinuteStep === 0;
}
