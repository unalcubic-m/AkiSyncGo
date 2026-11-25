import { getLocale, t } from '../i18n';
import { addDays, parseDate } from './dates';
import type { Appointment, Records, Slot } from './model';

export type DeviceCalendarEvent = {
  id: string;
  eventId: string;
  ignored: boolean;
  title: string;
  calendar: string;
  begin: number;
  end: number;
  allDay: boolean;
};
export type DeviceCalendarTiming = Pick<DeviceCalendarEvent, 'begin' | 'end' | 'ignored' | 'allDay'>;

export function localTimestamp(date: string, time = '00:00') {
  const day = parseDate(date);
  const [hours, minutes] = time.split(':').map(Number);
  return day.setHours(hours, minutes, 0, 0);
}

export function calendarRange(from: string, through: string) {
  return { from: localTimestamp(from), until: localTimestamp(addDays(through, 1)) };
}

export function normalizeCalendarEvent<T extends DeviceCalendarTiming>(event: T): T {
  if (!event.allDay) return event;
  const day = (timestamp: number) => new Date(timestamp).toISOString().slice(0, 10);
  return { ...event, begin: localTimestamp(day(event.begin)), end: localTimestamp(day(event.end)) };
}

export function calendarConflicts(slot: Slot, events: DeviceCalendarEvent[]) {
  if (!slot.date || !slot.start || !slot.end || slot.end <= slot.start) return [];
  const begin = localTimestamp(slot.date, slot.start);
  const end = localTimestamp(slot.date, slot.end);
  return events.filter(event => !event.ignored && event.begin < end && event.end > begin);
}

export function calendarEventsOn(date: string, events: DeviceCalendarEvent[]) {
  const { from, until } = calendarRange(date, date);
  return events.filter(event => event.begin < until && event.end > from);
}

export function appointmentCalendarConflicts(appointment: Appointment, events: DeviceCalendarEvent[]) {
  return calendarConflicts(appointment, events).map(event => ({
    appointment, event, ignored: appointment.ignoredCalendarEventIds?.includes(event.id) ?? false,
  }));
}

export function setAppointmentEventIgnored(records: Records, appointmentId: string, occurrenceId: string, ignore: boolean): Records {
  return {
    ...records,
    appointments: records.appointments.map(appointment => {
      if (appointment.id !== appointmentId) return appointment;
      const existing = appointment.ignoredCalendarEventIds ?? [];
      const ids = ignore ? [...new Set([...existing, occurrenceId])] : existing.filter(id => id !== occurrenceId);
      return { ...appointment, ignoredCalendarEventIds: ids.length ? ids : undefined };
    }),
  };
}

export function calendarEventLabel(event: DeviceCalendarEvent, date?: string) {
  if (event.allDay) return t('All day');
  const time = new Intl.DateTimeFormat(getLocale(), { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const range = date ? calendarRange(date, date) : undefined;
  const start = range && event.begin < range.from ? '00:00' : time.format(event.begin);
  const end = range && event.end >= range.until ? '24:00' : time.format(event.end);
  return start + '–' + end;
}
