import { breaksForDate, timeRangesOverlap } from './availability';
import { appointmentCalendarConflicts, type DeviceCalendarEvent } from './device-calendar';
import type { Appointment, BreakRule, Records, Slot, TimeOff } from './model';

type Visit = Extract<Appointment, { kind: 'Visit' }>;
type AppointmentOverlap = { kind: 'appointment'; item: Appointment };
export type LocalOverlap = AppointmentOverlap
  | ({ kind: 'break'; rule: BreakRule; source: string } & Slot)
  | { kind: 'time-off'; item: TimeOff };

export type ScheduleConflict = { appointment: Visit; ignored: boolean; key: string } & (
  { kind: 'local'; overlap: LocalOverlap } | { kind: 'device'; event: DeviceCalendarEvent }
);

const occupiedStatuses = new Set(['Scheduled', 'Completed', 'Blocked time']);

export function occupiesSchedule(appointment: Appointment) {
  return occupiedStatuses.has(appointment.status);
}

export function localOverlaps(records: Records, slot: Slot, excludeId?: string, appointments = records.appointments): LocalOverlap[] {
  return [
    ...records.timeOff.filter(off => off.from <= slot.date && off.through >= slot.date
      && (!off.hours || timeRangesOverlap(slot, off.hours))).map(item => ({ kind: 'time-off' as const, item })),
    ...breaksForDate(records, slot.date).filter(entry => timeRangesOverlap(slot, entry))
      .map(entry => ({ kind: 'break' as const, ...entry })),
    ...appointments.filter(item => item.id !== excludeId && item.date === slot.date && occupiesSchedule(item)
      && timeRangesOverlap(slot, item)).map(item => ({ kind: 'appointment' as const, item })),
  ];
}

export function localOverlapKey(slot: Slot, patientId: string | null, overlap: LocalOverlap) {
  const appointment = [slot.date, slot.start, slot.end, patientId];
  switch (overlap.kind) {
    case 'appointment': {
      const { id, date, start, end, patientId } = overlap.item;
      return JSON.stringify([appointment, overlap.kind, id, date, start, end, patientId]);
    }
    case 'break': return JSON.stringify([appointment, overlap.kind, overlap.rule.id, overlap.source, overlap.date, overlap.start, overlap.end]);
    case 'time-off': {
      const { id, from, through, hours } = overlap.item;
      return JSON.stringify([appointment, overlap.kind, id, from, through, hours?.start, hours?.end]);
    }
  }
}

function ignoresOverlap(appointment: Appointment, overlap: LocalOverlap) {
  return appointment.ignoredScheduleOverlapKeys?.includes(localOverlapKey(appointment, appointment.patientId, overlap)) ?? false;
}

export function scheduleConflicts(records: Records, appointments: Appointment[], events: DeviceCalendarEvent[] = []): ScheduleConflict[] {
  const activeIds = new Set(appointments.map(appointment => appointment.id));
  const byDate = new Map<string, Appointment[]>();
  for (const item of records.appointments) {
    if (!byDate.has(item.date)) byDate.set(item.date, []);
    byDate.get(item.date)!.push(item);
  }
  return appointments.flatMap(appointment => {
    if (appointment.kind !== 'Visit') return [];
    const conflicts: ScheduleConflict[] = [];
    for (const overlap of localOverlaps(records, appointment, appointment.id, byDate.get(appointment.date))) {
      if (overlap.kind === 'appointment' && overlap.item.status === 'Scheduled'
        && (!activeIds.has(overlap.item.id) || overlap.item.id < appointment.id)) continue;
      const ignored = ignoresOverlap(appointment, overlap) || (overlap.kind === 'appointment'
        && ignoresOverlap(overlap.item, { kind: 'appointment', item: appointment }));
      const key = JSON.stringify([appointment.id, localOverlapKey(appointment, appointment.patientId, overlap)]);
      conflicts.push({ kind: 'local', appointment, overlap, ignored, key });
    }
    for (const conflict of appointmentCalendarConflicts(appointment, events)) {
      conflicts.push({ ...conflict, appointment, kind: 'device', key: JSON.stringify([appointment.id, 'device', conflict.event.id]) });
    }
    return conflicts;
  });
}

export function conflictAppointmentIds(conflict: ScheduleConflict) {
  return conflict.kind === 'local' && conflict.overlap.kind === 'appointment'
    ? [conflict.appointment.id, conflict.overlap.item.id] : [conflict.appointment.id];
}

export function setLocalOverlapIgnored(records: Records, appointment: Appointment, overlap: LocalOverlap, ignore: boolean): Records {
  const key = localOverlapKey(appointment, appointment.patientId, overlap);
  const current = records.appointments.find(item => item.id === appointment.id);
  if (!current || (ignore && (!occupiesSchedule(current) || !localOverlaps(records, current, current.id)
    .some(item => localOverlapKey(current, current.patientId, item) === key)))) return records;

  const reverseKey = overlap.kind === 'appointment' ? localOverlapKey(overlap.item, overlap.item.patientId, { kind: 'appointment', item: appointment }) : undefined;
  return { ...records, appointments: records.appointments.map(item => {
    const existing = item.ignoredScheduleOverlapKeys ?? [];
    const keys = item.id === appointment.id ? (ignore ? [...new Set([...existing, key])] : existing.filter(entry => entry !== key))
      : !ignore && overlap.kind === 'appointment' && item.id === overlap.item.id ? existing.filter(entry => entry !== reverseKey) : existing;
    return keys === existing ? item : { ...item, ignoredScheduleOverlapKeys: keys.length ? keys : undefined };
  }) };
}

export function pruneScheduleOverlapIgnores(records: Records): Records {
  if (!records.appointments.some(item => item.ignoredScheduleOverlapKeys?.length)) return records;
  return { ...records, appointments: records.appointments.map(item => {
    if (!item.ignoredScheduleOverlapKeys?.length) return item;
    const active = new Set(occupiesSchedule(item) ? localOverlaps(records, item, item.id)
      .map(overlap => localOverlapKey(item, item.patientId, overlap)) : []);
    const keys = item.ignoredScheduleOverlapKeys.filter(key => active.has(key));
    return keys.length === item.ignoredScheduleOverlapKeys.length ? item : { ...item, ignoredScheduleOverlapKeys: keys.length ? keys : undefined };
  }) };
}
