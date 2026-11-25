import { t } from '../i18n';
import { useState } from 'react';
import { CalendarAccessMessage, useCalendarRange, type CalendarDateRange, type DeviceCalendarAccess } from '../components/DeviceCalendarAccess';
import { FormWarning } from '../components/ui';
import { calendarBufferConflicts } from '../domain/calendar-event-buffer';
import { addDays } from '../domain/dates';
import { calendarConflicts, calendarEventLabel } from '../domain/device-calendar';
import type { Slot } from '../domain/model';
import { readCalendar, type CalendarRead } from '../storage/device-calendar';

export function useAppointmentCalendar(access: DeviceCalendarAccess, active: boolean, slot: Slot, from: string, through: string, bufferMinutes = 0) {
  const enabled = access.enabled && active;
  const { revision } = access;
  const [verified, setVerified] = useState<{ date: string; revision: number; result: CalendarRead }>();
  const readThrough = (date: string) => date && bufferMinutes ? addDays(date, 1) : date;
  const range = useCalendarRange(access, from, readThrough(through), enabled);
  const separateDay = slot.date < from || slot.date > through;
  const day = useCalendarRange(access, slot.date, readThrough(slot.date), enabled && separateDay);
  const selected = separateDay ? day : range;
  const current = enabled && verified?.date === slot.date && verified.revision === revision ? verified.result : selected;

  async function searchEvents(dates: CalendarDateRange) {
    if (!enabled) return [];
    const result = dates.from >= from && dates.through <= through && range.state !== 'loading'
      ? range : await readCalendar(dates.from, readThrough(dates.through));
    if (result.state === 'error') throw new FormWarning('Device calendars could not be checked. Retry the calendar check.');
    return result.state === 'ready' ? result.events : [];
  }

  async function verify(next: Slot, ignored: string[], skipCheck: boolean, preventOverlap: boolean, ignoredBuffers: string[]): Promise<string[]> {
    if (!enabled || !next.date || !next.start || next.end <= next.start) return [];
    const result = await readCalendar(next.date, readThrough(next.date));
    setVerified({ date: next.date, revision, result });
    if (result.state === 'error' && !skipCheck) throw new Error('Device calendars could not be checked. Retry or choose to book without the calendar check.');
    const conflicts = result.state === 'ready' ? calendarConflicts(next, result.events) : [];
    if (conflicts.length && preventOverlap) throw new FormWarning('Choose a time outside the overlapping calendar events.');
    if (conflicts.some(event => !ignored.includes(event.id))) {
      throw new FormWarning('Review each overlapping calendar event before saving this appointment.');
    }
    if (result.state === 'ready' && calendarBufferConflicts(next, result.events, bufferMinutes).some(event => !ignoredBuffers.includes(event.id))) {
      throw new FormWarning('Review the calendar event buffer before saving this appointment.');
    }
    return conflicts.map(event => event.id);
  }

  return { range, current, access, verify, searchEvents };
}

export function AppointmentCalendarCheck({ calendar, slot, ignored, onIgnore, skipCheck, onSkipCheck, showClear = true, preventOverlap = false }: {
  calendar: ReturnType<typeof useAppointmentCalendar>;
  slot: Slot;
  ignored: string[];
  onIgnore: (id: string, ignore: boolean) => void;
  skipCheck: boolean;
  showClear?: boolean;
  preventOverlap?: boolean;
  onSkipCheck: (skip: boolean) => void;
}) {
  const { current, access } = calendar;
  if (current.state !== 'ready') return <>
    <CalendarAccessMessage result={current} access={access} />
    {current.state === 'error' && <label className="check">
      <input type="checkbox" checked={skipCheck} onChange={event => onSkipCheck(event.target.checked)} />
      {t('Book without the calendar check')}
    </label>}
  </>;
  if (!slot.date || !slot.start || slot.end <= slot.start) return null;
  const conflicts = calendarConflicts(slot, current.events);
  if (!conflicts.length) return showClear ? <p className="muted" role="status">{t('No device calendar conflicts.')}</p> : null;
  if (preventOverlap) return <div className="slot-feedback" role="status">
    <strong>{t('Choose a time outside the overlapping calendar events.')}</strong>
    <ul>{conflicts.map(event => <li key={event.id}>{event.title.trim() || t('Untitled event')} · {calendarEventLabel(event, slot.date)}</li>)}</ul>
  </div>;
  return <fieldset className="slot-feedback slot-confirmations">
    <legend>{t('Device calendar conflicts')}</legend>
    <p>{t('Review each event you want to book over.')}</p>
    {conflicts.map(event => <label key={event.id} className="check slot-confirmation">
      <input type="checkbox" checked={ignored.includes(event.id)} onChange={input => onIgnore(event.id, input.target.checked)} />
      <span>{t('Ignore {event} for this booking', { event: event.title.trim() || t('Untitled event') })}
        <small>{[event.calendar, calendarEventLabel(event)].filter(Boolean).join(' · ')}</small>
      </span>
    </label>)}
  </fieldset>;
}
