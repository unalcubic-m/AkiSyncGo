import { App } from '@capacitor/app';
import { useEffect, useState } from 'react';
import { Field, More, PageHeader, RecordForm, value } from '../components/ui';
import { availabilityFallbackDays, availabilitySettingsFor, maxAlertDays, reminderTimeChoices } from '../domain/availability-settings';
import { eventBufferDurations, eventBufferFor, eventBufferSchema } from '../domain/calendar-event-buffer';
import { formatDuration } from '../domain/availability';
import type { RecordChange, Records } from '../domain/model';
import { defaultLabReminder, labReminderSchema } from '../domain/notification-settings';
import { t } from '../i18n';
import { getExactAlarmAccess, getNotificationAccess, openExactAlarmSettings, openNotificationSettings, requestAvailabilityReminderPermission } from '../storage/availability-reminders';
import { WeekdayPicker, weekdays } from './ScheduleSettings';

interface Props { records: Records; save: (change: RecordChange) => Promise<void> }

export default function AvailabilitySettings({ records, save, back }: Props & { back: string }) {
  const settings = availabilitySettingsFor(records);
  const [saved, setSaved] = useState(false);
  return <>
    <PageHeader title={t('Availability alerts')} back={back} />
    <RecordForm onSave={async data => {
      await save(current => ({ ...current, availabilitySettings: { ...availabilitySettingsFor(current),
        workingDays: Number(value(data, 'workingDays')), calendarDays: Number(value(data, 'calendarDays')),
      } }));
      setSaved(true);
    }}>
      <div className="form-grid" onChange={() => setSaved(false)}>
        <Field label={t('Working days to check')}>
          <input name="workingDays" type="number" min={1} max={maxAlertDays} defaultValue={settings.workingDays} required />
        </Field>
        <Field label={t('Calendar day limit')}>
          <input name="calendarDays" type="number" min={1} max={maxAlertDays} defaultValue={settings.calendarDays} required />
        </Field>
      </div>
      <p className="form-hint">{t('If there are no working days within the calendar limit, Today checks the next working day up to {count} calendar days away.', { count: availabilityFallbackDays })}</p>
      {back !== '/data/notifications' && <More to="/data/notifications">{t('Manage notifications')}</More>}
      {saved && <p className="save-status" role="status">{t('Availability settings saved.')}</p>}
    </RecordForm>
  </>;
}

export function NotificationSettings({ records, save, native }: Props & { native: boolean }) {
  const settings = availabilitySettingsFor(records);
  const [lab, setLab] = useState(records.dailyLabReminder ?? defaultLabReminder);
  const [openings, setOpenings] = useState(settings.remindersEnabled);
  const [times, setTimes] = useState(settings.reminderTimes);
  const [minimum, setMinimum] = useState(String(settings.minimumMinutes));
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [notificationAccess, setNotificationAccess] = useState<boolean>();
  const [exactAccess, setExactAccess] = useState<boolean>();
  const wantsNotifications = lab.enabled || openings;
  const labDays = weekdays.filter(({ day }) => lab.days.includes(day)).map(({ short }) => t(short));

  useEffect(() => {
    if (!native) return;
    let active = true;
    function refresh() {
      void getNotificationAccess().then(granted => { if (active) setNotificationAccess(granted); }).catch(() => undefined);
      void getExactAlarmAccess().then(granted => { if (active) setExactAccess(granted); }).catch(() => undefined);
    }
    refresh();
    const listener = App.addListener('appStateChange', ({ isActive }) => { if (isActive) refresh(); }).catch(() => undefined);
    return () => {
      active = false;
      void listener.then(handle => handle?.remove()).catch(() => undefined);
    };
  }, [native]);

  function clearFeedback() { setSaved(false); setError(''); }

  return <>
    <PageHeader title={t('Notifications')} back="/data" />
    <div className="lab-settings-form"><RecordForm submit={t('Save preferences')} onSave={async () => {
      if (lab.enabled && !lab.days.length) throw new Error('Choose at least one weekday.');
      if (openings && new Set(times).size !== times.length) throw new Error('Choose a different time for each reminder.');
      await save(current => {
        const previous = current.dailyLabReminder ?? defaultLabReminder;
        return { ...current, dailyLabReminder: labReminderSchema.parse({ ...lab, time: lab.time || previous.time,
          days: lab.days.length ? [...lab.days].sort() : previous.days }), availabilitySettings: {
          ...availabilitySettingsFor(current), remindersEnabled: openings,
          ...(openings ? { minimumMinutes: Number(minimum), reminderTimes: [...times].sort() } : {}),
        } };
      });
      if (native && notificationAccess === false && wantsNotifications) {
        const granted = await requestAvailabilityReminderPermission().catch(() => false);
        setNotificationAccess(granted);
      }
      setSaved(true);
    }}>
      <div className="lab-settings-card" onChange={clearFeedback}>
        <label className="lab-toggle"><span><strong>{t('Daily Laboratory Check')}</strong>
          <small>{labDays.length === weekdays.length ? t('Every day') : labDays.join(', ') || t('Choose reminder days')}</small></span>
          <input type="checkbox" role="switch" aria-label={t('Daily Laboratory Check')} checked={lab.enabled}
            onChange={event => setLab({ ...lab, enabled: event.target.checked })} /></label>
        {lab.enabled && <>
          <Field label={t('Daily reminder time')}><input type="time" value={lab.time} required onChange={event => setLab({ ...lab, time: event.target.value })} /></Field>
          <div className="lab-reminder-days"><WeekdayPicker selected={lab.days} onChange={days => setLab({ ...lab, days })} /></div>
        </>}
      </div>
      <div className="lab-settings-card" onChange={clearFeedback}>
        <label className="lab-toggle"><span><strong>{t('Availability alerts')}</strong><small>{t('Reminders for the next working day')}</small></span>
          <input type="checkbox" role="switch" aria-label={t('Availability alerts')} checked={openings} onChange={event => setOpenings(event.target.checked)} />
        </label>
        {openings && <div className="form-grid">
          <Field label={t('Minimum opening (min)')}><input type="number" min={1} max={1439} value={minimum} required onChange={event => setMinimum(event.target.value)} /></Field>
          <Field label={t('Number of reminders')}><select value={times.length} onChange={event => {
            const count = Number(event.target.value);
            setTimes(current => [...current, ...reminderTimeChoices.filter(time => !current.includes(time))].slice(0, count));
          }}>{reminderTimeChoices.map((time, index) => <option key={time} value={index + 1}>{index + 1}</option>)}</select></Field>
          {times.map((time, index) => <Field key={index} label={t('Reminder time {count}', { count: index + 1 })}>
            <input type="time" value={time} required onChange={event => {
              const next = event.target.value;
              setTimes(current => current.map((entry, position) => index === position ? next : entry));
            }} />
          </Field>)}
        </div>}
        <More to="/data/availability?from=notifications">{t('Availability search settings')}</More>
      </div>
      {native && wantsNotifications && notificationAccess === false && <div className="slot-feedback calendar-check">
        <p>{t('Notifications are turned off. Allow them in Android settings to enable reminders.')}</p>
        <button className="button secondary" type="button" onClick={() => {
          setError(''); void openNotificationSettings().catch(() => setError(t('Could not open Android notification settings.')));
        }}>{t('Open Android notification settings')}</button>
      </div>}
      {native && wantsNotifications && exactAccess === false && <div className="slot-feedback calendar-check">
        <p>{t('Android may deliver reminders later without Alarms & reminders access.')}</p>
        <button className="button secondary" type="button" onClick={() => {
          setError(''); void openExactAlarmSettings().catch(() => setError(t('Could not open Android alarm settings.')));
        }}>{t('Open Alarms & reminders settings')}</button>
      </div>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {saved && <p className="save-status" role="status">{t('Notification preferences saved.')}</p>}
    </RecordForm></div>
  </>;
}

export function CalendarBufferSettings({ records, save }: Props) {
  const [draft, setDraft] = useState(eventBufferFor(records));
  const [saved, setSaved] = useState(false);
  return <>
    <PageHeader title={t('Calendar event buffer')} back="/data" />
    <RecordForm submit={t('Save buffer settings')} onSave={async () => {
      await save(current => ({ ...current, calendarEventBuffer: eventBufferSchema.parse(draft) }));
      setSaved(true);
    }}>
      <label className="lab-toggle"><span><strong>{t('Enable calendar event buffer')}</strong>
        <small>{t('Reserve time before calendar events in the Optimal Slot Picker.')}</small></span>
        <input type="checkbox" role="switch" aria-label={t('Enable calendar event buffer')} checked={draft.enabled}
          onChange={event => { setDraft({ ...draft, enabled: event.target.checked }); setSaved(false); }} /></label>
      <Field label={t('Pre-event buffer duration')}><select value={draft.minutes} disabled={!draft.enabled}
        onChange={event => { setDraft(eventBufferSchema.parse({ ...draft, minutes: Number(event.target.value) })); setSaved(false); }}>
        {eventBufferDurations.map(minutes => <option key={minutes} value={minutes}>{formatDuration(minutes)}</option>)}
      </select></Field>
      <p className="muted lab-setting-hint">{t('You can ignore a buffer for a single appointment. The calendar event stays unavailable.')}</p>
      {saved && <p className="save-status" role="status">{t('Calendar buffer settings saved.')}</p>}
    </RecordForm>
  </>;
}
