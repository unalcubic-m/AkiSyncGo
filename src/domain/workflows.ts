import { getLocale, LocalizedError, t, translate, type Message, type MessageValues } from '../i18n';
import { breaksForDate, hoursForDate, slotForDuration } from './availability';
import { getBookingDurations } from './booking-durations';
import { addDays, daysBetween, localDate, minutes, clockTime } from './dates';
import { calendarConflicts, calendarRange, localTimestamp, type DeviceCalendarEvent } from './device-calendar';
import { type Alert, type Appointment, type ExceptionKind, type Patient, type Records, type Slot, type Visit, uppercasePatientName, upsert } from './model';
import { localOverlapKey, localOverlaps, occupiesSchedule, pruneScheduleOverlapIgnores } from './schedule-conflicts';

const priorityBoost = { Normal: 0, Urgent: 60, 'Extra urgent': 180 };
const severityOrder = { Critical: 0, Caution: 1, Info: 2 };
export const slotOrder = (a: Slot, b: Slot) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start);
const nowSlot = (now: Date) => ({
  date: localDate(now),
  start: clockTime(now.getHours() * 60 + now.getMinutes()),
  end: '',
});
export const normalizePatientSearch = (text: string) => uppercasePatientName(text).normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();

export function searchPatients(records: Records, query: string, status = 'All', priority = 'All') {
  const terms = normalizePatientSearch(query).trim().split(/\s+/).filter(Boolean);
  return records.patients.filter(patient => {
    const phone = patient.phone.replace(/\D/g, '');
    const searchable = normalizePatientSearch(`${patient.name} ${patient.phone} ${patient.email}`);
    return (status === 'All' || status === patient.status)
      && (priority === 'All' || priority === patient.priority)
      && terms.every(term => searchable.includes(term) || (/\d/.test(term) && phone.includes(term.replace(/\D/g, ''))));
  }).sort((a, b) => a.name.localeCompare(b.name, getLocale()));
}

const searchableCharacter = /[\p{L}\p{N}]/u;
const phoneSearchDigits = (value: string) => /^[\d\s+()./\p{Pd}]+$/u.test(value) ? value.replace(/\D/g, '') : '';
const normalizedSearchText = (value: string) => normalizePatientSearch(value).trim().replace(/\s+/g, ' ');

export function searchBookingPatients(patients: Patient[], query: string) {
  const text = normalizedSearchText(query);
  if (!searchableCharacter.test(text)) return [];

  const phoneQuery = phoneSearchDigits(text);
  const terms = phoneQuery ? [text] : text.split(' ').filter(term => searchableCharacter.test(term));
  const tokens = terms.map(term => ({ text: term, digits: phoneSearchDigits(term) }));
  const matches = patients.flatMap(patient => {
    const name = normalizedSearchText(patient.name);
    const email = normalizedSearchText(patient.email);
    const phone = patient.phone.replace(/\D/g, '');
    if (name === text || email === text || (phoneQuery && phone === phoneQuery)) return [{ patient, rank: 0 }];

    const nameWords = name.split(/[^\p{L}\p{N}]+/u);
    if (tokens.every(token => nameWords.some(word => word.startsWith(token.text)) || email.startsWith(token.text)
      || (token.digits && (phone.startsWith(token.digits) || phone.endsWith(token.digits))))) return [{ patient, rank: 1 }];

    if (tokens.every(token => name.includes(token.text) || email.includes(token.text)
      || (token.digits && phone.includes(token.digits)))) return [{ patient, rank: 2 }];
    return [];
  });

  const locale = getLocale();
  return matches.sort((a, b) => a.rank - b.rank
    || Number(a.patient.status === 'Passive') - Number(b.patient.status === 'Passive')
    || a.patient.name.localeCompare(b.patient.name, locale)
    || a.patient.id.localeCompare(b.patient.id)).map(({ patient }) => patient);
}

export function activeAlerts(records: Records, patientId: string): Alert[] {
  return records.alerts.filter(alert => alert.patientId === patientId && alert.active)
    .sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity] || a.label.localeCompare(b.label, getLocale()));
}

export function agenda(records: Records, date: string) {
  return records.appointments.filter(item => item.date === date).sort(slotOrder);
}

export function appointmentOpeningsOn(records: Records, date: string, events: DeviceCalendarEvent[] = []) {
  const minimumDuration = Math.max(60, Math.min(...getBookingDurations(records).presets));
  const now = new Date(localTimestamp(date));
  return freeAppointmentWindows(records, date, { now, events }).filter(slot =>
    slot.duration >= minimumDuration && isSlotAvailable(records, slot, { now, events }));
}

export type SlotSearch = { now: Date; excludeId?: string; events?: DeviceCalendarEvent[] };

export function freeAppointmentWindows(records: Records, date: string, { now, excludeId, events = [] }: SlotSearch) {
  const current = nowSlot(now);
  if (!date || date < current.date) return [];
  const windows = hoursForDate(records, date);
  if (!windows.length) return [];
  const timeOff = records.timeOff.filter(off => off.from <= date && off.through >= date);
  if (timeOff.some(off => !off.hours)) return [];

  const { from, until } = calendarRange(date, date);
  const localBlocks = [
    ...records.appointments.filter(item => item.date === date && item.id !== excludeId && occupiesSchedule(item)),
    ...timeOff.flatMap(off => off.hours ? [off.hours] : []),
    ...breaksForDate(records, date),
  ];
  const busy = [
    ...localBlocks.map(block => ({ begin: localTimestamp(date, block.start), end: localTimestamp(date, block.end) })),
    ...events.filter(event => !event.ignored && event.begin < until && event.end > from),
  ].sort((a, b) => a.begin - b.begin);

  const openings: (Slot & { duration: number })[] = [];
  function addOpening(begin: number, end: number) {
    if (end <= begin) return;
    const startTime = new Date(Math.ceil(begin / 60_000) * 60_000);
    const endTime = new Date(Math.floor(end / 60_000) * 60_000);
    const start = startTime.getHours() * 60 + startTime.getMinutes();
    const finish = endTime.getHours() * 60 + endTime.getMinutes();
    const duration = Math.min(finish - start, (endTime.getTime() - startTime.getTime()) / 60_000);
    if (duration > 0) openings.push({ date, start: clockTime(start), end: clockTime(finish), duration });
  }

  const cutoff = date === current.date ? localTimestamp(date, current.start) : from;
  for (const window of windows) {
    let cursor = Math.max(cutoff, localTimestamp(date, window.start));
    const end = localTimestamp(date, window.end);
    for (const block of busy) {
      if (cursor >= end) break;
      addOpening(cursor, Math.min(block.begin, end));
      cursor = Math.max(cursor, block.end);
    }
    addOpening(cursor, end);
  }
  return openings.sort(slotOrder);
}

export function upcomingVisits(records: Records, today: string, now = new Date()) {
  const current = nowSlot(now);
  return records.appointments.filter((item): item is Visit => item.kind === 'Visit' && item.status === 'Scheduled'
    && item.date >= today && (item.date > current.date || (item.date === current.date && item.end > current.start)))
    .sort(slotOrder);
}

export function bookingBlockers(records: Records) {
  return [
    ...records.waits.filter(wait => wait.status === 'Waiting' && wait.blocks)
      .map(({ id, patientId, title }) => ({ id, patientId, title, code: `wait:${id}`, kind: 'Blocking waits' as const })),
    ...openTasks(records.tasks).filter(task => task.blocks && task.patientId !== null)
      .map(({ id, patientId, title }) => ({ id, patientId, title, code: `task:${id}`, kind: 'Blocking tasks' as const })),
  ];
}

export function readyToBookPatients(records: Records, today: string) {
  const scheduled = new Set(records.appointments.filter(item => item.kind === 'Visit'
    && item.status === 'Scheduled' && item.date >= today).map(item => item.patientId));
  const blocked = new Set(bookingBlockers(records).map(hold => hold.patientId));
  return records.patients.filter(patient => patient.status === 'Active' && !scheduled.has(patient.id) && !blocked.has(patient.id));
}

export function planningCandidates(records: Records, today: string) {
  const lastSeen = new Map<string, string>();
  const remember = (patientId: string, date: string) => {
    if (date <= today && date > (lastSeen.get(patientId) ?? '')) lastSeen.set(patientId, date);
  };

  for (const item of records.appointments) {
    if (item.kind === 'Visit' && item.status === 'Completed') remember(item.patientId, item.date);
  }
  for (const note of records.notes) {
    if (note.type === 'Clinical visit') remember(note.patientId, note.date);
  }

  return readyToBookPatients(records, today)
    .map(patient => {
      const seenOn = lastSeen.get(patient.id) ?? null;
      const elapsedDays = Math.max(0, daysBetween(seenOn ?? patient.createdOn, today));
      return { patient, seenOn, elapsedDays, score: priorityBoost[patient.priority] + elapsedDays * 3 };
    })
    .sort((a, b) => b.score - a.score || a.patient.name.localeCompare(b.patient.name, getLocale()));
}

export function responseReviews(records: Records, today: string) {
  return records.waits.filter(wait => wait.status === 'Waiting' && (!wait.reviewOn || wait.reviewOn <= today))
    .sort((a, b) => (a.reviewOn ?? '').localeCompare(b.reviewOn ?? ''));
}

export function openTasks(tasks: Records['tasks']) {
  return tasks.filter(task => !task.completedOn && !task.bookingCallback);
}

export function outstandingVisits(records: Records, now = new Date()) {
  const current = nowSlot(now);
  return records.appointments.filter((item): item is Visit => item.kind === 'Visit' && item.status === 'Scheduled'
    && (item.date < current.date || (item.date === current.date && item.end <= current.start)))
    .sort(slotOrder);
}

export function closeTreatment(records: Records, id: string, closedOn: string, closureNote: string): Records {
  const treatment = records.treatments.find(item => item.id === id);
  if (!treatment || treatment.status !== 'Active') throw new Error('This treatment is already closed or unavailable.');
  if (closedOn < treatment.startedOn || closedOn > localDate()) throw new Error('Choose a closure date from the treatment start through today.');
  return { ...records, treatments: upsert(records.treatments, { ...treatment, status: 'Closed', closedOn, closureNote }) };
}

type ReasonKind = Exclude<ExceptionKind, 'Overlapping appointments' | 'Scheduling overlaps'>;
export type SlotIssue = { code: string; messageKey: Message; values?: MessageValues; kind?: ReasonKind; confirmationKey?: string };
export class VisitOverlapConfirmationRequired extends Error {}

export function assessSlot(records: Records, slot: Slot, patientId: string | null, excludeId?: string, now = new Date()): SlotIssue[] {
  if (!slot.date || !slot.start || !slot.end || slot.end <= slot.start) {
    return [{ code: 'invalid', messageKey: 'Choose a date and an end time after the start time.' }];
  }

  const issues: SlotIssue[] = [];
  if (slotOrder(slot, nowSlot(now)) < 0) issues.push({ code: 'past', messageKey: 'Choose a time that has not passed.' });
  const hours = hoursForDate(records, slot.date);
  if (!hours.some(item => item.start <= slot.start && item.end >= slot.end)) {
    issues.push({ code: 'hours', messageKey: 'This slot is outside working hours.', kind: 'Working hours / time off' });
  }
  for (const overlap of localOverlaps(records, slot, excludeId)) {
    const confirmationKey = patientId !== null || (overlap.kind === 'appointment' && overlap.item.kind === 'Visit')
      ? localOverlapKey(slot, patientId, overlap) : undefined;
    const exception = confirmationKey ? { confirmationKey } : { kind: 'Working hours / time off' as const };
    switch (overlap.kind) {
      case 'time-off': issues.push({ code: `time-off:${overlap.item.id}`, messageKey: 'Time off overlaps this slot: {title}.',
        values: { title: overlap.item.title }, ...exception }); break;
      case 'break': issues.push({ code: `break:${overlap.rule.id}:${overlap.source}`, messageKey: 'A break overlaps this slot: {title}.',
        values: { title: overlap.rule.title }, ...exception }); break;
      case 'appointment': {
        const item = overlap.item;
        const name = records.patients.find(patient => patient.id === item.patientId)?.name ?? item.title;
        issues.push({ code: 'overlap:' + item.id, messageKey: '{start}–{end} overlaps with {name}.',
          values: { start: item.start, end: item.end, name }, confirmationKey });
        break;
      }
    }
  }
  if (patientId) {
    for (const hold of bookingBlockers(records)) {
      if (hold.patientId === patientId) {
        issues.push({ code: hold.code, messageKey: 'Booking is blocked by: {title}.', values: { title: hold.title }, kind: hold.kind });
      }
    }
  }
  return issues;
}

export type Exceptions = Partial<Record<ReasonKind, string>>;

export function requiresSlotCheck(item: Appointment, original?: Appointment) {
  return occupiesSchedule(item) && (!original || !occupiesSchedule(original)
    || item.patientId !== original.patientId || slotOrder(item, original) !== 0 || item.end !== original.end);
}

export function saveAppointment(
  records: Records, item: Appointment, reasons: Exceptions, now = new Date(), confirmedOverlaps: readonly string[] = [],
): Records {
  const original = records.appointments.find(row => row.id === item.id);
  if (original && (item.kind !== original.kind || (item.patientId !== original.patientId && records.notes.some(note => note.appointmentId === item.id)))) {
    throw new Error('Keep the linked patient and visit type on this appointment.');
  }
  if (!requiresSlotCheck(item, original)) {
    return pruneScheduleOverlapIgnores({ ...records, appointments: upsert(records.appointments, {
      ...item, exceptions: original?.exceptions ?? [], ignoredScheduleOverlapKeys: original?.ignoredScheduleOverlapKeys,
    }) });
  }
  const issues = assessSlot(records, item, item.patientId, item.id, now);
  const blockers = issues.filter(issue => !issue.confirmationKey && (!issue.kind || !reasons[issue.kind]?.trim()));
  if (blockers.length) {
    throw new LocalizedError(
      blockers.map(issue => translate(issue.messageKey, issue.values, 'en')).join(' '),
      () => blockers.map(issue => t(issue.messageKey, issue.values)).join(' '),
    );
  }
  const overlaps = issues.flatMap(({ code, confirmationKey }) => confirmationKey ? [{ code, confirmationKey }] : []);
  if (overlaps.some(issue => !confirmedOverlaps.includes(issue.confirmationKey))) {
    throw new VisitOverlapConfirmationRequired(overlaps.every(issue => issue.code.startsWith('overlap:'))
      ? 'Confirm each overlapping appointment before saving.' : 'Confirm each scheduling overlap before saving.');
  }
  const kinds = [...new Set(issues.flatMap(issue => issue.kind ? [issue.kind] : []))];
  const recordedAt = now.toISOString();
  const exceptions: Appointment['exceptions'] = kinds.map(kind => ({
    kind, reason: reasons[kind]!.trim(), recordedAt,
    conditions: issues.filter(issue => issue.kind === kind).map(issue => issue.code),
  }));
  if (overlaps.length) exceptions.push({
    kind: overlaps.every(issue => issue.code.startsWith('overlap:')) ? 'Overlapping appointments' : 'Scheduling overlaps',
    reason: 'Confirmed before saving.', recordedAt, conditions: overlaps.map(issue => issue.code),
  });
  return pruneScheduleOverlapIgnores({ ...records, appointments: upsert(records.appointments, {
    ...item, exceptions: [...(original?.exceptions ?? []), ...exceptions],
    ignoredScheduleOverlapKeys: overlaps.length ? overlaps.map(issue => issue.confirmationKey) : undefined,
  }) });
}

export function alternativeSlots(records: Records, slot: Slot, patient: Patient | undefined, excludeId?: string, now = new Date()): Slot[] {
  if (!slot.date || !slot.start || !slot.end) return [];
  const duration = minutes(slot.end) - minutes(slot.start);
  if (duration <= 0) return [];
  const results: Slot[] = [];
  const firstDate = slot.date < localDate(now) ? localDate(now) : slot.date;
  for (let offset = 0; offset < 28 && results.length < 4; offset += 1) {
    const date = addDays(firstDate, offset);
    const windows = hoursForDate(records, date)
      .sort((a, b) => a.start.localeCompare(b.start));
    const candidates = windows.flatMap(window => {
      const first = minutes(window.start);
      const count = Math.max(0, Math.floor((minutes(window.end) - duration - first) / 15) + 1);
      return Array.from({ length: count }, (_, index) => {
        const start = first + index * 15;
        return { date, start: clockTime(start), end: clockTime(start + duration) };
      });
    });
    if (offset === 0 && date === slot.date) {
      candidates.sort((a, b) => Math.abs(minutes(a.start) - minutes(slot.start)) - Math.abs(minutes(b.start) - minutes(slot.start)));
    }
    for (const candidate of candidates) {
      if (slotOrder(candidate, slot) === 0) continue;
      const issues = assessSlot(records, candidate, patient?.id ?? null, excludeId, now);
      if (issues.every(issue => issue.kind === 'Blocking waits' || issue.kind === 'Blocking tasks')) results.push(candidate);
      if (results.length === 4) break;
    }
  }
  return results;
}

const suggestionTargets = [
  { label: 'First availability', days: 0 },
  { label: 'Next week', days: 7 },
  { label: 'Two weeks', days: 14 },
] as const;
const searchDays = 120;
export const suggestionLookaheadDays = suggestionTargets[2].days + searchDays - 1;
const visitBuffer = 30;

export function isSlotAvailable(records: Records, slot: Slot, { now, excludeId, events = [] }: SlotSearch) {
  return !assessSlot(records, slot, null, excludeId, now).length && !calendarConflicts(slot, events).length;
}

export function appointmentSlotsOnDate(records: Records, date: string, duration: number, search: SlotSearch): Slot[] {
  if (!Number.isInteger(duration) || duration <= 0 || duration >= 24 * 60) return [];
  const windows = freeAppointmentWindows(records, date, search).filter(window => window.duration >= duration);
  if (!windows.length) return [];
  const visits = records.appointments.filter(item => item.date === date && item.id !== search.excludeId
    && item.kind === 'Visit' && occupiesSchedule(item));

  return windows.flatMap((window, index) => {
    const start = minutes(window.start);
    const end = minutes(window.end);
    const count = Math.floor(window.duration / duration);
    let spare = window.duration - count * duration;
    let before = 0;
    let after = 0;
    let hasEarlierVisit = false;
    let hasLaterVisit = false;
    for (const visit of visits) {
      if (visit.end <= window.start) {
        hasEarlierVisit = true;
        before = Math.max(before, visitBuffer - (start - minutes(visit.end)));
      }
      if (visit.start >= window.end) {
        hasLaterVisit = true;
        after = Math.max(after, visitBuffer - (minutes(visit.start) - end));
      }
    }

    // Use only the time left over after fitting as many visits as possible. Share it across the gaps.
    const limits = [before, ...Array<number>(count - 1).fill(visitBuffer), after];
    const gaps = limits.map(() => 0);
    for (let minute = 0; minute < visitBuffer && spare > 0; minute += 1) {
      for (const [gap, limit] of limits.entries()) {
        if (spare === 0) break;
        if (minute >= limit) continue;
        gaps[gap] += 1;
        spare -= 1;
      }
    }

    const first = index === 0 && !hasEarlierVisit;
    const last = index === windows.length - 1 && !hasLaterVisit;
    let cursor = start + gaps[0];
    if (windows.length === 1 && count === 1 && spare > 0) {
      // A single block can still have two useful start times on the same day.
      return [cursor, cursor + spare].map(time => slotForDuration(date, clockTime(time), duration));
    }
    if (first && last && count > 1) gaps[Math.floor(count / 2)] += spare;
    else if (last) cursor += spare;

    return Array.from({ length: count }, (_, position) => {
      const slot = slotForDuration(date, clockTime(cursor), duration);
      cursor += duration + gaps[position + 1];
      return slot;
    });
  });
}

export function preferredSlotOnDate(records: Records, date: string, duration: number, search: SlotSearch) {
  return appointmentSlotsOnDate(records, date, duration, search)[0];
}

export function adjacentAppointmentSlots(records: Records, slot: Slot, search: SlotSearch) {
  const duration = minutes(slot.end) - minutes(slot.start);
  const blocks = appointmentSlotsOnDate(records, slot.date, duration, search);
  return {
    previous: blocks.filter(block => block.end <= slot.start).reverse(),
    next: blocks.filter(block => block.start >= slot.end),
  };
}

export function availableDayRange(date: string, direction: -1 | 1, today: string) {
  if (!date) return;
  if (direction === 1) {
    const next = addDays(date, 1);
    const from = next < today ? today : next;
    return { from, through: addDays(from, searchDays - 1) };
  }
  const through = addDays(date, -1);
  if (through < today) return;
  const earlier = addDays(date, -searchDays);
  return { from: earlier < today ? today : earlier, through };
}

export function findAvailableDay(
  records: Records, range: { from: string; through: string }, direction: -1 | 1, duration: number, search: SlotSearch,
) {
  for (let date = direction === 1 ? range.from : range.through; date >= range.from && date <= range.through; date = addDays(date, direction)) {
    const slot = preferredSlotOnDate(records, date, duration, search);
    if (slot) return slot;
  }
}

export function appointmentSuggestionStart(now: Date) {
  // Slot start times have minute precision. Round up so the lead time is at least one hour.
  return new Date((Math.ceil(now.getTime() / 60_000) + 60) * 60_000);
}

export function suggestAppointmentTimes(
  records: Records, duration: number, excludeId?: string, now = new Date(), events: DeviceCalendarEvent[] = [],
) {
  const results: { label: typeof suggestionTargets[number]['label']; slot: Slot }[] = [];
  if (!Number.isInteger(duration) || duration <= 0 || duration >= 24 * 60) return results;
  const today = localDate(now);
  const byDate = new Map<string, Slot | undefined>();
  const search = { now: appointmentSuggestionStart(now), excludeId, events };

  for (const target of suggestionTargets) {
    for (let offset = 0; offset < searchDays; offset += 1) {
      const date = addDays(today, target.days + offset);
      if (!byDate.has(date)) byDate.set(date, preferredSlotOnDate(records, date, duration, search));
      const slot = byDate.get(date);
      if (!slot) continue;
      if (!results.some(item => slotOrder(item.slot, slot) === 0)) results.push({ label: target.label, slot });
      break;
    }
  }
  return results;
}

export function newlyBookablePatients(previous: Records, saved: Records, today: string) {
  const alreadyReady = new Set(planningCandidates(previous, today).map(({ patient }) => patient.id));
  return planningCandidates(saved, today)
    .filter(({ patient }) => !alreadyReady.has(patient.id))
    .map(({ patient }) => patient);
}

export function saveVisitOutcome(
  records: Records,
  expected: Pick<Visit, 'id' | 'patientId' | 'status'>,
  status: Visit['status'],
) {
  const visit = records.appointments.find(item => item.id === expected.id);
  if (visit?.kind !== 'Visit' || visit.patientId !== expected.patientId || visit.status !== expected.status) {
    throw new Error('This appointment changed. Open it again and try again.');
  }
  return saveAppointment(records, { ...visit, status }, {});
}

export function deleteAppointment(records: Records, id: string, kind: Appointment['kind'] = 'Visit'): Records {
  if (records.appointments.find(item => item.id === id)?.kind !== kind) {
    throw new Error(kind === 'Block' ? 'This blocked time is no longer available.' : 'This appointment is no longer available.');
  }
  return pruneScheduleOverlapIgnores({
    ...records,
    appointments: records.appointments.filter(item => item.id !== id),
    notes: records.notes.map(note => note.appointmentId === id ? { ...note, appointmentId: null } : note),
  });
}
