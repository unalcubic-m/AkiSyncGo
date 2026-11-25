import { hoursForDate } from './availability';
import { addDays, daysBetween, parseDate } from './dates';
import type { Records } from './model';

export const calendarViews = ['day', 'three', 'week', 'month'] as const;
export type CalendarView = typeof calendarViews[number];

function weekStart(date: string) {
  return addDays(date, -((parseDate(date).getDay() + 6) % 7));
}

export function weekDates(date: string) {
  const monday = weekStart(date);
  return Array.from({ length: 7 }, (_, index) => addDays(monday, index));
}

export function shiftMonth(date: string, offset: number) {
  const first = parseDate(date.slice(0, 7) + '-01');
  first.setMonth(first.getMonth() + offset);
  const year = String(first.getFullYear()).padStart(4, '0');
  return year + '-' + String(first.getMonth() + 1).padStart(2, '0') + '-01';
}

export function monthDates(date: string) {
  const first = weekStart(date.slice(0, 7) + '-01');
  const last = addDays(weekStart(addDays(shiftMonth(date, 1), -1)), 6);
  return Array.from({ length: daysBetween(first, last) + 1 }, (_, index) => addDays(first, index));
}

export function calendarDateFilter(records: Records, workingDaysOnly: boolean) {
  if (!workingDaysOnly) return { includes: () => true, find: (date: string) => date };
  const booked = new Set(records.appointments
    .filter(item => item.kind === 'Visit' && item.status !== 'Cancelled' && item.status !== 'Postponed')
    .map(item => item.date));
  const closed = records.timeOff.filter(off => !off.hours);
  const closureOn = (date: string) => closed.find(off => off.from <= date && off.through >= date);
  const includes = (date: string) => booked.has(date) || (!closureOn(date) && hoursForDate(records, date).length > 0);
  const special = [...booked, ...records.hoursOverrides.filter(item => item.windows.length).map(item => item.date)]
    .filter(includes).sort();

  function find(start: string, direction: -1 | 1 = 1): string | undefined {
    const extra = direction === 1 ? special.find(date => date >= start) : special.filter(date => date <= start).at(-1);
    if (!records.workingHours.length) return extra;

    let date = start;
    while (date.length === 10) {
      if (extra && (direction === 1 ? extra <= date : extra >= date)) return extra;
      const closure = closureOn(date);
      if (!closure && hoursForDate(records, date).length) return date;
      date = addDays(closure ? direction === 1 ? closure.through : closure.from : date, direction);
    }
    return extra;
  }

  return { includes, find };
}

export function calendarDateRun(filter: ReturnType<typeof calendarDateFilter>, start: string, length: number, direction: -1 | 1 = 1) {
  const dates: string[] = [];
  let next = filter.find(start, direction);
  while (next && dates.length < length) {
    dates.push(next);
    next = dates.length < length ? filter.find(addDays(next, direction), direction) : undefined;
  }
  return dates;
}

export function placeCalendarEntries<T extends { start: number; end: number }>(entries: T[]) {
  const placed: { entry: T; lane: number; lanes: number }[] = [];
  let laneEnds: number[] = [];
  let clusterStart = 0;
  let clusterEnd = -Infinity;

  function closeCluster() {
    for (let index = clusterStart; index < placed.length; index++) placed[index].lanes = laneEnds.length;
    clusterStart = placed.length;
    laneEnds = [];
  }

  for (const entry of [...entries].sort((a, b) => a.start - b.start || b.end - a.end)) {
    if (entry.start >= clusterEnd) closeCluster();
    const freeLane = laneEnds.findIndex(end => end <= entry.start);
    const lane = freeLane < 0 ? laneEnds.length : freeLane;
    laneEnds[lane] = entry.end;
    clusterEnd = Math.max(clusterEnd, entry.end);
    placed.push({ entry, lane, lanes: 1 });
  }
  closeCluster();
  return placed;
}
