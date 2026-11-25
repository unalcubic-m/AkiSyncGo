import { z } from 'zod';
import { localTimestamp, type DeviceCalendarEvent } from './device-calendar';
import type { Records, Slot } from './model';

export const eventBufferDurations = [15, 30, 60] as const;
export const eventBufferSchema = z.object({ enabled: z.boolean(), minutes: z.literal(eventBufferDurations) });
export const defaultEventBuffer: z.infer<typeof eventBufferSchema> = { enabled: true, minutes: 60 };

export function eventBufferFor(records: Records) {
  return records.calendarEventBuffer ?? defaultEventBuffer;
}

export function calendarEventsWithBuffer<T extends Pick<DeviceCalendarEvent, 'begin'>>(events: T[] | undefined, minutes: number) {
  if (!events || !minutes) return events;
  return events.map(event => ({ ...event, begin: event.begin - minutes * 60_000 }));
}

export function calendarBufferConflicts(slot: Slot, events: DeviceCalendarEvent[], minutes: number) {
  if (!minutes || !slot.date || !slot.start || !slot.end || slot.end <= slot.start) return [];
  const start = localTimestamp(slot.date, slot.start);
  const end = localTimestamp(slot.date, slot.end);
  return events.filter(event => !event.ignored && event.begin > start && event.begin - minutes * 60_000 < end);
}
