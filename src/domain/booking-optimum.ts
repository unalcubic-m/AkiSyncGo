import { nextClinicDates, slotForDuration } from './availability';
import { addDays, clockTime, localDate, minutes } from './dates';
import { localTimestamp } from './device-calendar';
import { maxAppointmentDuration, type Records, type Slot } from './model';
import { freeAppointmentWindows, type SlotSearch } from './workflows';

const reserveMinutes = 180;
const optimumLookaheadDays = 7;
const minuteStep = 5;

type BookingSearch = SlotSearch & { from: string; through: string; requestNow?: Date };
export type BookingReserve = 'preserved' | 'lost';

type BookingOptions = {
  first?: Slot;
  optimum?: Slot;
  regularThrough: string;
  earlier: (current: Slot) => Slot[];
  later: (current: Slot) => Slot[];
  reserve: (slot: Slot) => BookingReserve | undefined;
  reserveOpening: (slot: Slot) => Slot | undefined;
};

type Window = ReturnType<typeof freeAppointmentWindows>[number];
type Candidate = { slot: Slot; gapMinutes: number; losesReserve: boolean };

function compareStarts(left: Slot, right: Slot) {
  return left.date.localeCompare(right.date) || left.start.localeCompare(right.start);
}

function compareCandidates(left: Candidate, right: Candidate) {
  return Number(left.losesReserve) - Number(right.losesReserve)
    || left.slot.date.localeCompare(right.slot.date)
    || left.gapMinutes - right.gapMinutes
    || left.slot.start.localeCompare(right.slot.start);
}

function compareLaterCandidates(left: Candidate, right: Candidate) {
  return Number(left.losesReserve) - Number(right.losesReserve)
    || left.gapMinutes - right.gapMinutes
    || compareStarts(left.slot, right.slot);
}

const roundUp = (minute: number, step: number) => Math.ceil(minute / step) * step;
const roundDown = (minute: number, step: number) => Math.floor(minute / step) * step;

function fittingMinutes(date: string, start: number, end: number) {
  if (end <= start) return 0;
  const elapsed = (localTimestamp(date, clockTime(end)) - localTimestamp(date, clockTime(start))) / 60_000;
  return Math.max(0, Math.min(end - start, elapsed));
}

export function findBookingOptions(records: Records, duration: number, {
  from, through, now, requestNow = now, excludeId, events,
}: BookingSearch): BookingOptions {
  const today = localDate(requestNow);
  const regularThrough = addDays(today, optimumLookaheadDays);
  if (!Number.isInteger(duration) || duration <= 0 || duration > maxAppointmentDuration) {
    return { regularThrough, earlier: () => [], later: () => [], reserve: () => undefined, reserveOpening: () => undefined };
  }

  const earliestStart = new Date(Math.ceil(now.getTime() / 60_000) * 60_000);
  // Existing duration settings accept any whole minute. Keep those lengths exact.
  const step = duration % minuteStep === 0 ? minuteStep : 1;
  const windowsByDate = new Map<string, Window[]>();

  function windowsOn(date: string) {
    let windows = windowsByDate.get(date);
    if (!windows) {
      windows = freeAppointmentWindows(records, date, { now: earliestStart, excludeId, events });
      windowsByDate.set(date, windows);
    }
    return windows;
  }

  const reservedWindows = duration < reserveMinutes
    ? [today, ...nextClinicDates(records, today).slice(0, 2)].flatMap(date => windowsOn(date).flatMap(window => {
      const start = roundUp(minutes(window.start), minuteStep);
      const end = roundDown(minutes(window.end), minuteStep);
      return fittingMinutes(date, start, end) >= reserveMinutes ? [{ date, start, end }] : [];
    })) : [];

  function reserveDetails(slot: Slot): { state: BookingReserve; window: typeof reservedWindows[number] } | undefined {
    if (!reservedWindows.length || !slot.start || slot.end <= slot.start) return;
    const start = roundDown(minutes(slot.start), minuteStep);
    const end = roundUp(minutes(slot.end), minuteStep);
    for (const window of reservedWindows) {
      if (window.date !== slot.date) return { state: 'preserved', window };

      const leftEnd = Math.min(start, window.end);
      if (fittingMinutes(window.date, window.start, leftEnd) >= reserveMinutes) {
        return { state: 'preserved', window: { ...window, end: leftEnd } };
      }
      const rightStart = Math.max(end, window.start);
      if (fittingMinutes(window.date, rightStart, window.end) >= reserveMinutes) {
        return { state: 'preserved', window: { ...window, start: rightStart } };
      }
    }
    return { state: 'lost', window: reservedWindows[0] };
  }

  function reserve(slot: Slot) {
    return reserveDetails(slot)?.state;
  }

  function reserveOpening(slot: Slot) {
    const window = reserveDetails(slot)?.window;
    if (window) return { date: window.date, start: clockTime(window.start), end: clockTime(window.end) };
  }

  const candidatesByDate = new Map<string, Candidate[]>();
  function candidatesOn(date: string) {
    let candidates = candidatesByDate.get(date);
    if (!candidates) {
      candidates = windowsOn(date).flatMap(window => {
        const start = roundUp(minutes(window.start), step);
        const end = roundDown(minutes(window.end), step);
        const gapMinutes = fittingMinutes(date, start, end);
        if (gapMinutes < duration) return [];
        const slot = slotForDuration(date, clockTime(start), duration);
        return [{ slot, gapMinutes, losesReserve: reserve(slot) === 'lost' }];
      });
      candidatesByDate.set(date, candidates);
    }
    return candidates;
  }

  function candidatesThrough(lastDate: string) {
    const candidates: Candidate[] = [];
    for (let date = from; date <= lastDate; date = addDays(date, 1)) candidates.push(...candidatesOn(date));
    return candidates;
  }

  let first: Slot | undefined;
  for (let date = from; date <= through && !first; date = addDays(date, 1)) {
    first = candidatesOn(date)[0]?.slot;
  }

  const regularEnd = through < regularThrough ? through : regularThrough;
  const optimum = first && duration < reserveMinutes && first.date <= regularThrough
    ? candidatesThrough(regularEnd).sort(compareCandidates)[0]?.slot ?? first
    : first;

  function earlier(current: Slot) {
    if (!first || compareStarts(first, current) >= 0) return [];
    if (duration >= reserveMinutes) return [first];
    const reachable: Slot[] = [];
    let next = current;
    const ordered = candidatesThrough(through < current.date ? through : current.date).sort(compareCandidates);
    for (const { slot } of ordered) {
      if (compareStarts(slot, next) >= 0) continue;
      reachable.push(slot);
      next = slot;
    }
    return reachable;
  }

  let laterCandidates: Candidate[] | undefined;
  function later(current: Slot) {
    if (!current.date || !current.start) return [];
    if (!laterCandidates) {
      const candidates = candidatesThrough(regularEnd);
      const extraDate = regularThrough < through ? nextClinicDates(records, regularThrough)[0] : undefined;
      if (extraDate && extraDate >= from && extraDate <= through) candidates.push(...candidatesOn(extraDate));
      laterCandidates = candidates.sort(compareLaterCandidates);
    }

    const reachable: Slot[] = [];
    let next = current;
    for (const { slot } of laterCandidates) {
      if (compareStarts(slot, next) <= 0) continue;
      reachable.push(slot);
      next = slot;
    }
    return reachable;
  }

  return { first, optimum, regularThrough, earlier, later, reserve, reserveOpening };
}
