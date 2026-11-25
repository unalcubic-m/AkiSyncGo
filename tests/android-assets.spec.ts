import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { jumpToCalendarDate } from './calendar';
import { chooseBookingPatient, chooseBookingStart, dismissBookingOffer, expectBookingTime, openTimePicker } from './booking';

async function mockAndroidBridge(page: Page) {
  await page.clock.setFixedTime(new Date('2026-11-23T08:00:00+03:00'));
  const root = resolve('.test-android-assets');
  const types: Record<string, string> = { html: 'text/html', js: 'text/javascript', css: 'text/css' };
  const unexpected: string[] = [];
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'https://localhost') {
      unexpected.push(url.href);
      await route.abort();
      return;
    }
    const path = url.pathname === '/' ? '/index.html' : url.pathname;
    const contentType = types[path.split('.').at(-1) ?? ''];
    if (!contentType) { await route.fulfill({ status: 404, body: '' }); return; }
    await route.fulfill({ body: await readFile(resolve(root, '.' + path)), contentType });
  });
  await page.addInitScript(() => {
    const w = window as Window & { androidBridge: object; Capacitor: object };
    const methods = (names: string[]) => names.map(name => ({ name, rtype: 'promise' }));
    const listenerMethods = [{ name: 'addListener', rtype: 'callback' }, ...methods(['removeListener'])];
    const get = (key: string) => JSON.parse(localStorage.getItem(key) ?? 'null');
    const put = (key: string, value: unknown) => localStorage.setItem(key, JSON.stringify(value));
    const subscriptions = new Map<string, () => void>();
    let nextListener = 0;
    w.androidBridge = {};
    w.Capacitor = {
      PluginHeaders: [
        { name: 'AkiSyncRecords', methods: methods(['configuration', 'chooseFolder', 'inspectFolder', 'setFolder', 'readRecords', 'writeRecords', 'setVerifier', 'chooseRecordsFile']) },
        { name: 'AkiSyncCalendar', methods: [...methods([
          'requestAccess', 'events', 'setEventIgnored', 'ignoredEventDetails', 'publishingSettings',
          'publishingCalendars', 'configurePublishing', 'publishAppointments',
        ]), ...listenerMethods] },
        { name: 'AkiSyncClipboard', methods: methods(['copyPatientPhone', 'copyAppointmentTime']) },
        { name: 'App', methods: listenerMethods },
      ],
      async nativeCallback(plugin: string, _method: string, options: { eventName: string }, callback: (result: object) => void) {
        const id = String(++nextListener);
        const events = plugin === 'AkiSyncCalendar'
          ? [['test-calendar-change', () => callback({})]] as const
          : options.eventName === 'appUrlOpen'
            ? [['test-app-url-open', (event: Event) => callback((event as CustomEvent).detail)]] as const
            : [['test-background', () => callback({ isActive: false })], ['test-foreground', () => callback({ isActive: true })]] as const;
        for (const [name, handler] of events) window.addEventListener(name, handler);
        subscriptions.set(id, () => {
          for (const [name, handler] of events) window.removeEventListener(name, handler);
        });
        return id;
      },
      async nativePromise(_plugin: string, method: string, opts: {
        uri?: string; seed?: string; revision?: number; records?: string; verifier?: string; automatic?: boolean; callbackId?: string;
        eventId?: string; ignored?: boolean; eventIds?: string[];
        enabled?: boolean; calendarId?: string; phone?: string; text?: string; visits?: Array<{ id: string; title: string; start: number; end: number }>;
      }) {
        if (_plugin === 'AkiSyncClipboard' && method === 'copyPatientPhone') {
          put('mock-copied-phone', opts.phone);
          return;
        }
        if (_plugin === 'AkiSyncClipboard' && method === 'copyAppointmentTime') {
          put('mock-copied-time', opts.text);
          return;
        }
        if (method === 'removeListener' && opts.callbackId) {
          subscriptions.get(opts.callbackId)?.();
          subscriptions.delete(opts.callbackId);
        }
        if (method === 'requestAccess') {
          put('mock-calendar-access', true);
          put('mock-calendar-automatic', opts.automatic);
          return { access: 'granted' };
        }
        const destination = { id: '700', name: 'AkiSync Appointments', account: 'test@example.invalid', key: 'sync:test' };
        const publishing = get('mock-publishing') ?? { enabled: false };
        const publishingDenied = get('mock-publishing-denied');
        if (method === 'publishingSettings') return publishing;
        if (method === 'publishingCalendars') return publishingDenied ? { status: 'permission' } : { calendars: [destination] };
        if (method === 'configurePublishing') {
          const next = { enabled: opts.enabled, calendar: opts.calendarId === destination.id ? destination : publishing.calendar };
          put('mock-publishing', next);
          return next;
        }
        if (method === 'publishAppointments') {
          if (!publishing.enabled) return { status: 'paused' };
          if (publishingDenied) return { status: 'permission' };
          const saved = JSON.parse(get('mock-sqlite-' + get('mock-folder')).records);
          if (!opts.visits?.every(visit => saved.appointments.some((appointment: { id: string }) => appointment.id === visit.id))) {
            throw new Error('Tried publishing before saving the records.');
          }
          put('mock-published-visits', opts.visits);
          return { status: 'saved', calendar: destination };
        }
        if (['events', 'setEventIgnored', 'ignoredEventDetails'].includes(method)) {
          const ignored: string[] = get('mock-ignored-calendar-events') ?? [];
          const events: { id: string; eventId?: string; title: string; calendar: string; calendarId?: string }[] =
            (get('mock-calendar-events') ?? []).filter((event: { calendarId?: string }) => !publishing.calendar
              || event.calendarId !== publishing.calendar.id);
          if (method === 'events') return get('mock-calendar-access') ? {
            access: 'granted',
            events: events.map(event => {
              const eventId = event.eventId ?? event.id.split(':', 1)[0];
              return { ...event, eventId, ignored: ignored.includes(eventId) };
            }),
          } : { access: 'prompt' };
          if (method === 'setEventIgnored') {
            put('mock-ignored-calendar-events', opts.ignored ? [...new Set([...ignored, opts.eventId])] : ignored.filter(id => id !== opts.eventId));
            return;
          }
          const details = events.map(({ id, eventId, title, calendar }) => ({ eventId: eventId ?? id.split(':', 1)[0], title, calendar }))
            .filter(detail => ignored.includes(detail.eventId) || opts.eventIds?.includes(detail.eventId));
          return { ignored, details, detailsAvailable: true };
        }
        const folder = get('mock-folder');
        const row = get('mock-sqlite-' + folder);
        if (method === 'configuration') return { folder, verifier: get('mock-verifier'), legacy: false };
        if (method === 'chooseFolder') return { cancelled: false, uri: get('mock-new-folder') ?? 'Documents/AkiSync-test' };
        if (method === 'inspectFolder') return { name: opts.uri, records: get('mock-sqlite-' + opts.uri)?.records };
        if (method === 'setFolder') {
          if (opts.seed) put('mock-sqlite-' + opts.uri, { revision: 1, records: opts.seed });
          put('mock-folder', opts.uri);
          return { name: opts.uri };
        }
        if (method === 'readRecords') return row;
        if (method === 'writeRecords') {
          if (opts.revision !== row.revision) throw new Error('Invalid revision');
          put('mock-sqlite-' + folder, { revision: row.revision + 1, records: opts.records });
        }
        if (method === 'setVerifier') put('mock-verifier', opts.verifier);
        if (method === 'chooseRecordsFile') return { cancelled: false, content: localStorage.getItem('mock-patient-list') };
      },
    };
  });
  return unexpected;
}

test('Android notification confirmation goes back to the screen the user was on', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-23T10:00:00+03:00'));
  await mockAndroidBridge(page);
  await page.goto('https://localhost/#/calendar?date=2026-11-26');
  await page.getByRole('button', { name: 'Klasör seç' }).click();
  await expect(page.getByRole('heading', { name: 'Takvim', exact: true })).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('test-app-url-open', { detail: { url: 'akisync://daily-lab' } })));
  await expect(page.getByRole('heading', { name: 'Günlük laboratuvar kontrolü' })).toBeVisible();
  await page.getByRole('button', { name: 'Bugün için kapat' }).click();
  await expect(page).toHaveURL(/#\/calendar\?date=2026-11-26$/);
  await expect(page.getByRole('heading', { name: 'Takvim', exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('navigation').getByRole('link', { name: 'Bugün', exact: true }).click();
  const shortcut = page.getByRole('link', { name: /^Günlük laboratuvar kontrolü/ });
  await expect(shortcut).toHaveCount(0);
  await page.getByRole('navigation').getByRole('link', { name: 'İşler', exact: true }).click();
  await page.getByRole('link', { name: 'Takipler', exact: true }).click();
  await expect(shortcut).toContainText('Bugün kontrol edildi');
  await shortcut.click();
  await expect(page.getByText('Bugün kontrol edildi', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Bekleyen laboratuvar işleri' })).toBeVisible();
});

test('Android assets choose a folder offline, save readable records and switch the app lock independently', async ({ page }) => {
  const unexpected = await mockAndroidBridge(page);
  const appPassword = 'fictional orange silent lake';
  await page.context().setOffline(true);
  await page.goto('https://localhost/');
  expect(await page.evaluate(() => navigator.onLine)).toBe(false);
  await expect(page.locator('html')).toHaveAttribute('lang', 'tr');
  await expect(page.getByRole('heading', { name: 'Kayıt klasörü seçin' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Klasör seç' })).toBeVisible();
  await page.getByLabel('Dil').selectOption('en');
  await expect(page.getByRole('heading', { name: 'Choose a records folder' })).toBeVisible();
  await page.getByRole('button', { name: 'Choose folder' }).click();
  await expect(page.getByText('No visits or blocked time today.')).toBeVisible();
  await page.getByRole('navigation').getByRole('link', { name: 'Patients' }).click();
  await expect(page.getByText('0 patients')).toBeVisible();
  await page.getByRole('link', { name: 'Add patient' }).click();
  await page.getByLabel('Full name').fill('Fictional folder Meadow');
  await page.getByLabel('Phone', { exact: true }).fill('+1 202-555-0100');
  await page.getByRole('button', { name: 'Save patient' }).click();
  await dismissBookingOffer(page, 'FİCTİONAL FOLDER MEADOW');
  await expect(page.getByRole('heading', { name: 'FİCTİONAL FOLDER MEADOW' })).toBeVisible();
  const previousRevision = await page.evaluate(() => {
    const folder = JSON.parse(localStorage.getItem('mock-folder')!);
    const key = 'mock-sqlite-' + folder;
    const row = JSON.parse(localStorage.getItem(key)!);
    const saved = JSON.parse(row.records);
    saved.patients[0].name = 'fictioNal Folder meadow';
    localStorage.setItem(key, JSON.stringify({ ...row, records: JSON.stringify(saved) }));
    return row.revision;
  });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'FİCTİONAL FOLDER MEADOW', exact: true })).toBeVisible();
  expect(await page.evaluate(() => {
    const folder = JSON.parse(localStorage.getItem('mock-folder')!);
    const row = JSON.parse(localStorage.getItem('mock-sqlite-' + folder)!);
    return { name: JSON.parse(row.records).patients[0].name, revision: row.revision };
  })).toEqual({ name: 'FİCTİONAL FOLDER MEADOW', revision: previousRevision + 1 });

  await page.getByRole('link', { name: 'Edit patient', exact: true }).click();
  await page.getByLabel('Full name').fill('fictional FOLDER meadow');
  await page.getByRole('button', { name: 'Save patient' }).click();
  await expect(page.getByRole('heading', { name: 'FİCTİONAL FOLDER MEADOW', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Copy patient phone +1 202-555-0100' }).click();
  await expect(page.locator('.patient-profile-contact').getByRole('status')).toHaveText('Copied');
  await page.getByRole('tab', { name: 'Follow-up', exact: true }).click();
  await page.getByRole('tabpanel', { name: 'Follow-up' }).getByText('Tasks', { exact: true }).click();
  await page.getByRole('link', { name: 'Add task' }).click();
  await page.getByLabel('Title').fill('Fictional offline preparation');
  const taskHoldsBooking = page.getByRole('switch', { name: /Block booking/ });
  await expect(taskHoldsBooking).toBeChecked();
  await taskHoldsBooking.uncheck();
  await page.getByRole('button', { name: 'Save task' }).click();
  await expect(page.getByRole('link', { name: 'Fictional offline preparation' })).toBeVisible();

  await page.evaluate(() => {
    const event = (id: string, title: string, calendar: string, start: string, end: string) => ({
      id, title, calendar, allDay: false,
      begin: Date.parse('2026-11-23T' + start + ':00+03:00'),
      end: Date.parse('2026-11-23T' + end + ':00+03:00'),
    });
    localStorage.setItem('mock-calendar-events', JSON.stringify([
      event('google', 'Fictional meeting', 'Google calendar', '09:00', '10:00'),
      event('phone', 'Fictional errand', 'Phone calendar', '09:15', '10:30'),
      event('buffered', 'Fictional team meeting', 'Google calendar', '12:30', '13:30'),
      { id: '54:first', eventId: '54', title: 'Teachers’ Day', calendar: 'Observances', allDay: true,
        begin: Date.UTC(2026, 10, 30), end: Date.UTC(2026, 11, 1) },
      { id: '54:repeat', eventId: '54', title: 'Teachers’ Day', calendar: 'Observances', allDay: true,
        begin: Date.UTC(2026, 11, 14), end: Date.UTC(2026, 11, 15) },
    ]));
  });
  await page.getByRole('link', { name: 'New appointment' }).click();
  await page.getByRole('button', { name: 'Copy patient phone +1 202-555-0100' }).click();
  await expect(page.locator('.form-actions').getByRole('status')).toHaveText('Copied');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('mock-copied-phone')!))).toBe('+1 202-555-0100');
  await page.getByLabel('Visit title').fill('Fictional calendar override');
  expect(await page.evaluate(() => localStorage.getItem('mock-calendar-automatic'))).toBe('true');
  await expectBookingTime(page, '2026-11-23', '13:30–15:00');
  const moreActions = page.getByRole('button', { name: 'More actions' });
  await moreActions.click();
  await page.getByRole('button', { name: 'Copy time', exact: true }).click();
  await expect(page.getByText('Date and time copied.')).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('mock-copied-time')!)))
    .toEqual('Monday, November 23, 2026 · 13:30–15:00');
  await page.keyboard.press('Escape');
  const bufferWarning = page.locator('.booking-buffer-feedback');
  await expect(bufferWarning).toContainText('Fictional team meeting');
  await expect(bufferWarning).toContainText('60-minute buffer · 11:30–12:30');
  await bufferWarning.getByRole('button', { name: 'Ignore buffer for this appointment' }).click();
  await expectBookingTime(page, '2026-11-23', '10:30–12:00');
  await expect(page.getByText('Buffer ignored for this appointment')).toBeVisible();
  const picker = await openTimePicker(page);
  await expect(picker.getByRole('button', { name: /Next week.*Dec 1/ })).toBeVisible();
  await expect(picker.getByRole('button', { name: /Two weeks/ })).toBeVisible();
  await picker.getByRole('button', { name: 'Close time picker' }).click();
  await chooseBookingStart(page, '09:00');
  await expect(page.getByText('Choose a time outside the overlapping calendar events.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Book visit' })).toBeDisabled();

  // Explicit date-based booking retains the existing per-event confirmations.
  await page.goto('https://localhost/#/appointments/new?date=2026-11-23');
  await chooseBookingPatient(page, 'FİCTİONAL FOLDER MEADOW');
  await page.getByLabel('Visit title').fill('Fictional calendar override');
  await chooseBookingStart(page, '09:00');
  await page.getByRole('checkbox', { name: /Ignore Fictional meeting/ }).check();
  await page.getByRole('button', { name: 'Book visit' }).click();
  await expect(page.getByRole('alert')).toContainText('Review each overlapping calendar event');
  await expect(page.getByRole('alert')).toHaveClass('slot-feedback');
  await page.getByRole('checkbox', { name: /Ignore Fictional errand/ }).check();
  await page.evaluate(() => {
    const events = JSON.parse(localStorage.getItem('mock-calendar-events')!);
    events.push({ ...events[0], id: 'new-event', title: 'Fictional event added while booking' });
    localStorage.setItem('mock-calendar-events', JSON.stringify(events));
  });
  await page.getByRole('button', { name: 'Book visit' }).click();
  await page.getByRole('checkbox', { name: /Ignore Fictional event added while booking/ }).check();
  await page.getByRole('button', { name: 'Book visit' }).click();
  await expect(page.getByRole('heading', { name: 'Fictional calendar override' })).toBeVisible();

  const navigation = page.getByRole('navigation', { name: 'Main navigation' });
  await navigation.getByRole('link', { name: 'Calendar' }).click();
  await expect(page.getByRole('heading', { name: 'Device calendar events' })).toBeVisible();
  const deviceEvents = page.getByRole('heading', { name: 'Device calendar events' }).locator('../..');
  await expect(deviceEvents.getByText('Fictional meeting', { exact: true })).toBeVisible();
  await expect(deviceEvents.getByText('Fictional errand', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'View current conflicts' })).toHaveCount(0);
  await jumpToCalendarDate(page, '2026-11-30');
  const teachersDay = page.getByRole('article').filter({ hasText: 'Teachers’ Day' });
  await expect(teachersDay.getByText('Busy', { exact: true })).toBeVisible();
  await teachersDay.getByRole('button', { name: 'Ignore Teachers’ Day for all bookings' }).click();
  await expect(teachersDay.getByText('Ignored', { exact: true })).toBeVisible();
  await jumpToCalendarDate(page, '2026-12-14');
  await expect(teachersDay.getByText('Ignored', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'New appointment' }).click();
  await chooseBookingPatient(page, 'FİCTİONAL FOLDER MEADOW');
  await page.getByLabel('Visit title').fill('Fictional future visit');
  const futurePicker = await openTimePicker(page);
  await expect(futurePicker.getByRole('button', { name: /Next week.*Nov 30 · 09:00–10:30/ })).toBeVisible();
  await futurePicker.getByRole('button', { name: /Two weeks/ }).click();
  await futurePicker.getByRole('button', { name: 'Use this time' }).click();
  await page.getByRole('button', { name: 'Book visit' }).click();
  await expect(page.getByRole('heading', { name: 'Fictional future visit' })).toBeVisible();

  await navigation.getByRole('link', { name: 'Today' }).click();
  await page.evaluate(() => {
    const events = JSON.parse(localStorage.getItem('mock-calendar-events')!);
    events.push({
      ...events[0], id: 'future-event', title: 'Fictional meeting two weeks later',
      begin: Date.parse('2026-12-07T09:00:00+03:00'), end: Date.parse('2026-12-07T10:00:00+03:00'),
    });
    localStorage.setItem('mock-calendar-events', JSON.stringify(events));
  });
  await page.reload();
  await page.getByRole('link', { name: 'View current conflicts' }).click();
  await expect(page.getByRole('heading', { name: 'Current conflicts' })).toBeVisible();
  await page.getByRole('button', { name: 'Ignore Fictional meeting two weeks later for this appointment' }).click();
  await expect(page.getByText('No current scheduling conflicts.')).toBeVisible();
  await page.getByRole('link', { name: 'Ignored conflicts' }).click();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Ignored for all bookings' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Ignored for specific appointments' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Restore Teachers’ Day for all bookings' })).toBeVisible();
  await page.getByRole('button', { name: 'Restore warning for Fictional meeting two weeks later for this appointment' }).click();
  await expect(page.getByRole('button', { name: 'Restore Teachers’ Day for all bookings' })).toBeVisible();
  await page.getByRole('button', { name: 'Restore Teachers’ Day for all bookings' }).click();
  await expect(page.getByText('No events ignored for all bookings.')).toBeVisible();
  await page.getByRole('link', { name: 'Back' }).click();
  await expect(page.getByRole('button', { name: 'Ignore Fictional meeting two weeks later for this appointment' })).toBeVisible();
  await page.evaluate(() => {
    const events = JSON.parse(localStorage.getItem('mock-calendar-events')!);
    events.push({ ...events.at(-1), id: 'future-second:176:180', title: 'Fictional event added on the phone' });
    localStorage.setItem('mock-calendar-events', JSON.stringify(events));
    window.dispatchEvent(new Event('test-calendar-change'));
  });
  await expect(page.getByRole('button', { name: 'Ignore Fictional event added on the phone for this appointment' })).toBeVisible();
  const phoneEvent = page.getByRole('article').filter({ hasText: 'Fictional event added on the phone' });
  await phoneEvent.getByRole('link', { name: 'View event' }).click();
  await expect(page).toHaveURL(/date=2026-12-07/);
  await expect(phoneEvent).toBeFocused();
  await phoneEvent.getByRole('button', { name: 'Ignore Fictional event added on the phone for all bookings' }).click();
  await expect(phoneEvent.getByText('Ignored', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Current conflicts' })).toBeVisible();
  await expect(phoneEvent).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Ignore Fictional meeting two weeks later for this appointment' })).toBeVisible();
  await navigation.getByRole('link', { name: 'Calendar' }).click();
  await jumpToCalendarDate(page, '2026-11-30');
  await expect(teachersDay.getByText('Busy', { exact: true })).toBeVisible();

  await navigation.getByRole('link', { name: 'Work' }).click();
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByText('Off', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Set up publishing' }).click();
  await page.getByLabel('Dedicated Google calendar').selectOption('700');
  await expect(page.getByText('test@example.invalid', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Start publishing' }).click();
  await expect(page.getByText('Saved to the phone calendar. Google syncs separately.')).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('mock-published-visits')!).map((visit: { title: string }) => visit.title)))
    .toEqual(['FİCTİONAL FOLDER MEADOW', 'FİCTİONAL FOLDER MEADOW']);
  await page.evaluate(() => {
    localStorage.setItem('mock-publishing-denied', 'true');
    window.dispatchEvent(new Event('test-foreground'));
  });
  await expect(page.getByRole('alert')).toHaveText('Allow calendar access in AkiSync’s Android app permissions, then try again.');
  await page.evaluate(() => localStorage.setItem('mock-new-folder', JSON.stringify('Documents/AkiSync-moved')));
  await page.getByRole('button', { name: 'Change folder' }).click();
  await expect(page.getByText('Documents/AkiSync-moved')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('mock-sqlite-Documents/AkiSync-moved'))).toContain('FİCTİONAL FOLDER MEADOW');
  expect(await page.evaluate(() => localStorage.getItem('mock-sqlite-Documents/AkiSync-moved'))).toContain('Fictional offline preparation');
  expect(await page.evaluate(() => localStorage.getItem('mock-sqlite-Documents/AkiSync-moved'))).not.toContain('Fictional meeting');
  await page.evaluate(() => localStorage.removeItem('mock-publishing-denied'));
  await page.getByRole('button', { name: 'Retry publishing' }).click();
  await expect(page.getByText('Saved to the phone calendar. Google syncs separately.')).toBeVisible();
  await page.getByRole('button', { name: 'Pause publishing' }).click();
  await page.reload();
  await expect(page.getByText('Publishing paused. Existing events stay on the calendar.')).toBeVisible();
  await page.evaluate(() => {
    const visits = JSON.parse(localStorage.getItem('mock-published-visits')!);
    const events = JSON.parse(localStorage.getItem('mock-calendar-events')!);
    const copy = {
      id: 'published-today', eventId: 'published-today', calendarId: '700', calendar: 'AkiSync Appointments',
      title: visits[0].title, begin: visits[0].start, end: visits[0].end, allDay: false,
    };
    events.push(copy, { ...copy, id: 'external-overlap', eventId: 'external-overlap', calendarId: '701',
      calendar: 'Other calendar', title: 'Fictional overlap while paused' });
    localStorage.setItem('mock-calendar-events', JSON.stringify(events));
    window.dispatchEvent(new Event('test-calendar-change'));
  });
  await navigation.getByRole('link', { name: 'Calendar' }).click();
  await expect(deviceEvents.getByText('Fictional overlap while paused', { exact: true })).toBeVisible();
  await expect(deviceEvents.getByText('FİCTİONAL FOLDER MEADOW', { exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'View current conflicts' }).click();
  await expect(page.getByRole('button', { name: 'Ignore Fictional overlap while paused for this appointment' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ignore FİCTİONAL FOLDER MEADOW for this appointment' })).toHaveCount(0);
  await navigation.getByRole('link', { name: 'Work' }).click();
  await page.getByRole('link', { name: 'Settings' }).click();

  await page.getByRole('button', { name: 'Turn on app passphrase' }).click();
  await page.getByLabel('App passphrase', { exact: true }).fill(appPassword);
  await page.getByLabel('Confirm app passphrase').fill(appPassword);
  await page.getByRole('button', { name: 'Save app passphrase' }).click();
  await expect(page.getByText('On', { exact: true })).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('test-background')));
  await expect(page.getByRole('heading', { name: 'Unlock AkiSync' })).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('test-foreground')));
  await page.getByLabel('App passphrase', { exact: true }).fill('incorrect passphrase');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('alert')).toHaveText('The app passphrase is incorrect.');
  await page.getByLabel('Language').selectOption('tr');
  await expect(page.getByRole('alert')).toHaveText('Uygulama parolası yanlış.');
  await page.getByLabel('Dil').selectOption('en');
  await page.getByLabel('App passphrase', { exact: true }).fill(appPassword);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await page.getByRole('button', { name: 'Turn off app passphrase' }).click();
  await expect(page.getByText('Off', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('Off', { exact: true })).toBeVisible();
  await page.evaluate(() => localStorage.setItem('mock-patient-list', JSON.stringify({
    format: 'akisync-patient-list',
    version: 1,
    patients: [
      { name: 'fictional Folder meadow', status: 'Passive' },
      { name: 'Fictional New Roster', status: 'Active' },
      { name: 'Fictional Archive Roster', status: 'Passive' },
    ],
  })));
  await page.getByRole('button', { name: 'Choose patient list' }).click();
  await expect(page.getByText('1 Active · 1 Passive · 1 existing match')).toBeVisible();
  await page.getByRole('button', { name: 'Import patients' }).click();
  await dismissBookingOffer(page, 'FİCTİONAL NEW ROSTER');
  await expect(page.getByText('Imported 2 patients. 1 existing match skipped.')).toBeVisible();
  await page.getByRole('button', { name: 'Choose patient list' }).click();
  await expect(page.getByText('0 Active · 0 Passive · 3 existing matches')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import patients' })).toBeDisabled();
  await page.getByRole('navigation').getByRole('link', { name: 'Patients' }).click();
  await expect(page.getByRole('link', { name: /FİCTİONAL FOLDER MEADOW.*Active/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /FİCTİONAL NEW ROSTER.*Active/ })).toBeVisible();
  await page.getByRole('combobox', { name: 'Status' }).selectOption('Passive');
  await expect(page.getByRole('link', { name: /FİCTİONAL ARCHİVE ROSTER.*Passive/ })).toBeVisible();
  expect(unexpected).toEqual([]);
});
