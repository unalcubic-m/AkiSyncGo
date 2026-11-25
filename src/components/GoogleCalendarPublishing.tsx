import { App as CapacitorApp } from '@capacitor/app';
import { useCallback, useEffect, useState } from 'react';
import { calendarPublishingSnapshot } from '../domain/calendar-publishing';
import {
  calendarUnavailabilitySnapshot, defaultUnavailabilityPreferences, externalPublishingDates, publishingHorizons,
  type UnavailabilityPreferences,
} from '../domain/calendar-unavailability';
import { localDate } from '../domain/dates';
import type { Records } from '../domain/model';
import { getLocale, t, type Message } from '../i18n';
import {
  calendarPublishingSettings, configureCalendarPublishing, configureUnavailability, findPublishingCalendars,
  publishAppointments, publishUnavailability, readExternalRestrictions,
  type PublishingCalendar, type PublishingProblem, type PublishingSettings,
} from '../storage/device-calendar';
import type { DeviceCalendarAccess } from './DeviceCalendarAccess';
import { Field } from './ui';

const problemMessages: Record<PublishingProblem, Message> = {
  permission: 'Allow calendar access in AkiSync’s Android app permissions, then try again.',
  unavailable: 'The selected Google calendar is unavailable. Check its sync settings or choose another calendar.',
  ownership: 'AkiSync could not identify a published event. Your local appointments are saved.',
  error: 'Calendar publishing failed. Your local appointments are saved.',
};

export function useGoogleCalendarPublishing(native: boolean, records: Records | undefined, today: string, access: DeviceCalendarAccess) {
  const [settings, setSettings] = useState<PublishingSettings>();
  const [startupError, setStartupError] = useState(false);
  const [status, setStatus] = useState<PublishingProblem | 'paused' | 'saved' | 'saving'>();
  const [unavailabilityProblem, setUnavailabilityProblem] = useState<PublishingProblem | 'external'>();
  const [calendar, setCalendar] = useState<PublishingCalendar>();
  const [revision, setRevision] = useState(0);
  const [settingsAttempt, setSettingsAttempt] = useState(0);
  const retry = useCallback(() => setRevision(value => value + 1), []);
  const locale = getLocale();
  const { ready: calendarReady, revision: calendarRevision } = access;

  useEffect(() => {
    if (!native) return;
    let current = true;
    void calendarPublishingSettings().then(result => {
      if (current) {
        setSettings(result);
        setStartupError(false);
      }
    }).catch(() => { if (current) setStartupError(true); });
    return () => { current = false; };
  }, [native, settingsAttempt]);

  useEffect(() => {
    if (!native || !settings?.enabled) return;
    let current = true;
    const listener = CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      if (current && isActive) retry();
    }).catch(() => undefined);
    return () => {
      current = false;
      void listener.then(handle => handle?.remove()).catch(() => undefined);
    };
  }, [native, settings?.enabled, retry]);

  useEffect(() => {
    if (!settings?.enabled || !records) return;
    let current = true;
    setStatus('saving');
    void Promise.resolve().then(() => {
      if (current) return publishAppointments(calendarPublishingSnapshot(records, localDate()));
    }).then(result => {
      if (!current || !result) return;
      setStatus(result.status);
      if (result.status === 'saved') setCalendar(result.calendar);
    }).catch(() => { if (current) setStatus('error'); });
    return () => { current = false; };
  }, [settings, records, today, revision]);

  useEffect(() => {
    if (!settings?.enabled || !settings.calendar || !records) return;
    let current = true;
    const destination = settings.calendar;
    const preferences = settings.unavailability ?? defaultUnavailabilityPreferences;
    if (preferences.external && !calendarReady) return;
    const title = t('Unavailable for appointments');

    async function reconcile(saved: Records) {
      const dates = externalPublishingDates(saved, today, preferences);
      const events = preferences.external ? await readExternalRestrictions(dates.from, dates.through) : [];
      if (!current) return;
      if (!events) {
        setUnavailabilityProblem('external');
        return;
      }
      const snapshot = calendarUnavailabilitySnapshot(saved, today, preferences, events);
      const { status } = await publishUnavailability({ ...snapshot, title, destination, preferences });
      if (!current || status === 'paused' || status === 'stale') return;
      setUnavailabilityProblem(status === 'saved' ? undefined : status);
    }

    void reconcile(records).catch(() => { if (current) setUnavailabilityProblem('error'); });
    return () => { current = false; };
  }, [settings, records, today, calendarReady, calendarRevision, revision, locale]);

  function update(next: PublishingSettings) {
    setStatus(undefined);
    setUnavailabilityProblem(undefined);
    setCalendar(undefined);
    setSettings(next);
  }

  const problem = status && status in problemMessages ? status as PublishingProblem : undefined;
  return {
    settings, startupError, status, calendar: calendar ?? settings?.calendar, problem, unavailabilityProblem, update, retry,
    retrySettings: () => setSettingsAttempt(value => value + 1),
  };
}

const availabilityOptions = [
  ['closures', 'Publish manual appointment closures'],
  ['breaks', 'Publish clinical breaks'],
  ['external', 'Publish anonymous external calendar events'],
  ['buffers', 'Include external calendar event buffers'],
  ['workingHoursOnly', 'Restrict external calendar restrictions to clinical working hours'],
] as const;

export function GoogleCalendarPublishing({ publishing, refreshCalendar }: {
  publishing: ReturnType<typeof useGoogleCalendarPublishing>;
  refreshCalendar: () => void;
}) {
  const { settings, startupError, status, calendar, problem, unavailabilityProblem, update, retry, retrySettings } = publishing;
  const [busy, setBusy] = useState(false);
  const [options, setOptions] = useState<PublishingCalendar[]>();
  const [selected, setSelected] = useState('');
  const [message, setMessage] = useState<Message>();

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setMessage(undefined);
    try { await action(); }
    catch { setMessage(problemMessages.error); }
    finally { setBusy(false); }
  }

  function chooseCalendar() {
    void run(async () => {
      const result = await findPublishingCalendars();
      if ('status' in result) setMessage(problemMessages[result.status]);
      else if (!result.calendars.length) setMessage('No writable Google calendars found. Turn on sync for your dedicated calendar and try again.');
      else {
        setSelected('');
        setOptions(result.calendars);
      }
    });
  }

  async function configure(enabled: boolean, destination?: PublishingCalendar) {
    if (enabled && !destination && !settings?.enabled) {
      const result = await findPublishingCalendars();
      if ('status' in result) {
        setMessage(problemMessages[result.status]);
        return;
      }
    }
    const result = await configureCalendarPublishing(enabled, destination);
    if ('status' in result) {
      setMessage(problemMessages[result.status]);
      return;
    }
    update(result);
    setOptions(undefined);
    refreshCalendar();
  }

  function retryPublishing() {
    void run(async () => {
      if (problem === 'permission' || unavailabilityProblem === 'permission') {
        const result = await findPublishingCalendars();
        if ('status' in result) {
          setMessage(problemMessages[result.status]);
          return;
        }
      }
      retry();
    });
  }

  const destination = options?.find(option => option.id === selected);
  const preferences = settings?.unavailability ?? defaultUnavailabilityPreferences;
  const restrictionFeedback = unavailabilityProblem === 'external'
    ? 'Could not read device calendars. Previously published unavailable times were kept.'
    : unavailabilityProblem && (unavailabilityProblem === 'error' || unavailabilityProblem === 'ownership'
      ? 'Could not publish unavailable times. Try again.' : problemMessages[unavailabilityProblem]);
  const feedback = message ?? (problem ? problemMessages[problem] : settings?.enabled ? restrictionFeedback : undefined);

  function savePreferences(next: UnavailabilityPreferences) {
    void run(async () => update(await configureUnavailability(next)));
  }
  return <section className="setup-panel" aria-labelledby="google-calendar-publishing" aria-busy={busy}>
    <h2 id="google-calendar-publishing">{t('Publish to Google Calendar')}</h2>
    <p className="form-intro">{t('Share patient names and appointment times through a dedicated Google calendar.')}</p>
    {calendar && !options && <p><strong>{calendar.name}</strong><br /><span className="muted">{calendar.account}</span></p>}
    {feedback && <p role="alert">{t(feedback)}</p>}
    {settings?.enabled && !feedback && <p className="muted" role="status">{t(status === 'saved'
      ? 'Saved to the phone calendar. Google syncs separately.'
      : 'Updating the phone calendar…')}</p>}
    {settings && !settings.enabled && calendar && <p className="muted">{t('Publishing paused. Existing events stay on the calendar.')}</p>}
    {options ? <form onSubmit={event => {
      event.preventDefault();
      if (destination) void run(() => configure(true, destination));
    }}>
      <Field label={t('Dedicated Google calendar')}>
        <select value={selected} onChange={event => setSelected(event.target.value)} required disabled={busy}>
          <option value="">{t('Select a calendar')}</option>
          {options.map(option => <option key={option.id} value={option.id}>{option.name} · {option.account}</option>)}
        </select>
      </Field>
      {destination && <p><strong>{destination.name}</strong><br /><span className="muted">{destination.account}</span></p>}
      <div className="button-row form-actions">
        <button className="button" disabled={!destination || busy}>{t('Start publishing')}</button>
        <button className="button secondary" type="button" disabled={busy} onClick={() => {
          setOptions(undefined);
          setMessage(undefined);
        }}>{t('Cancel')}</button>
      </div>
    </form> : settings ? <div className="button-row form-actions">
      {settings.enabled ? <>
        {(problem || unavailabilityProblem) && <button type="button" className="button secondary" disabled={busy}
          onClick={retryPublishing}>{t('Retry publishing')}</button>}
        <button type="button" className="button secondary" disabled={busy}
          onClick={() => void run(() => configure(false))}>{t('Pause publishing')}</button>
      </> : calendar && <button type="button" className="button secondary" disabled={busy}
        onClick={() => void run(() => configure(true))}>{t('Resume publishing')}</button>}
      <button type="button" className="button secondary" disabled={busy}
        onClick={chooseCalendar}>{t(calendar ? 'Change calendar' : 'Set up publishing')}</button>
    </div> : startupError && <>
      <p role="alert">{t('Could not open calendar publishing settings.')}</p>
      <button type="button" className="button secondary" onClick={retrySettings}>{t('Try again')}</button>
    </>}
    {settings && !options && <details>
      <summary><strong>{t('Publish unavailable times')}</strong></summary>
      <p className="form-intro">{t('Share unavailable times anonymously. Event details, closure titles, and break names stay private.')}</p>
      {availabilityOptions.map(([key, label]) => <label className="check" key={key}>
        <input type="checkbox" checked={preferences[key]}
          disabled={busy || (!preferences.external && (key === 'buffers' || key === 'workingHoursOnly'))}
          onChange={event => savePreferences({ ...preferences, [key]: event.target.checked })} />
        {t(label)}
      </label>)}
      <Field label={t('Recurring and external event publishing horizon')}>
        <select value={preferences.horizon} disabled={busy} onChange={event => {
          const horizon = publishingHorizons.find(days => String(days) === event.target.value);
          if (horizon) savePreferences({ ...preferences, horizon });
        }}>
          {publishingHorizons.map(days => <option key={days} value={days}>{t('{days} days', { days })}</option>)}
        </select>
      </Field>
    </details>}
  </section>;
}
