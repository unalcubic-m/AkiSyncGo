import { errorMessage, getLocale, t } from '../i18n';
import { useEffect, useState } from 'react';
import { type DeviceCalendarAccess, useDeviceEventIgnore } from '../components/DeviceCalendarAccess';
import { Empty, PageHeader, path, Section } from '../components/ui';
import { titleDate } from '../domain/dates';
import { setAppointmentEventIgnored } from '../domain/device-calendar';
import type { ScheduleConflict } from '../domain/schedule-conflicts';
import { ScheduleConflictList } from './CalendarConflicts';
import type { RecordChange, Records } from '../domain/model';
import { type IgnoredCalendarEvents, readIgnoredCalendarEvents } from '../storage/device-calendar';

export default function IgnoredEvents({ records, conflicts, access, back, save }: {
  records: Records; conflicts: ScheduleConflict[]; access: DeviceCalendarAccess; back: string; save: (change: RecordChange) => Promise<void>;
}) {
  const { enabled, ready, revision } = access;
  const [snapshot, setSnapshot] = useState<{ revision: number; ids: string; events?: IgnoredCalendarEvents }>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const ignoreEvent = useDeviceEventIgnore(access.refresh);
  const appointmentIgnores = records.appointments.flatMap(appointment =>
    [...new Set(appointment.ignoredCalendarEventIds ?? [])].map(occurrenceId => ({
      appointment, occurrenceId, eventId: occurrenceId.split(':', 1)[0],
    })))
    .sort((a, b) => a.appointment.date.localeCompare(b.appointment.date) || a.appointment.start.localeCompare(b.appointment.start));
  const eventIds = [...new Set(appointmentIgnores.map(item => item.eventId))].sort().join(',');

  useEffect(() => {
    if (!enabled || !ready) return;
    let active = true;
    void readIgnoredCalendarEvents(eventIds ? eventIds.split(',') : []).then(
      events => { if (active) setSnapshot({ revision, ids: eventIds, events }); },
      () => { if (active) setSnapshot({ revision, ids: eventIds }); },
    );
    return () => { active = false; };
  }, [enabled, ready, revision, eventIds]);

  const current = snapshot?.revision === revision && snapshot.ids === eventIds ? snapshot : undefined;
  const events = current?.events;
  const details = new Map(events?.details.map(detail => [detail.eventId, detail]));
  const eventTitle = (id: string) => details.get(id)?.title.trim() || t(details.has(id) ? 'Untitled event' : 'Unavailable calendar event');

  async function restoreAppointment(appointmentId: string, occurrenceId: string) {
    if (saving) return;
    setError('');
    setSaving(true);
    try {
      await save(records => setAppointmentEventIgnored(records, appointmentId, occurrenceId, false));
    } catch (problem) {
      setError(errorMessage(problem, 'Could not restore the appointment warning.'));
    } finally {
      setSaving(false);
    }
  }

  return <>
    <PageHeader title={t('Ignored conflicts')} back={back} />
    <Section title={t('Ignored scheduling overlaps')}>
      <ScheduleConflictList records={records} conflicts={conflicts.filter(item => item.kind === 'local' && item.ignored)}
        save={save} from="ignored-calendar-events" empty="No ignored scheduling overlaps." />
    </Section>
    {events && !events.detailsAvailable && <p className="slot-feedback">{t('Calendar event details are unavailable. You can still restore warnings here.')}</p>}
    {(error || ignoreEvent.error) && <p className="form-error" role="alert">{error || ignoreEvent.error}</p>}
    {enabled && <Section title={t('Ignored for all bookings')}>
      <div className="panel">
        {enabled && !current && <Empty>{t('Loading ignored events…')}</Empty>}
        {current && !events && <div className="record-row">
          <p>{t('Ignored calendar events could not be loaded.')}</p>
          <button className="text-button" type="button" onClick={access.refresh}>{t('Retry')}</button>
        </div>}
        {(!enabled || events?.ignored.length === 0) && <Empty>{t('No events ignored for all bookings.')}</Empty>}
        {[...(events?.ignored ?? [])].sort((a, b) => eventTitle(a).localeCompare(eventTitle(b), getLocale())).map(id => {
          const title = eventTitle(id);
          return <article key={id} className="record-row calendar-conflict-row">
            <strong>{title}</strong>
            {details.get(id)?.calendar && <p>{details.get(id)?.calendar}</p>}
            {!details.has(id) && <p>{t('Device event')}{' '}{id}</p>}
            <div className="row-actions">
              <button className="button secondary" type="button" disabled={ignoreEvent.busy}
                aria-label={t('Restore {event} for all bookings', { event: title })} onClick={() => void ignoreEvent.update(id, false)}>
                {t('Restore event')}
              </button>
            </div>
          </article>;
        })}
      </div>
    </Section>}
    {(enabled || appointmentIgnores.length > 0) && <Section title={t('Ignored for specific appointments')}>
      <div className="panel">
        {!appointmentIgnores.length && <Empty>{t('No events ignored for specific appointments.')}</Empty>}
        {appointmentIgnores.map(({ appointment, occurrenceId, eventId }) => {
          const patient = records.patients.find(item => item.id === appointment.patientId);
          const title = eventTitle(eventId);
          return <article key={appointment.id + '/' + occurrenceId} className="record-row calendar-conflict-row">
            <strong>{!current && enabled ? t('Loading event details…') : title}</strong>
            {details.get(eventId)?.calendar && <p>{details.get(eventId)?.calendar}</p>}
            <a href={path('/appointments/' + appointment.id + '?from=ignored-calendar-events')}>
              {patient ? patient.name + ' · ' : ''}{appointment.title}
            </a>
            <p>{titleDate(appointment.date)} · {appointment.start}–{appointment.end}</p>
            <div className="row-actions">
              <button className="button secondary" type="button" disabled={saving}
                aria-label={t('Restore warning for {event} for this appointment', { event: title })}
                onClick={() => void restoreAppointment(appointment.id, occurrenceId)}>
                {t('Restore warning')}
              </button>
            </div>
          </article>;
        })}
      </div>
    </Section>}
  </>;
}
