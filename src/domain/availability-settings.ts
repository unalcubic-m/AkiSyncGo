import { z } from 'zod';
import { hoursForDate } from './availability';
import { addDays } from './dates';
import type { Records } from './model';

export const maxAlertDays = 365;
export const availabilityFallbackDays = 5;
export const reminderTimeChoices = ['10:30', '12:30', '16:00', '17:00', '19:00'];
const reminderClockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const alertDays = z.number().int().min(1).max(maxAlertDays);

export const availabilitySettingsSchema = z.object({
  workingDays: alertDays,
  calendarDays: alertDays,
  remindersEnabled: z.boolean(),
  minimumMinutes: z.number().int().min(1).max(1439),
  reminderTimes: z.array(reminderClockTime).min(1).max(reminderTimeChoices.length)
    .refine(times => new Set(times).size === times.length),
});

export type AvailabilitySettings = z.infer<typeof availabilitySettingsSchema>;

export const defaultAvailabilitySettings: AvailabilitySettings = {
  workingDays: 2,
  calendarDays: 3,
  remindersEnabled: false,
  minimumMinutes: 30,
  reminderTimes: reminderTimeChoices.slice(0, 3),
};

export function availabilitySettingsFor(records: Records): AvailabilitySettings {
  return records.availabilitySettings ?? defaultAvailabilitySettings;
}

export function availabilityAlertDates(records: Records, today: string, settings = availabilitySettingsFor(records)): string[] {
  const dates: string[] = [];
  const lookahead = Math.max(settings.calendarDays, availabilityFallbackDays);
  for (let offset = 1; offset <= lookahead && dates.length < settings.workingDays; offset++) {
    if (offset > settings.calendarDays && dates.length) break;
    const date = addDays(today, offset);
    const closed = records.timeOff.some(item => !item.hours && item.from <= date && date <= item.through);
    if (!closed && hoursForDate(records, date).length) dates.push(date);
  }
  return dates;
}
