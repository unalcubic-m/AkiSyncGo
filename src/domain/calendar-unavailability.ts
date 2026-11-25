import { breaksForDate, hoursForDate } from './availability';
import { calendarEventsWithBuffer, eventBufferFor } from './calendar-event-buffer';
import { addDays, localDate } from './dates';
import { calendarRange, localTimestamp, type DeviceCalendarTiming } from './device-calendar';
import type { Records, TimeRange } from './model';

export const publishingHorizons = [30, 90, 180, 365] as const;

export type UnavailabilityPreferences = {
  closures: boolean;
  breaks: boolean;
  external: boolean;
  buffers: boolean;
  workingHoursOnly: boolean;
  horizon: typeof publishingHorizons[number];
};

export const defaultUnavailabilityPreferences: UnavailabilityPreferences = {
  closures: true, breaks: true, external: true, buffers: true, workingHoursOnly: true, horizon: 90,
};

type Interval = { begin: number; end: number };

function mergeIntervals(intervals: Interval[]) {
  const merged: Interval[] = [];
  for (const interval of intervals.sort((a, b) => a.begin - b.begin)) {
    if (interval.end <= interval.begin) continue;
    const previous = merged.at(-1);
    if (previous && interval.begin <= previous.end) previous.end = Math.max(previous.end, interval.end);
    else merged.push({ ...interval });
  }
  return merged;
}

function excludeAllDay(interval: Interval, allDay: Interval[]) {
  const remainder: Interval[] = [];
  let begin = interval.begin;
  for (const closure of allDay) {
    if (closure.begin >= interval.end) break;
    if (closure.end <= begin) continue;
    if (begin < closure.begin) remainder.push({ begin, end: closure.begin });
    begin = closure.end;
  }
  if (begin < interval.end) remainder.push({ begin, end: interval.end });
  return remainder;
}

function timedInterval(date: string, hours: TimeRange): Interval {
  return { begin: localTimestamp(date, hours.start), end: localTimestamp(date, hours.end) };
}

function publishingWindow(today: string, preferences: UnavailabilityPreferences) {
  return { from: addDays(today, -1), through: addDays(today, preferences.horizon - 1) };
}

function bufferMinutes(records: Records, preferences: UnavailabilityPreferences) {
  const buffer = eventBufferFor(records);
  return preferences.buffers && buffer.enabled ? buffer.minutes : 0;
}

export function externalPublishingDates(records: Records, today: string, preferences: UnavailabilityPreferences) {
  const { from, through } = publishingWindow(today, preferences);
  // A next-day event can have a buffer that starts inside the publishing window.
  return { from, through: bufferMinutes(records, preferences) ? addDays(through, 1) : through };
}

export function calendarUnavailabilitySnapshot(records: Records, today: string, preferences: UnavailabilityPreferences,
                                               external: DeviceCalendarTiming[]) {
  const { from, through } = publishingWindow(today, preferences);
  const { from: cutoff, until } = calendarRange(from, through);
  const timed: Interval[] = [];
  const allDay: Interval[] = [];

  if (preferences.closures) {
    for (const block of records.appointments) {
      if (block.kind === 'Block' && block.status === 'Blocked time' && block.date >= from) {
        timed.push(timedInterval(block.date, block));
      }
    }
    for (const closure of records.timeOff) {
      if (closure.through < from) continue;
      if (!closure.hours) {
        allDay.push({ begin: localTimestamp(closure.from), end: localTimestamp(addDays(closure.through, 1)) });
        continue;
      }
      for (let date = closure.from < from ? from : closure.from; date <= closure.through; date = addDays(date, 1)) {
        timed.push(timedInterval(date, closure.hours));
        if (date === closure.through) break;
      }
    }
  }

  if (preferences.breaks) {
    const dates = new Set<string>();
    if (records.breaks.some(rule => rule.repeat)) {
      for (let date = from; date <= through; date = addDays(date, 1)) dates.add(date);
    }
    for (const rule of records.breaks) {
      if (rule.repeat) continue;
      dates.add(rule.from);
      for (const { replacement } of rule.changes) {
        if (replacement) dates.add(replacement.date);
      }
    }
    for (const date of dates) {
      if (date < from) continue;
      for (const occurrence of breaksForDate(records, date)) {
        if (!occurrence.rule.repeat || date <= through) timed.push(timedInterval(date, occurrence));
      }
    }
  }

  if (preferences.external) {
    const buffered = calendarEventsWithBuffer(external.filter(event => !event.ignored), bufferMinutes(records, preferences)) ?? [];
    const busy = mergeIntervals(buffered.map(event => ({ begin: Math.max(cutoff, event.begin), end: Math.min(until, event.end) })));
    if (preferences.workingHoursOnly) {
      for (let date = from; date <= through && busy.length; date = addDays(date, 1)) {
        for (const window of hoursForDate(records, date)) {
          const { begin, end } = timedInterval(date, window);
          for (const event of busy) {
            if (event.begin >= end) break;
            if (event.end > begin) timed.push({ begin: Math.max(begin, event.begin), end: Math.min(end, event.end) });
          }
        }
      }
    } else timed.push(...busy);
  }

  const fullDays = mergeIntervals(allDay);
  const blocks = [
    // Android's all-day events use UTC midnights for the local calendar dates.
    ...fullDays.map(({ begin, end }) => ({
      start: Date.parse(localDate(new Date(begin))), end: Date.parse(localDate(new Date(end))), allDay: true,
    })),
    ...mergeIntervals(timed).flatMap(interval => excludeAllDay(interval, fullDays))
      .map(({ begin, end }) => ({ start: begin, end, allDay: false })),
  ];
  return { cutoff, allDayCutoff: Date.parse(from), zone: Intl.DateTimeFormat().resolvedOptions().timeZone, blocks };
}
