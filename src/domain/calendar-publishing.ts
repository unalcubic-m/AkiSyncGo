import { addDays, minutes } from './dates';
import { localTimestamp } from './device-calendar';
import type { Records } from './model';

export function calendarPublishingSnapshot(records: Pick<Records, 'appointments' | 'patients'>, today: string) {
  const yesterday = addDays(today, -1);
  // AkiSync's appointment dates and clock times use the phone's local time zone.
  const cutoff = localTimestamp(yesterday);
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const names = new Map(records.patients.map(patient => [patient.id, patient.name]));
  const visits = records.appointments.flatMap(appointment => {
    if (appointment.kind !== 'Visit' || appointment.date < yesterday
      || (appointment.status !== 'Scheduled' && appointment.status !== 'Completed')) return [];
    const title = names.get(appointment.patientId);
    if (!title) throw new Error('An appointment refers to a missing patient.');
    const start = localTimestamp(appointment.date, appointment.start);
    const end = localTimestamp(appointment.date, appointment.end);
    // Local clock times inside a daylight-saving gap can resolve past the nominal end.
    const duration = (minutes(appointment.end) - minutes(appointment.start)) * 60_000;
    return [{ id: appointment.id, title, start, end: end > start ? end : start + duration }];
  });
  return { cutoff, zone, visits };
}
