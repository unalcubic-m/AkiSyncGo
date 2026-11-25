import { addDays, clockTime, daysBetween, minutes, parseDate } from './dates';
import { t } from '../i18n';
import type { BreakRule, Records, Slot, TimeRange } from './model';

export function timeRangesOverlap(a: TimeRange, b: TimeRange) {
  return a.start < b.end && b.start < a.end;
}

export function hoursForDate(records: Records, date: string) {
  const override = records.hoursOverrides.find(item => item.date === date);
  if (override) return override.windows;
  const day = parseDate(date).getDay();
  return records.workingHours.filter(window => window.day === day);
}

export function nextClinicDates(records: Records, today: string) {
  const dates: string[] = [];
  const specialDates = records.hoursOverrides.filter(item => item.windows.length).map(item => item.date).sort();
  let date = addDays(today, 1);
  while (dates.length < 3 && date.length === 10) {
    if (!records.workingHours.length) {
      const next = specialDates.find(candidate => candidate >= date);
      if (!next) break;
      date = next;
    }
    const closedThrough = records.timeOff.reduce((through, off) =>
      !off.hours && off.from <= date && off.through >= date && off.through > through ? off.through : through, '');
    if (closedThrough) {
      date = addDays(closedThrough, 1);
      continue;
    }
    if (hoursForDate(records, date).length) dates.push(date);
    date = addDays(date, 1);
  }
  return dates;
}

export function slotForDuration(date: string, start: string, duration: number): Slot {
  const end = minutes(start) + duration;
  return { date, start, end: end < 24 * 60 && duration > 0 ? clockTime(end) : '' };
}

export function formatDuration(duration: number) {
  if (duration < 120) return t('{minutes} min', { minutes: duration });
  const hours = Math.floor(duration / 60);
  const remainder = duration % 60;
  return remainder ? t('{hours} hr {minutes} min', { hours, minutes: remainder }) : t('{hours} hr', { hours });
}

export function breakOccursOn(rule: BreakRule, date: string) {
  if (!rule.repeat) return date === rule.from;
  if (date < rule.from) return false;
  const { weekdays, end } = rule.repeat;
  const weekday = parseDate(date).getDay();
  if (!weekdays.includes(weekday)) return false;
  if (end.type === 'date') return date <= end.through;
  if (end.type === 'never') return true;

  const elapsed = daysBetween(rule.from, date);
  const remainder = elapsed % 7;
  const firstWeekday = parseDate(rule.from).getDay();
  let index = Math.floor(elapsed / 7) * weekdays.length;
  for (let offset = 0; offset <= remainder; offset += 1) {
    if (weekdays.includes((firstWeekday + offset) % 7)) index += 1;
  }
  return index <= end.count;
}

export function breakPreviewDates(rule: BreakRule, limit: number) {
  const dates: string[] = [];
  for (let offset = 0; offset < 7 * limit && dates.length < limit; offset += 1) {
    const date = addDays(rule.from, offset);
    if (breakOccursOn(rule, date)) dates.push(date);
  }
  return dates;
}

export function breaksForDate(records: Records, date: string) {
  return records.breaks.flatMap(rule => {
    const changed = rule.changes.flatMap(({ date: source, replacement }) =>
      replacement?.date === date && breakOccursOn(rule, source)
        ? [{ ...replacement, rule, source }] : []);
    if (breakOccursOn(rule, date) && !rule.changes.some(change => change.date === date)) {
      changed.push({ date, ...rule.hours, rule, source: date });
    }
    return changed;
  }).sort((a, b) => a.start.localeCompare(b.start));
}
