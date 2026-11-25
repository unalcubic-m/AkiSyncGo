import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import type { calendarPublishingSnapshot } from '../domain/calendar-publishing';
import type { calendarUnavailabilitySnapshot, UnavailabilityPreferences } from '../domain/calendar-unavailability';
import { addDays } from '../domain/dates';
import { calendarRange, normalizeCalendarEvent, type DeviceCalendarEvent, type DeviceCalendarTiming } from '../domain/device-calendar';

type CalendarAccess = 'granted' | 'denied' | 'prompt';
export type IgnoredCalendarEvents = {
  ignored: string[];
  details: Pick<DeviceCalendarEvent, 'eventId' | 'title' | 'calendar'>[];
  detailsAvailable: boolean;
};
export type PublishingCalendar = { id: string; name: string; account: string; key: string };
export type PublishingSettings = { enabled: boolean; calendar?: PublishingCalendar; unavailability?: UnavailabilityPreferences };
export type PublishingProblem = 'permission' | 'unavailable' | 'ownership' | 'error';
type PublishingFailure = { status: PublishingProblem };
type CalendarBridge = {
  requestAccess(options: { automatic: boolean }): Promise<{ access: CalendarAccess }>;
  events(range: { from: number; until: number }): Promise<{ access: CalendarAccess; events?: DeviceCalendarEvent[] }>;
  events(range: { from: number; until: number; anonymous: true }): Promise<{ access: CalendarAccess; events?: DeviceCalendarTiming[] }>;
  setEventIgnored(options: { eventId: string; ignored: boolean }): Promise<void>;
  ignoredEventDetails(options: { eventIds: string[] }): Promise<IgnoredCalendarEvents>;
  publishingSettings(): Promise<PublishingSettings>;
  publishingCalendars(): Promise<{ calendars: PublishingCalendar[] } | PublishingFailure>;
  configurePublishing(options: { enabled: boolean; calendarId?: string; account?: string; key?: string }): Promise<PublishingSettings | PublishingFailure>;
  configureUnavailability(options: { preferences: UnavailabilityPreferences }): Promise<PublishingSettings>;
  publishAppointments(snapshot: ReturnType<typeof calendarPublishingSnapshot>):
    Promise<{ status: 'saved'; calendar: PublishingCalendar } | { status: 'paused' } | PublishingFailure>;
  publishUnavailability(options: ReturnType<typeof calendarUnavailabilitySnapshot> & {
    title: string; destination: PublishingCalendar; preferences: UnavailabilityPreferences;
  }): Promise<{ status: 'saved' | 'paused' | 'stale' } | PublishingFailure>;
  addListener(event: 'calendarChanged', callback: () => void): Promise<PluginListenerHandle>;
};

const bridge = registerPlugin<CalendarBridge>('AkiSyncCalendar');
let accessRequest: ReturnType<CalendarBridge['requestAccess']> | undefined;
export function requestCalendarAccess(automatic = false) {
  accessRequest ??= bridge.requestAccess({ automatic }).finally(() => { accessRequest = undefined; });
  return accessRequest;
}
export const listenToCalendar = (callback: () => void) => bridge.addListener('calendarChanged', callback);
export const setDeviceEventIgnored = (eventId: string, ignored: boolean) => bridge.setEventIgnored({ eventId, ignored });
export const readIgnoredCalendarEvents = (eventIds: string[]) => bridge.ignoredEventDetails({ eventIds });
export const calendarPublishingSettings = () => bridge.publishingSettings();
export const findPublishingCalendars = () => bridge.publishingCalendars();
export const configureCalendarPublishing = (enabled: boolean, calendar?: PublishingCalendar) =>
  bridge.configurePublishing({ enabled, calendarId: calendar?.id, account: calendar?.account, key: calendar?.key });
export const configureUnavailability = (preferences: UnavailabilityPreferences) => bridge.configureUnavailability({ preferences });
export const publishAppointments = (snapshot: ReturnType<typeof calendarPublishingSnapshot>) => bridge.publishAppointments(snapshot);
export const publishUnavailability = (options: Parameters<CalendarBridge['publishUnavailability']>[0]) => bridge.publishUnavailability(options);

export type CalendarRead =
  | { state: 'ready'; events: DeviceCalendarEvent[] }
  | { state: 'off' | 'loading' | 'prompt' | 'denied' | 'error' };

export async function readCalendar(from: string, through = from): Promise<CalendarRead> {
  try {
    const range = calendarRange(from, through);
    const result = await bridge.events(range);
    if (result.access !== 'granted') return { state: result.access };
    const events = (result.events ?? []).map(normalizeCalendarEvent)
      .filter(event => event.begin < range.until && event.end > range.from);
    return { state: 'ready', events: Array.from(new Map(events.map(event => [event.id, event])).values()) };
  } catch {
    return { state: 'error' };
  }
}

export async function readExternalRestrictions(from: string, through: string): Promise<DeviceCalendarTiming[] | undefined> {
  const ranges: { from: number; until: number }[] = [];
  for (let date = from; date <= through; date = addDays(date, 120)) {
    // The same Android reader limits queries to 136 elapsed days. Leave room for DST changes.
    const last = addDays(date, 119);
    ranges.push(calendarRange(date, last < through ? last : through));
  }
  try {
    const results = await Promise.all(ranges.map(range => bridge.events({ ...range, anonymous: true })));
    const events: DeviceCalendarTiming[] = [];
    for (const [index, result] of results.entries()) {
      if (result.access !== 'granted' || !Array.isArray(result.events) || result.events.some(event =>
        !event || !Number.isFinite(event.begin) || !Number.isFinite(event.end) || event.end <= event.begin
        || typeof event.ignored !== 'boolean' || typeof event.allDay !== 'boolean')) return undefined;
      const range = ranges[index];
      for (const timing of result.events.map(normalizeCalendarEvent)) {
        if (timing.begin < range.until && timing.end > range.from) events.push(timing);
      }
    }
    return events;
  } catch {
    return undefined;
  }
}
