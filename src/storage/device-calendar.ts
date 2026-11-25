import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import type { calendarPublishingSnapshot } from '../domain/calendar-publishing';
import { calendarRange, normalizeCalendarEvent, type DeviceCalendarEvent } from '../domain/device-calendar';

type CalendarAccess = 'granted' | 'denied' | 'prompt';
export type IgnoredCalendarEvents = {
  ignored: string[];
  details: Pick<DeviceCalendarEvent, 'eventId' | 'title' | 'calendar'>[];
  detailsAvailable: boolean;
};
export type PublishingCalendar = { id: string; name: string; account: string; key: string };
export type PublishingSettings = { enabled: boolean; calendar?: PublishingCalendar };
export type PublishingProblem = 'permission' | 'unavailable' | 'ownership' | 'error';
type PublishingFailure = { status: PublishingProblem };
type CalendarBridge = {
  requestAccess(options: { automatic: boolean }): Promise<{ access: CalendarAccess }>;
  events(range: { from: number; until: number }): Promise<{ access: CalendarAccess; events?: DeviceCalendarEvent[] }>;
  setEventIgnored(options: { eventId: string; ignored: boolean }): Promise<void>;
  ignoredEventDetails(options: { eventIds: string[] }): Promise<IgnoredCalendarEvents>;
  publishingSettings(): Promise<PublishingSettings>;
  publishingCalendars(): Promise<{ calendars: PublishingCalendar[] } | PublishingFailure>;
  configurePublishing(options: { enabled: boolean; calendarId?: string; account?: string; key?: string }): Promise<PublishingSettings | PublishingFailure>;
  publishAppointments(snapshot: ReturnType<typeof calendarPublishingSnapshot>):
    Promise<{ status: 'saved'; calendar: PublishingCalendar } | { status: 'paused' } | PublishingFailure>;
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
export const publishAppointments = (snapshot: ReturnType<typeof calendarPublishingSnapshot>) => bridge.publishAppointments(snapshot);

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
