import { errorMessage, t } from '../i18n';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import type { DeviceCalendarEvent } from '../domain/device-calendar';
import { listenToCalendar, readCalendar, requestCalendarAccess, setDeviceEventIgnored, type CalendarRead } from '../storage/device-calendar';

export type CalendarDateRange = { from: string; through: string };

export function useDeviceCalendarAccess(enabled: boolean) {
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(previous => previous + 1), []);

  useEffect(() => {
    if (!enabled) return;
    let current = true;
    function onCalendarChange() {
      if (current && document.visibilityState === 'visible') refresh();
    }
    const subscription = listenToCalendar(onCalendarChange).catch(() => undefined);
    const foreground = CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      if (current && isActive) refresh();
    }).catch(() => undefined);
    void requestCalendarAccess(true).catch(() => undefined).then(() => {
      if (current) setReady(true);
    });
    return () => {
      current = false;
      void subscription.then(listener => listener?.remove()).catch(() => undefined);
      void foreground.then(listener => listener?.remove()).catch(() => undefined);
    };
  }, [enabled, refresh]);

  async function enable() {
    setBusy(true);
    try {
      await requestCalendarAccess();
    } finally {
      setBusy(false);
      refresh();
    }
  }

  return { enabled, ready, busy, revision, enable, refresh };
}

export type DeviceCalendarAccess = ReturnType<typeof useDeviceCalendarAccess>;

export function useDeviceEventIgnore(refresh: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function update(eventId: string, ignored: boolean) {
    if (busy) return;
    setError('');
    setBusy(true);
    try {
      await setDeviceEventIgnored(eventId, ignored);
      refresh();
    } catch (failure) {
      setError(errorMessage(failure, 'Could not update the calendar event.'));
    } finally {
      setBusy(false);
    }
  }
  return { update, busy, error };
}

async function readRanges(ranges: CalendarDateRange[]): Promise<CalendarRead> {
  const results = await Promise.all(ranges.map(range => readCalendar(range.from, range.through)));
  const events = new Map<string, DeviceCalendarEvent>();
  for (const result of results) {
    if (result.state !== 'ready') return result;
    for (const event of result.events) events.set(event.id, event);
  }
  return { state: 'ready', events: [...events.values()] };
}

export function useCalendarRead(access: DeviceCalendarAccess, ranges: CalendarDateRange[], enabled = true): CalendarRead {
  const { enabled: native, ready, revision } = access;
  const [snapshot, setSnapshot] = useState<{ ranges: CalendarDateRange[]; revision: number; result: CalendarRead }>();
  useEffect(() => {
    if (!native || !enabled || !ready || !ranges.length) return;
    let current = true;
    void readRanges(ranges).then(result => {
      if (current) setSnapshot({ ranges, revision, result });
    });
    return () => { current = false; };
  }, [native, enabled, ready, ranges, revision]);
  if (!native || !enabled || !ranges.length) return { state: 'off' };
  return snapshot?.ranges === ranges && snapshot.revision === revision ? snapshot.result : { state: 'loading' };
}

export function useCalendarRange(access: DeviceCalendarAccess, from: string, through: string, enabled = true) {
  const ranges = useMemo(() => from && through ? [{ from, through }] : [], [from, through]);
  return useCalendarRead(access, ranges, enabled);
}

export function CalendarAccessMessage({ result, access }: { result: CalendarRead; access: DeviceCalendarAccess }) {
  if (result.state === 'off' || result.state === 'ready') return null;
  if (result.state === 'loading') return <p className="muted" role="status">{t('Checking device calendars…')}</p>;
  if (result.state === 'error') return <div className="slot-feedback calendar-check">
    <p>{t('Device calendars could not be checked.')}</p>
    <button className="button secondary" type="button" onClick={access.refresh}>{t('Retry calendar check')}</button>
  </div>;
  return <div className="calendar-check">
    <p>{result.state === 'denied'
      ? t('Calendar access is off. You can allow it under AkiSync’s Android app permissions.')
      : t('Allow access to see events and warn about conflicting appointments.')}</p>
    <button className="button secondary" type="button" onClick={() => void access.enable().catch(() => undefined)} disabled={access.busy}>
      {t(access.busy ? 'Requesting access…' : 'Allow calendar access')}
    </button>
  </div>;
}
