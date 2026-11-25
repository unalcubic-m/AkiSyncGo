import { errorMessage, t, type Message } from '../i18n';
import { WarningCircle } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { CalendarAccessMessage, useCalendarRead, type CalendarDateRange, type DeviceCalendarAccess } from '../components/DeviceCalendarAccess';
import { ButtonLink, Empty, PageHeader, path, Pill } from '../components/ui';
import { addDays, titleDate } from '../domain/dates';
import { calendarEventLabel, setAppointmentEventIgnored } from '../domain/device-calendar';
import type { Appointment, RecordChange, Records } from '../domain/model';
import { setLocalOverlapIgnored, type ScheduleConflict } from '../domain/schedule-conflicts';
import type { CalendarRead } from '../storage/device-calendar';
import { breakSettingsLink } from './ScheduleSettings';

export function useUpcomingCalendarEvents(access: DeviceCalendarAccess, visits: Appointment[]) {
  const dates = access.enabled ? [...new Set(visits.map(visit => visit.date))].join(',') : '';
  const ranges = useMemo(() => {
    const result: CalendarDateRange[] = [];
    for (const date of dates.split(',').filter(Boolean)) {
      const last = result.at(-1);
      if (last && date <= addDays(last.through, 7) && date <= addDays(last.from, 119)) last.through = date;
      else result.push({ from: date, through: date });
    }
    return result;
  }, [dates]);
  return useCalendarRead(access, ranges);
}

export function CalendarConflictBanner({ count, from }: { count: number; from: 'today' | 'calendar' }) {
  return <aside className="slot-feedback calendar-warning">
    <WarningCircle size={21} aria-hidden />
    <strong role="status">{t(count === 1 ? '{count} scheduling conflict' : '{count} scheduling conflicts', { count })}</strong>
    <a href={path('/calendar-conflicts?from=' + from)}>{t('View current conflicts')}</a>
  </aside>;
}

function appointmentName(records: Records, appointment: Appointment) {
  const patient = records.patients.find(item => item.id === appointment.patientId);
  return patient ? `${patient.name} · ${appointment.title}` : appointment.title;
}

function conflictSource(records: Records, conflict: ScheduleConflict, from: string) {
  const { date } = conflict.appointment;
  if (conflict.kind === 'device') {
    const { event } = conflict;
    return {
      title: event.title.trim() || t('Untitled event'),
      label: [event.calendar, calendarEventLabel(event, date)].filter(Boolean).join(' · '),
      href: '/calendar?' + new URLSearchParams({ date, event: event.id, from: 'calendar-conflicts' }),
      action: t('View event'),
    };
  }
  const { overlap } = conflict;
  switch (overlap.kind) {
    case 'appointment': return {
      title: appointmentName(records, overlap.item),
      label: `${t(overlap.item.kind === 'Block' ? 'Blocked time' : 'Appointment')} · ${overlap.item.start}–${overlap.item.end}`,
      href: `/appointments/${overlap.item.id}?from=${from}`, action: t('Open appointment'),
    };
    case 'break': return {
      title: overlap.rule.title, label: `${t('Break')} · ${overlap.start}–${overlap.end}`,
      href: breakSettingsLink(overlap.rule, overlap.source), action: t('View break'),
    };
    case 'time-off': return {
      title: overlap.item.title,
      label: `${t('Time off')} · ${overlap.item.hours ? `${overlap.item.hours.start}–${overlap.item.hours.end}` : t('All day')}`,
      href: '/availability?' + new URLSearchParams({ date, edit: overlap.item.id }), action: t('View time off'),
    };
  }
}

export function ScheduleConflictList({ records, conflicts, save, from = 'calendar-conflicts', empty }: {
  records: Records; conflicts: ScheduleConflict[]; save: (change: RecordChange) => Promise<void>; from?: string; empty?: Message;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function toggleConflict(conflict: ScheduleConflict) {
    if (busy) return;
    setError('');
    setBusy(true);
    try {
      await save(current => conflict.kind === 'device'
        ? setAppointmentEventIgnored(current, conflict.appointment.id, conflict.event.id, !conflict.ignored)
        : setLocalOverlapIgnored(current, conflict.appointment, conflict.overlap, !conflict.ignored));
    } catch (failure) {
      setError(errorMessage(failure, 'Could not update the scheduling conflict.'));
    } finally {
      setBusy(false);
    }
  }

  return <>
    {(conflicts.length > 0 || empty) && <div className="panel">
      {conflicts.map(conflict => {
        const { appointment, ignored } = conflict;
        const source = conflictSource(records, conflict, from);
        return <article key={conflict.key} className="record-row calendar-conflict-row">
          <div className="row-heading">
            <strong>{source.title}</strong>
            <Pill tone={ignored ? 'neutral' : 'amber'}>{t(ignored ? 'Ignored' : 'Conflict')}</Pill>
          </div>
          <p>{source.label}</p>
          <a href={path(`/appointments/${appointment.id}?from=${from}`)}>{appointmentName(records, appointment)}</a>
          <p>{titleDate(appointment.date)} · {appointment.start}–{appointment.end}</p>
          <div className="row-actions">
            <ButtonLink to={source.href} secondary>{source.action}</ButtonLink>
            <button type="button" className="button secondary" disabled={busy} onClick={() => void toggleConflict(conflict)}
              aria-label={t(ignored ? 'Restore warning for {event} for this appointment' : 'Ignore {event} for this appointment', { event: source.title })}>
              {t(ignored ? 'Restore warning' : 'Ignore for this appointment')}
            </button>
          </div>
        </article>;
      })}
      {!conflicts.length && empty && <Empty>{t(empty)}</Empty>}
    </div>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </>;
}

export function CalendarConflicts({ records, conflicts, result, access, save, back }: {
  records: Records; conflicts: ScheduleConflict[]; result: CalendarRead; access: DeviceCalendarAccess;
  save: (change: RecordChange) => Promise<void>; back: string;
}) {
  const current = conflicts.filter(item => !item.ignored);
  return <>
    <PageHeader title={t('Current conflicts')} back={back}
      action={<ButtonLink to="/ignored-calendar-events?from=calendar-conflicts" secondary>{t('Ignored conflicts')}</ButtonLink>} />
    <CalendarAccessMessage result={result} access={access} />
    <ScheduleConflictList records={records} conflicts={current} save={save}
      empty={result.state === 'ready' || result.state === 'off' ? 'No current scheduling conflicts.' : undefined} />
  </>;
}
