import { expect, test, type Page } from '@playwright/test';
import { fictionalRecords } from '../src/storage/fixtures';
import { chooseBookingPatient, chooseBookingStart, dismissBookingOffer, expectBookingTime, openTimePicker } from './booking';
import { jumpToCalendarDate } from './calendar';

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-23T08:00:00+03:00'));
  await page.addInitScript(() => localStorage.setItem('akisync-language', 'en'));
  await page.route('**/*', route => {
    if (new URL(route.request().url()).hostname === '127.0.0.1') void route.continue();
    else void route.abort();
  });
});

async function openPatientGroup(page: Page, name: string) {
  await page.getByRole('tab', { name: 'Follow-up', exact: true }).click();
  const group = page.getByRole('tabpanel', { name: 'Follow-up' }).locator('details.patient-profile-group')
    .filter({ has: page.getByText(name, { exact: true }) });
  if ((await group.getAttribute('open')) === null) await group.locator(':scope > summary').click();
  return group;
}

function calendarLayout(page: Page) {
  return page.locator('.page-header').getByRole('combobox', { name: 'Calendar layout' });
}

test('booking patient picker waits for input, ranks matches, and preserves the appointment draft', async ({ page }) => {
  const records = fictionalRecords(new Date('2026-11-23T08:00:00+03:00'));
  const example = records.patients[0];
  records.patients.push(
    { ...example, id: 'match-exact', name: 'İpek', phone: '+90 (532) 555-1000', status: 'Passive' },
    { ...example, id: 'match-active', name: 'İpek Çelik', phone: '+90 (532) 555-1001' },
    { ...example, id: 'match-passive', name: 'İpek Çelik', phone: '+90 (532) 555-1002', status: 'Passive' },
    ...Array.from({ length: 7 }, (_, index) => ({ ...example, id: `match-${index}`, name: `İpek Yılmaz ${index + 1}`, phone: '' })),
  );
  await page.addInitScript(data => localStorage.setItem('akisync-fictional-preview-v1', JSON.stringify(data)), records);
  await page.goto('/#/appointments/new?from=today');
  const trigger = page.getByRole('button', { name: /^Patient / });
  const visitTitle = page.getByLabel('Visit title');
  const appointmentTime = page.locator('#booking-slot-summary');
  await expect(appointmentTime.locator('time')).toBeVisible();
  const originalTime = await appointmentTime.innerText();
  await visitTitle.fill('Follow-up draft');
  await trigger.click();
  const picker = page.getByRole('dialog', { name: 'Choose a patient' });
  const search = picker.getByRole('searchbox', { name: 'Search patients' });
  const rows = picker.locator('.booking-patient-list').getByRole('button');
  await expect(search).toBeFocused();
  await expect(rows).toHaveCount(0);
  await expect(picker.getByRole('status')).toHaveText('Search by name, phone number, or email.');
  await search.fill('Ipek');
  await expect(rows).toHaveCount(8);
  await expect(rows.first()).toHaveText(/İPEK.*1000.*Passive/);
  await picker.getByRole('button', { name: 'Show more patients' }).click();
  await expect(rows).toHaveCount(10);
  await expect(rows.nth(8)).toBeFocused();
  await search.fill('missing');
  await expect(picker.getByRole('status')).toContainText('Try a surname or the last four digits');
  await search.clear();
  await expect(rows).toHaveCount(0);
  await search.fill('1002');
  await expect(rows).toHaveCount(1);
  await rows.first().click();
  await expect(trigger).toHaveAccessibleName('Patient İPEK ÇELİK');
  await expect(trigger).toBeFocused();
  await expect(visitTitle).toHaveValue('Follow-up draft');
  await expect(appointmentTime).toHaveText(originalTime, { useInnerText: true });
  await trigger.click();
  await expect(search).toHaveValue('');
  await expect(rows).toHaveCount(0);
});

test('add, find, book, take a linked note and close treatment without deactivating the patient', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await expect(page.getByText('Critical: Latex allergy')).toBeVisible();
  await page.context().setOffline(true);
  await page.getByRole('navigation').getByRole('link', { name: 'Patients' }).click();
  await page.getByRole('link', { name: 'Add patient' }).click();
  await page.getByLabel('Full name').fill('rÜya meadow');
  await page.getByLabel('Phone').fill('+1 202-555-0150');
  await page.getByRole('button', { name: 'Save patient' }).click();
  await dismissBookingOffer(page, 'RÜYA MEADOW');
  await expect(page.getByRole('heading', { name: 'RÜYA MEADOW' })).toBeVisible();
  const treatments = await openPatientGroup(page, 'Treatments');
  await page.getByRole('link', { name: 'Add treatment' }).click();
  await page.getByLabel('Title').fill('Fictional retainer review');
  await page.getByRole('button', { name: 'Save treatment' }).click();
  await page.getByRole('link', { name: 'New appointment' }).click();
  await page.getByLabel('Visit title').fill('Retainer check');
  await page.getByText('Optional details', { exact: true }).click();
  await page.getByLabel('Procedure (optional)').fill('Review fit');
  await page.getByLabel('Preparation notes (optional)').fill('Prepare the fictional model.');
  await page.getByRole('button', { name: 'Book visit' }).click();
  await expect(page.getByRole('heading', { name: 'Retainer check' })).toBeVisible();
  await expect(page.getByText('Prepare the fictional model.', { exact: false })).toBeVisible();
  await page.getByRole('link', { name: 'Add note' }).click();
  await expect(page.getByLabel('Appointment (optional)')).not.toHaveValue('');
  await expect(page.getByLabel('Appointment (optional)')).toBeHidden();
  await expect(page.getByLabel('Contact type')).toHaveValue('Clinical visit');
  await page.getByRole('textbox', { name: 'Note', exact: true }).fill('Fictional visit note. Fit reviewed.');
  await page.getByRole('button', { name: 'Save note' }).click();
  await page.getByRole('tab', { name: 'History', exact: true }).click();
  await page.getByRole('tabpanel', { name: 'History' }).locator('summary').filter({ hasText: 'Encounter note' }).click();
  await expect(page.getByText('Fictional visit note. Fit reviewed.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Linked appointment' })).toBeVisible();
  await openPatientGroup(page, 'Treatments');
  await page.getByRole('link', { name: 'Close treatment' }).click();
  await page.getByLabel('Closure note (optional)').fill('Fictional treatment complete.');
  await page.getByRole('button', { name: 'Close treatment' }).click();
  await expect(page.locator('.patient-profile-identity').getByText('Active', { exact: true })).toBeVisible();
  await expect(treatments.getByText('Closed', { exact: true })).toBeVisible();
  await page.context().setOffline(false);
  await page.reload();
  await expect(page.getByText('Fictional treatment complete.')).toBeVisible();
  await page.getByRole('navigation').getByRole('link', { name: 'Patients' }).click();
  await page.getByRole('searchbox').fill('ruya 2025550150');
  await expect(page.getByRole('link', { name: /RÜYA MEADOW.*Active/ })).toBeVisible();
  await page.getByRole('searchbox').clear();
  await page.getByLabel('Status').selectOption('Passive');
  await expect(page.getByRole('link', { name: /LENA FİNCH.*Passive/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /RÜYA MEADOW/ })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});

test('patient search groups highlighted note matches and opens the selected note in History', async ({ page }) => {
  const records = fictionalRecords(new Date('2026-11-23T08:00:00+03:00'));
  const note = records.notes[0];
  const colors = ['Kobalt', 'Mercan', 'Kum', 'Lila'];
  const noteBody = (color: string) => `${color} örneği için Gülüş provası tamamlandı. Sonuç kurgusal notta saklandı.`;
  records.notes.push(
    ...colors.map((color, index) => ({
      ...note, id: `search-note-${index}`, title: `${color} kontrol kaydı`,
      date: `2026-11-${16 + index}`, body: noteBody(color),
    })),
    { ...note, id: 'search-passive-note', patientId: 'demo-lena', title: 'Kurgusal kontrol kaydı', body: noteBody('Yeşil') },
  );
  await page.addInitScript(data => localStorage.setItem('akisync-fictional-preview-v1', JSON.stringify(data)), records);
  await page.goto('/#/patients');

  const search = page.getByRole('searchbox', { name: 'Search patients' });
  const mira = page.getByRole('region', { name: 'MİRA ARDEN', exact: true });
  const lena = page.getByRole('region', { name: 'LENA FİNCH', exact: true });
  const status = page.getByLabel('Status');
  const priority = page.getByLabel('Priority');
  await search.fill('GULUS provasi');
  await expect(mira).toHaveCount(1);
  await expect(mira.locator('.patient-search-hit')).toHaveCount(3);
  await expect(mira.locator('mark').filter({ hasText: 'Gülüş' }).first()).toBeVisible();
  await expect(lena.locator('.patient-search-hit')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);

  await priority.selectOption('Urgent');
  await expect(mira).toBeVisible();
  await expect(lena).toHaveCount(0);
  await priority.selectOption('All');
  await status.selectOption('Passive');
  await expect(mira).toHaveCount(0);
  await expect(lena).toBeVisible();
  await status.selectOption('Active');
  await expect(mira).toBeVisible();
  await expect(lena).toHaveCount(0);
  await mira.getByRole('button', { name: 'Show 1 more matches' }).click();
  await expect(mira.locator('.patient-search-hit')).toHaveCount(4);
  await mira.getByRole('link', { name: /Kobalt kontrol kaydı/ }).click();

  await expect(page).toHaveURL(/#\/patients\/demo-mira\?note=search-note-0$/);
  await expect(page.getByRole('tab', { name: 'History', exact: true })).toHaveAttribute('aria-selected', 'true');
  const history = page.getByRole('tabpanel', { name: 'History', exact: true });
  await expect(history.getByText(noteBody('Kobalt'), { exact: true })).toBeVisible();
  await expect(history.getByText(noteBody('Lila'), { exact: true })).toBeHidden();

  await page.getByRole('link', { name: 'Back', exact: true }).click();
  await expect(search).toHaveValue('GULUS provasi');
  await expect(status).toHaveValue('Active');
  await expect(mira).toBeVisible();
  await expect(lena).toHaveCount(0);
});

test('patient search opens matches in appointments, follow-ups, tasks, alerts, and treatments', async ({ page }) => {
  const records = fictionalRecords(new Date('2026-11-23T08:00:00+03:00'));
  const match = 'citrine marker';
  records.appointments = records.appointments.map(item => item.id === 'demo-2' ? { ...item, notes: `Prepare the fictional ${match}.` } : item);
  records.alerts[0].notes = `Fictional alert uses the ${match}.`;
  records.waits[0].notes = `Fictional follow-up on the ${match}.`;
  records.treatments = records.treatments.map(item => ({
    ...item, status: 'Closed', closedOn: '2026-11-19', closureNote: `Fictional treatment recorded a ${match}.`,
  }));
  records.tasks.push(
    { id: 'search-patient-task', patientId: 'demo-ada', title: 'Review materials', notes: `Verify the fictional ${match}.`, completedOn: null, blocks: false },
    { id: 'search-clinic-task', patientId: null, title: 'Clinic-only reminder', notes: `Check the fictional ${match}.`, completedOn: null, blocks: false },
  );
  await page.addInitScript(data => localStorage.setItem('akisync-fictional-preview-v1', JSON.stringify(data)), records);
  await page.goto('/#/patients');

  const search = page.getByRole('searchbox', { name: 'Search patients' });
  await search.fill(match);
  await expect(page.locator('.patient-search-hit')).toHaveCount(5);
  await expect(page.getByText('Clinic-only reminder', { exact: true })).toHaveCount(0);
  const matches = [
    { owner: 'ELİ DEMİR', title: 'Routine examination', route: /#\/appointments\/demo-2\?/, heading: 'Routine examination' },
    { owner: 'JONAH LAKE', title: 'Confirm availability', route: /#\/patients\/demo-jonah\/responses\/demo-wait\?/, heading: 'Confirm availability' },
    { owner: 'ADA KESTREL', title: 'Review materials', route: /#\/tasks\/search-patient-task\?/, heading: 'Review materials' },
    { owner: 'MİRA ARDEN', title: 'Latex allergy', route: /#\/patients\/demo-mira\/alerts\/demo-allergy/, heading: 'Edit clinical alert' },
    { owner: 'MİRA ARDEN', title: 'Temporary restoration', route: /#\/patients\/demo-mira\/treatments\/demo-restoration/, heading: 'Edit treatment' },
  ];
  for (const { owner, title, route, heading } of matches) {
    await page.getByRole('region', { name: owner, exact: true }).getByRole('link', { name: new RegExp(title) }).click();
    await expect(page).toHaveURL(route);
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    await page.goBack();
    await expect(search).toHaveValue(match);
  }
});

test('add a quick patient note in History and edit its optional details', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-23T11:30:00+03:00'));
  await page.goto('/#/patients/demo-eli');
  const history = page.getByRole('tabpanel', { name: 'History' });
  const overview = page.getByRole('tab', { name: 'Overview' });
  await expect(overview).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('link', { name: /Progress check/ })).toBeVisible();
  const followUp = page.getByRole('tab', { name: 'Follow-up', exact: true });
  await followUp.click();
  await expect(page.getByText('No open tasks.')).toBeHidden();
  await overview.click();
  const addNote = page.getByRole('button', { name: 'Add note', exact: true });
  await addNote.click();
  const body = history.getByRole('textbox', { name: 'Note', exact: true });
  await expect(body).toBeFocused();
  await expect(history.getByLabel('Contact type')).toBeHidden();
  await body.fill('Implant brand and model recorded.');
  await followUp.click();
  await page.getByRole('tab', { name: 'History', exact: true }).click();
  await expect(body).toHaveValue('Implant brand and model recorded.');
  await history.getByRole('button', { name: 'Save note' }).click();
  await expect(history.getByRole('status')).toHaveText('Note saved.');
  await expect(history.getByText('Implant brand and model recorded.')).toBeVisible();
  await expect(history.getByRole('link', { name: /Routine examination.*Outcome pending/ })).toBeVisible();
  await expect(addNote).toBeFocused();
  await expect(page).toHaveURL(/#\/patients\/demo-eli$/);

  await history.getByRole('link', { name: 'Edit' }).click();
  await expect(page.getByRole('heading', { name: 'Edit note' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Note', exact: true })).toHaveValue('Implant brand and model recorded.');
  await page.getByText('Note details', { exact: true }).click();
  await expect(page.getByLabel('Date', { exact: true })).toHaveValue('2026-11-23');
  await expect(page.getByLabel('Contact type')).toHaveValue('Other');
  await expect(page.getByLabel('Appointment (optional)')).toHaveValue('');
  await page.getByLabel('Title (optional)').fill('Implant details');
  await page.getByText('Note details', { exact: true }).click();
  await page.getByRole('button', { name: 'Save note' }).click();
  await expect(history.getByText('Implant details')).toBeVisible();
  await history.locator('summary').filter({ hasText: 'Implant details' }).click();
  await expect(history.getByText('Implant brand and model recorded.')).toBeVisible();
});

test('scheduling offers alternatives to an unconfirmed overlap and preserves blocking waits', async ({ page }) => {
  await page.goto('/#/calendar');
  await page.getByRole('link', { name: 'New appointment' }).click();
  await chooseBookingPatient(page, 'JONAH LAKE');
  await page.getByLabel('Visit title').fill('Fictional consultation');
  await chooseBookingStart(page, '09:00');
  await expect(page.getByText('09:00–09:45 overlaps with MİRA ARDEN.')).toBeVisible();
  await page.getByLabel('Blocking waits exception reason').fill('Patient confirmed the appointment by phone.');
  await page.getByRole('button', { name: 'Book visit' }).click();
  await expect(page.getByRole('alert')).toContainText('Confirm each overlapping appointment');
  const picker = await openTimePicker(page);
  await picker.getByRole('button', { name: /First availability.*Nov 23 · 14:45–16:15/ }).click();
  await picker.getByRole('button', { name: 'Use this time' }).click();
  await page.getByRole('button', { name: 'Book visit' }).click();
  await expect(page.getByRole('heading', { name: 'Fictional consultation' })).toBeVisible();
  await expect(page.getByText('Patient confirmed the appointment by phone.')).toBeVisible();
  await page.getByRole('link', { name: 'Edit appointment' }).click();
  const editTime = await openTimePicker(page);
  await editTime.getByText('Choose date and time', { exact: true }).click();
  await editTime.getByLabel('Date', { exact: true }).fill('2026-11-24');
  await editTime.getByRole('button', { name: 'Use this time' }).click();
  await page.getByLabel('Blocking waits exception reason').fill('Patient agreed to the reschedule.');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Tuesday, November 24')).toBeVisible();
  await page.getByText('Appointment outcome', { exact: true }).click();
  await page.getByRole('button', { name: 'Other outcomes' }).click();
  await page.getByRole('dialog', { name: 'Other outcomes' }).getByRole('button', { name: 'Cancelled', exact: true }).click();
  await expect(page.locator('.row-heading .pill')).toHaveText('Cancelled');
});

test('a manually chosen overlapping visit saves after every warning is acknowledged', async ({ page }) => {
  await page.goto('/#/calendar');
  await page.getByRole('link', { name: 'New appointment' }).click();
  await chooseBookingPatient(page, 'ADA KESTREL');
  await page.getByLabel('Visit title').fill('Fictional overlapping follow-up');
  await chooseBookingStart(page, '09:30');
  const mira = page.getByRole('checkbox', { name: /Ignore overlap.*MİRA ARDEN/ });
  const eli = page.getByRole('checkbox', { name: /Ignore overlap.*ELİ DEMİR/ });
  await mira.check();
  await page.getByRole('button', { name: 'Book visit' }).click();
  await expect(page.getByRole('alert')).toHaveText('Confirm each overlapping appointment before saving.');
  await expect(page.getByRole('alert')).toHaveClass('slot-feedback');
  await chooseBookingStart(page, '09:35');
  await expect(mira).not.toBeChecked();
  await chooseBookingStart(page, '09:30');
  await mira.check();
  await eli.check();
  await page.getByRole('button', { name: 'Book visit' }).click();
  await expect(page.getByRole('heading', { name: 'Fictional overlapping follow-up' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Scheduling exceptions' })).toBeVisible();
  await expect(page.getByText('Overlapping appointments', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Edit appointment' }).click();
  await page.getByText('Optional details', { exact: true }).click();
  await page.getByLabel('Preparation notes (optional)').fill('Fictional note added after booking.');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Fictional note added after booking.')).toBeVisible();
});

test('Optimum leaves a three-hour opening and Earlier steps back to the first fitting time', async ({ page }) => {
  const records = fictionalRecords(new Date('2026-11-23T08:00:00+03:00'));
  const settings = { presets: [30, 90, 180], defaultMinutes: 90 };
  records.appointments = [];
  records.workingHours = [1, 2, 3].map(day => ({ day, start: '09:00', end: '17:00' }));
  records.hoursOverrides = [
    { date: '2026-11-23', windows: [
      { start: '09:00', end: '12:00' }, { start: '13:00', end: '14:00' }, { start: '15:30', end: '16:00' },
    ] },
    { date: '2026-11-24', windows: [{ start: '09:00', end: '09:45' }] },
    { date: '2026-11-25', windows: [{ start: '09:00', end: '10:30' }] },
    { date: '2026-11-30', windows: [{ start: '09:00', end: '11:00' }] },
    { date: '2026-12-01', windows: [{ start: '09:00', end: '12:05' }] },
  ];
  await page.addInitScript(data => localStorage.setItem('akisync-fictional-preview-v1', JSON.stringify(data)), { ...records, bookingDurations: settings });
  await page.goto('/#/appointments/new?from=today');

  const summary = page.locator('#booking-slot-summary');
  const earlier = page.getByRole('button', { name: 'Earlier time', exact: true });
  const reserve = page.locator('.booking-optimum-reserve');
  await expect(summary).toContainText('Optimum');
  await expectBookingTime(page, '2026-11-25', '09:00–10:30');
  await expect(reserve).toHaveAttribute('data-state', 'preserved');
  await expect(reserve).toContainText('09:00–12:00');
  await expect(earlier).toHaveAttribute('data-state', 'last');

  const picker = await openTimePicker(page);
  await picker.getByRole('button', { name: /^First availability.*Nov 23 · 09:00–10:30/ }).click();
  await picker.getByRole('button', { name: 'Use this time' }).click();
  await expectBookingTime(page, '2026-11-23', '09:00–10:30');
  await expect(reserve).toHaveAttribute('data-state', 'lost');
  await expect(reserve).toContainText('09:00–12:00');
  await expect(page.getByRole('button', { name: 'No earlier time', exact: true })).toBeDisabled();

  await page.getByRole('button', { name: '30 min', exact: true }).click();
  await expect(summary).toContainText('Optimum');
  await expectBookingTime(page, '2026-11-23', '15:30–16:00');
  await expect(earlier).toHaveAttribute('data-state', 'multiple');
  await earlier.click();
  await expectBookingTime(page, '2026-11-23', '13:00–13:30');
  await expect(reserve).toHaveAttribute('data-state', 'preserved');
  await expect(reserve).toContainText('09:00–12:00');
  await expect(earlier).toHaveAttribute('data-state', 'last');
  await earlier.click();
  await expectBookingTime(page, '2026-11-23', '09:00–09:30');
  await expect(page.getByRole('button', { name: 'No earlier time', exact: true })).toBeDisabled();

  await page.getByRole('button', { name: '3 hr', exact: true }).click();
  await page.getByRole('button', { name: 'Custom duration', exact: true }).click();
  const customDuration = page.getByRole('dialog', { name: 'Custom duration' });
  await customDuration.getByRole('spinbutton', { name: 'Minutes' }).press('ArrowUp');
  await customDuration.getByRole('button', { name: 'Find a time', exact: true }).click();
  await expectBookingTime(page, '2026-12-01', '09:00–12:05');
  await expect(page.getByRole('button', { name: 'No earlier time', exact: true })).toBeDisabled();
  await chooseBookingPatient(page, 'ADA KESTREL');
  await page.getByLabel('Visit title').fill('Fictional long appointment');
  await page.getByRole('button', { name: 'Book visit' }).click();
  await expect(page.getByRole('heading', { name: 'Fictional long appointment' })).toBeVisible();
  await expect(page.getByText('09:00–12:05')).toBeVisible();
});

test('Later picks the tightest later opening and stops after the extra working day', async ({ page }) => {
  const records = fictionalRecords(new Date('2026-11-23T08:00:00+03:00'));
  records.appointments = [];
  records.workingHours = [1, 2, 3].map(day => ({ day, start: '09:00', end: '17:00' }));
  records.hoursOverrides = [
    { date: '2026-11-23', windows: [{ start: '09:00', end: '12:00' }, { start: '13:00', end: '14:00' }] },
    { date: '2026-11-24', windows: [{ start: '14:45', end: '16:00' }] },
    { date: '2026-11-25', windows: [{ start: '13:30', end: '14:30' }] },
    { date: '2026-11-30', windows: [{ start: '09:00', end: '11:00' }] },
    { date: '2026-12-01', windows: [{ start: '09:00', end: '12:05' }] },
    { date: '2026-12-02', windows: [{ start: '09:00', end: '10:00' }] },
  ];
  await page.addInitScript(data => localStorage.setItem('akisync-fictional-preview-v1', JSON.stringify(data)), {
    ...records,
    bookingDurations: { presets: [60, 90, 180], defaultMinutes: 60 },
  });
  await page.goto('/#/appointments/new?from=today');

  const summary = page.locator('#booking-slot-summary');
  const reserve = page.locator('.booking-optimum-reserve');
  const later = page.getByRole('button', { name: 'Later time', exact: true });
  await expect(summary).toContainText('Optimum');
  await expectBookingTime(page, '2026-11-23', '13:00–14:00');
  await expect(reserve).toHaveAttribute('data-state', 'preserved');
  await expect(reserve.locator('time')).toHaveAttribute('datetime', '2026-11-23');
  await expect(reserve).toContainText('09:00–12:00');

  await later.click();
  await expect(summary).toContainText('Later suggestion');
  await expectBookingTime(page, '2026-11-25', '13:30–14:30');
  await expect(reserve).toHaveAttribute('data-state', 'preserved');
  await expect(reserve.locator('time')).toHaveAttribute('datetime', '2026-11-23');
  await expect(reserve).toContainText('09:00–12:00');

  await later.click();
  await expectBookingTime(page, '2026-11-30', '09:00–10:00');
  await expect(later).toHaveAccessibleDescription('Go to the extra working day');
  await later.click();
  await expectBookingTime(page, '2026-12-01', '09:00–10:00');
  await expect(summary).toContainText('Extra working day');
  await expect(page.getByRole('button', { name: 'No later time', exact: true })).toBeDisabled();
});

test('customizing the default duration affects new bookings and Calendar opens Optimum on its selected date', async ({ page }) => {
  await page.goto('/#/work');
  await page.getByRole('link', { name: 'Preview data' }).click();
  await page.getByRole('link', { name: 'Appointment durations' }).click();
  await page.getByLabel('New duration (min)').fill('105');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('radio', { name: '105 min', exact: true }).check();
  await page.getByRole('button', { name: 'Save durations' }).click();
  await expect(page.getByText('Appointment durations saved.')).toBeVisible();

  await page.getByRole('navigation').getByRole('link', { name: 'Today' }).click();
  await page.getByRole('link', { name: 'New appointment' }).click();
  await expect(page.getByRole('button', { name: '105 min', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expectBookingTime(page, '2026-11-23', '14:45–16:30');

  await page.goto('/#/appointments/new?from=calendar&date=2026-11-23');
  await expect(page.getByRole('heading', { name: 'Optimal Slot Picker' })).toBeVisible();
  await expectBookingTime(page, '2026-11-23', '15:15–17:00');

  await page.getByRole('button', { name: '3 hr', exact: true }).click();
  await expect(page.getByText('No opening on this date for a 3 hr visit.')).toBeVisible();
  await expect(page.locator('#booking-slot-summary time')).toHaveAttribute('datetime', '2026-11-23');
  await expect(page.locator('#booking-slot-summary')).toContainText('No time selected');
  await page.getByRole('button', { name: 'Use Nov 24 · 09:00–12:00' }).click();
  await expectBookingTime(page, '2026-11-24', '09:00–12:00');
  await page.getByRole('button', { name: 'Next available day' }).click();
  await expectBookingTime(page, '2026-11-25', '12:30–15:30');
  await page.getByRole('button', { name: 'Previous available day' }).click();
  await expectBookingTime(page, '2026-11-24', '09:00–12:00');
  await page.getByRole('button', { name: '60 min', exact: true }).click();
  await expectBookingTime(page, '2026-11-24', '09:00–10:00');

  await page.goto('/#/appointments/demo-1/edit');
  await expectBookingTime(page, '2026-11-23', '09:00–09:45');
  await expect(page.getByRole('button', { name: 'Patient MİRA ARDEN' })).toBeVisible();
  const editTime = await openTimePicker(page);
  await editTime.getByText('Choose date and time', { exact: true }).click();
  await expect(editTime.getByLabel('Start time')).toHaveValue('09:00');
  await expect(editTime.getByLabel('End time')).toHaveValue('09:45');
});

test('book from a Today opening on its selected date with a suggested patient', async ({ page }) => {
  const records = fictionalRecords(new Date('2026-11-23T08:00:00+03:00'));
  const date = '2026-11-24';
  for (const [start, end] of [['09:00', '13:30'], ['15:00', '17:00']]) {
    records.appointments.push({ id: `reserve-${start}`, title: 'Reserved', date, start, end,
      kind: 'Block', patientId: null, status: 'Blocked time', procedure: '', notes: '', exceptions: [] });
  }
  await page.addInitScript(data => {
    if (!localStorage.getItem('akisync-fictional-preview-v1')) localStorage.setItem('akisync-fictional-preview-v1', JSON.stringify(data));
  }, records);
  await page.goto('/#/today');
  await page.getByText('90 min open tomorrow').click();
  const opening = page.getByRole('link', { name: /Tomorrow · 13:30–15:00/ });
  await opening.click();
  const openingUrl = page.url();
  await expect(page.getByRole('heading', { name: 'Add appointment' })).toBeVisible();
  await expectBookingTime(page, date, '13:30–15:00');
  await expect(page.getByRole('button', { name: '90 min', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Patient Choose a patient' })).toBeVisible();
  const suggestion = page.getByRole('button', { name: /Suggested patient ADA KESTREL Extra urgent/ });
  await expect(suggestion).toBeVisible();

  await page.getByRole('button', { name: '60 min', exact: true }).click();
  await expectBookingTime(page, date, '13:30–14:30');
  await page.getByRole('button', { name: '3 hr', exact: true }).click();
  await expect(page.getByText('No opening on this date for a 3 hr visit.')).toBeVisible();
  await expectBookingTime(page, date, '13:30–14:30');
  await expect(page.getByRole('button', { name: 'Next available day' })).toHaveCount(0);
  const picker = await openTimePicker(page);
  await expect(picker.getByRole('button', { name: /First availability.*Nov 24/ })).toBeVisible();
  await expect(picker.getByRole('button', { name: /Next week|Two weeks/ })).toHaveCount(0);
  await picker.getByText('Enter a time').click();
  await expect(picker.getByLabel('Date', { exact: true })).toHaveCount(0);
  await picker.getByRole('button', { name: 'Close time picker' }).click();

  await page.getByRole('button', { name: '90 min', exact: true }).click();
  await suggestion.click();
  await expect(page.getByRole('button', { name: 'Patient ADA KESTREL' })).toBeVisible();
  await page.getByLabel('Visit title').fill('Opening follow-up');
  await page.getByRole('button', { name: 'Book visit' }).click();
  await expect(page.getByRole('heading', { name: 'Opening follow-up' })).toBeVisible();
  await expect(page.getByText('13:30–15:00')).toBeVisible();

  await page.goto(openingUrl);
  await expect(page.getByText('This opening is no longer available.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Book visit' })).toBeDisabled();
  await expect(page.getByRole('button', { name: /Suggested patient/ })).toHaveCount(0);
});

test('Today limits availability by calendar and working days and stores reminder times', async ({ page }) => {
  const now = new Date('2026-11-25T10:00:00+03:00');
  const records = fictionalRecords(now);
  records.appointments = [];
  records.workingHours = [1, 2, 3].map(day => ({ day, start: '09:00', end: '11:00' }));
  await page.clock.setFixedTime(now);
  await page.addInitScript(data => localStorage.setItem('akisync-fictional-preview-v1', JSON.stringify(data)), records);
  await page.goto('/#/today');

  const openings = page.locator('details.today-openings');
  const monday = openings.locator('a[href*="date=2026-11-30"]');
  const tuesday = openings.locator('a[href*="date=2026-12-01"]');
  await openings.locator('summary').click();
  await expect(monday).toBeVisible();
  await expect(tuesday).toHaveCount(0);

  await page.clock.setFixedTime(new Date('2026-11-27T10:00:00+03:00'));
  await page.reload();
  await openings.locator('summary').click();
  await expect(monday).toBeVisible();
  await expect(tuesday).toHaveCount(0);

  await openings.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByLabel('Working days to check')).toHaveValue('2');
  await expect(page.getByLabel('Calendar day limit')).toHaveValue('3');
  await page.getByLabel('Calendar day limit').fill('4');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Availability settings saved.')).toBeVisible();
  await page.getByRole('link', { name: 'Manage notifications' }).click();
  await page.getByRole('switch', { name: 'Availability alerts' }).check();
  await expect(page.getByLabel('Minimum opening (min)')).toHaveValue('30');
  await expect(page.getByLabel('Reminder time 1')).toHaveValue('10:30');
  await expect(page.getByLabel('Reminder time 2')).toHaveValue('12:30');
  await expect(page.getByLabel('Reminder time 3')).toHaveValue('16:00');
  await page.getByLabel('Number of reminders').selectOption('2');
  await page.getByLabel('Reminder time 2').fill('15:15');
  await page.getByRole('button', { name: 'Save preferences' }).click();
  await expect(page.getByText('Notification preferences saved.')).toBeVisible();
  await page.getByRole('link', { name: 'Today', exact: true }).click();
  await openings.locator('summary').click();
  await expect(tuesday).toBeVisible();

  await page.goto('/#/data/notifications');
  await expect(page.getByLabel('Number of reminders')).toHaveValue('2');
  await expect(page.getByLabel('Reminder time 2')).toHaveValue('15:15');
  await page.getByRole('link', { name: 'Availability search settings' }).click();
  await page.getByLabel('Working days to check').fill('1');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('link', { name: 'Today', exact: true }).click();
  await openings.locator('summary').click();
  await expect(monday).toBeVisible();
  await expect(tuesday).toHaveCount(0);
});

test('Nothing arrived hides the Today shortcut and leaves the lab screen usable for later arrivals', async ({ page }) => {
  const now = new Date('2026-11-23T08:00:00+03:00');
  const records = fictionalRecords(now);
  const lab = { id: 'test-lab', patientId: 'demo-eli', title: 'Ceramic crown', type: 'Laboratory return', status: 'Waiting',
    startedOn: '2026-11-22', reviewOn: null, endedOn: null, blocks: true, notes: '' } as const;
  records.waits.push(lab, { ...lab, id: 'test-lab-fit', patientId: 'demo-mira', title: 'Fit check' },
    { ...lab, id: 'test-lab-retainer', patientId: 'demo-ada', title: 'Retainer' });
  records.dailyLabReminder = { enabled: true, time: '14:00', days: [1, 2] };
  await page.addInitScript(data => {
    const key = 'akisync-fictional-preview-v1';
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(data));
  }, records);
  await page.goto('/#/today');
  const shortcut = page.getByRole('link', { name: /^Daily Laboratory Check/ });
  const storedRecords = () => page.evaluate(() => JSON.parse(localStorage.getItem('akisync-fictional-preview-v1')!)) as Promise<typeof records>;
  const checked = { date: '2026-11-23', result: 'nothing' };
  await shortcut.click();
  await page.getByRole('button', { name: 'Nothing arrived' }).click();
  await expect(page).toHaveURL(/#\/today$/);
  await expect(shortcut).toHaveCount(0);
  expect(await storedRecords()).toMatchObject({ dailyLabCheck: checked, waits: records.waits });

  await page.getByRole('link', { name: 'Work', exact: true }).click();
  await expect(shortcut).toHaveCount(0);
  await page.getByRole('link', { name: 'Follow-ups', exact: true }).click();
  await expect(shortcut).toContainText('Checked today');
  await shortcut.click();
  await expect(page.getByRole('heading', { name: 'Daily Laboratory Check' })).toBeVisible();
  await expect(page.getByText('Checked today', { exact: true })).toBeVisible();
  const pending = page.getByRole('region', { name: 'Pending LabCheck tasks' });
  await expect(pending.getByRole('listitem')).toHaveCount(3);
  await pending.getByRole('link', { name: 'ELİ DEMİR' }).click();
  await expect(page.getByRole('heading', { name: 'ELİ DEMİR' })).toBeVisible();
  await page.getByRole('link', { name: 'Back', exact: true }).click();
  await pending.getByRole('button', { name: /Ceramic crown/ }).click();
  await expect(pending.getByText('Ceramic crown')).toHaveCount(0);

  await page.getByText('Add Missing Patients / LabCheck Tasks').click();
  const name = page.getByRole('searchbox', { name: 'Patient name' });
  for (const patient of ['Mira Arden', 'Nora Vale', 'Nora Vale']) {
    await name.fill(patient);
    await page.getByRole('button', { name: 'Find', exact: true }).click();
    await expect(name).toHaveValue('');
  }
  await name.fill('Jamie Stone');
  await page.getByRole('button', { name: 'Find', exact: true }).click();
  await page.getByRole('button', { name: 'Create patient' }).click();
  await page.getByRole('button', { name: 'Save and mark Done' }).click();
  await expect(page.getByText('4 lab cases done today')).toBeVisible();
  await expect(pending.getByRole('listitem')).toHaveCount(1);
  await expect(pending.getByText('Retainer')).toBeVisible();
  await expect(page.getByText('Checked today', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Dismiss for today' })).toHaveCount(0);
  const saved = await storedRecords();
  expect(saved).toMatchObject({ dailyLabCheck: checked, dailyLabReminder: records.dailyLabReminder });
  const jamie = saved.patients.find(patient => patient.name === 'JAMİE STONE');
  expect(jamie).toBeDefined();
  expect(saved.waits).toEqual(expect.arrayContaining([
    { ...lab, status: 'Resolved', endedOn: checked.date },
    expect.objectContaining({ id: 'test-lab-fit', status: 'Resolved', endedOn: checked.date }),
    { ...lab, id: 'test-lab-retainer', patientId: 'demo-ada', title: 'Retainer' },
    expect.objectContaining({ patientId: 'demo-nora', type: 'Laboratory return', status: 'Resolved', endedOn: checked.date }),
    expect.objectContaining({ patientId: jamie?.id, type: 'Laboratory return', status: 'Resolved', endedOn: checked.date }),
  ]));
  expect(saved.waits.filter(wait => wait.patientId === 'demo-nora')).toHaveLength(1);

  await page.reload();
  await expect(page.getByText('Checked today', { exact: true })).toBeVisible();
  await expect(pending.getByText('Retainer')).toBeVisible();
  await page.getByRole('link', { name: 'Back', exact: true }).click();
  await expect(page).toHaveURL(/#\/work\?view=responses$/);
  await expect(shortcut).toContainText('Checked today');
  await page.getByRole('link', { name: 'Today', exact: true }).click();
  await expect(shortcut).toHaveCount(0);

  await page.clock.setFixedTime(new Date('2026-11-24T08:00:00+03:00'));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(shortcut).toBeVisible();
  await shortcut.click();
  await expect(page.getByText('Checked today', { exact: true })).toHaveCount(0);
  await expect(pending.getByText('Retainer')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Nothing arrived' })).toBeVisible();
});

test('Dismiss for today returns to the original Follow-ups view and persists through a reload', async ({ page }) => {
  await page.goto('/#/work?view=responses');
  const shortcut = page.getByRole('link', { name: /^Daily Laboratory Check/ });
  const filter = page.getByRole('combobox', { name: 'Status', exact: true });
  await filter.selectOption('Cancelled');
  await shortcut.click();
  await page.getByRole('button', { name: 'Dismiss for today' }).click();
  await expect(page).toHaveURL(/#\/work\?view=responses$/);
  await expect(filter).toHaveValue('Cancelled');
  await expect(shortcut).toContainText('Checked today');
  await page.reload();
  await expect(shortcut).toContainText('Checked today');
  await shortcut.click();
  await expect(page.getByText('Checked today', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Pending LabCheck tasks' })).toBeVisible();
  await page.getByRole('link', { name: 'Today', exact: true }).click();
  await expect(shortcut).toHaveCount(0);
});

test('the first availability shortcut and the prefilled visit skip the next hour', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-23T14:00:00+03:00'));
  await page.goto('/#/calendar');
  await page.getByRole('link', { name: 'New appointment' }).click();
  await expectBookingTime(page, '2026-11-23', '15:15–16:45');
  await page.clock.setFixedTime(new Date('2026-11-23T15:00:00+03:00'));
  const picker = await openTimePicker(page);
  await picker.getByRole('button', { name: /^First availability/ }).click();
  await expect(picker.getByRole('button', { name: 'Use this time' })).toBeEnabled();
  await picker.getByRole('button', { name: 'Use this time' }).click();
  await expectBookingTime(page, '2026-11-24', '09:00–10:30');

  await page.goto('/#/calendar');
  await page.getByRole('link', { name: 'New appointment' }).click();
  const summary = page.locator('#booking-slot-summary');
  await expect(summary.locator('time')).toHaveAttribute('datetime', '2026-11-23');
  await expect(summary).toContainText('No time selected');
  await expect(page.getByRole('button', { name: 'Book visit' })).toBeDisabled();
});

test('previous and next slot browse open times and count remaining slots on the selected date', async ({ page }) => {
  await page.goto('/#/calendar');
  await page.getByRole('link', { name: 'New appointment' }).click();
  await page.getByRole('button', { name: '60 min', exact: true }).click();
  await expectBookingTime(page, '2026-11-23', '11:00–12:00');
  const next = page.getByRole('button', { name: /^Next slot/ });
  await expect(next).toHaveAccessibleName('Next slot, 3 available');
  await next.click();
  await expectBookingTime(page, '2026-11-23', '13:00–14:00');
  await expect(next).toHaveAccessibleName('Next slot, 2 available');
  await next.click();
  await expectBookingTime(page, '2026-11-23', '14:55–15:55');
  await expect(next).toHaveAccessibleName('Next slot, 1 available');
  await next.click();
  await expectBookingTime(page, '2026-11-23', '16:00–17:00');
  await expect(next).toHaveAccessibleName('Next slot, 0 available');
  await expect(next).toBeDisabled();

  const picker = await openTimePicker(page);
  await picker.getByRole('button', { name: /Next week/ }).click();
  await picker.getByRole('button', { name: 'Close time picker' }).click();
  await expectBookingTime(page, '2026-11-23', '16:00–17:00');
});

test('split working hours offer first, last and buffered middle appointment blocks', async ({ page }) => {
  const now = new Date('2026-11-23T07:00:00+03:00');
  const date = '2026-11-23';
  const records = fictionalRecords(now);
  records.appointments = [];
  records.hoursOverrides.push({ date, windows: [{ start: '08:30', end: '11:40' }, { start: '13:00', end: '17:00' }] });
  await page.clock.setFixedTime(now);
  await page.addInitScript(data => localStorage.setItem('akisync-fictional-preview-v1', JSON.stringify(data)), records);
  await page.goto('/#/appointments/new?from=today');
  await expectBookingTime(page, date, '08:30–10:00');

  const picker = await openTimePicker(page);
  const blocks = picker.getByRole('region', { name: /Available blocks on/ });
  const options = ['First slot 08:30–10:00', 'Last slot 15:30–17:00', 'Middle slot 13:30–15:00', 'Middle slot 10:10–11:40'];
  await expect(blocks.getByRole('button')).toHaveCount(options.length);
  for (const [index, name] of options.entries()) await expect(blocks.getByRole('button').nth(index)).toHaveAccessibleName(name);
  await blocks.getByRole('button', { name: 'Middle slot 10:10–11:40' }).click();
  await picker.getByRole('button', { name: 'Use this time' }).click();
  await expectBookingTime(page, date, '10:10–11:40');
  await page.getByRole('button', { name: /^Previous slot/ }).click();
  await expectBookingTime(page, date, '08:30–10:00');
});

test.describe('calendar touch navigation', () => {
  test.use({ hasTouch: true });

  for (const view of ['3 days', 'Weekly view'] as const) {
    test(`a hold and drag in ${view} fills the selected day and time`, async ({ page }) => {
      const date = '2026-11-24';
      await page.goto('/#/calendar?date=' + date);
      await calendarLayout(page).selectOption({ label: view });
      const grid = await page.locator(`[data-date="${date}"] .calendar-column-times`).boundingBox();
      const hour = await page.locator('.calendar-time-rail span').first().boundingBox();
      if (!grid || !hour) throw new Error('The calendar grid is unavailable.');
      const x = grid.x + grid.width / 2;
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart', touchPoints: [{ x, y: grid.y + 1.4 * hour.height }],
      });
      await expect(page.locator('.calendar-selected-range')).toBeVisible();
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove', touchPoints: [{ x, y: grid.y + 3 * hour.height }],
      });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      const actions = page.getByRole('dialog', { name: '09:15–11:00' });
      await expect(actions).toBeVisible();

      if (view === 'Weekly view') {
        await actions.getByRole('link', { name: 'Close for appointments' }).click();
        await expect(page.getByLabel('Date', { exact: true })).toHaveValue(date);
        await expect(page.getByLabel('Start time')).toHaveValue('09:15');
        await expect(page.getByLabel('End time')).toHaveValue('11:00');
      } else {
        await actions.getByRole('link', { name: 'New appointment' }).click();
        await expectBookingTime(page, date, '09:15–11:00');
        await chooseBookingPatient(page, 'ADA KESTREL');
        await expect(page.getByLabel('Visit title (optional)')).toHaveValue('');
        await page.getByRole('button', { name: 'Book visit' }).click();
        await expect(page.getByRole('heading', { name: 'Appointment', exact: true })).toBeVisible();
      }
    });
  }

  test('a quick swipe pages each calendar layout without opening the range menu', async ({ page }) => {
    await page.goto('/#/calendar?date=2026-11-24');
    const cdp = await page.context().newCDPSession(page);
    for (const view of ['Daily', '3 days', 'Weekly view', 'Monthly']) {
      await calendarLayout(page).selectOption({ label: view });
      for (const direction of ['Next', 'Previous']) {
        const arrow = page.locator('.calendar-controls').getByRole('link', { name: new RegExp('^' + direction) });
        const destination = await arrow.getAttribute('href');
        const grid = await page.locator('.calendar-gesture-area').boundingBox();
        if (!grid || !destination) throw new Error('The calendar navigation is unavailable.');
        const start = grid.x + grid.width * (direction === 'Next' ? 0.75 : 0.25);
        const end = grid.x + grid.width * (direction === 'Next' ? 0.25 : 0.75);
        const y = grid.y + 80;
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: start, y }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: end, y }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await expect(page).toHaveURL(new RegExp(destination.replace(/[?]/g, '\\?') + '$'));
        const targetDate = new URLSearchParams(destination.split('?')[1]).get('date')!;
        await expect(page.locator('#calendar-action-date time')).toHaveAttribute('datetime', targetDate);
        await expect(page.locator('.calendar-range-actions')).not.toBeVisible();
      }
    }
  });
});

test('completing a visit offers booking for the newly eligible patient', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-23T10:00:00+03:00'));
  const shortcut = page.getByRole('link', { name: /Awaiting appointment outcomes/ });
  await page.goto('/#/today');
  await expect(shortcut.locator('.outcome-shortcut-count')).toHaveText('1');
  await page.goto('/#/attention');
  await shortcut.click();
  const visit = page.getByRole('link', { name: /MİRA ARDEN Restoration review/ });
  await expect(page.getByRole('heading', { name: 'Awaiting appointment outcomes' })).toBeVisible();
  await visit.click();
  await page.getByRole('button', { name: 'Completed', exact: true }).click();
  const offer = page.getByRole('dialog', { name: 'Ready to book' });
  await expect(offer).toContainText('MİRA ARDEN');
  await offer.getByRole('button', { name: 'Book visit' }).click();
  await expect(page.getByRole('button', { name: 'Patient MİRA ARDEN' })).toBeVisible();
  await page.getByRole('link', { name: 'Back', exact: true }).click();
  await expect(page.locator('.row-heading .pill')).toHaveText('Completed');
  await page.getByRole('link', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Awaiting appointment outcomes' })).toBeVisible();
  await expect(visit).toHaveCount(0);
  await page.getByRole('link', { name: 'Today', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await expect(shortcut).toHaveCount(0);
});

test('the outcome disclosure supports early completion and guards a future date', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-23T11:00:00+03:00'));
  const outcome = page.locator('details.visit-outcome-panel');

  await page.goto('/#/appointments/demo-1?from=today');
  await expect(outcome).toHaveJSProperty('open', true);

  await page.goto('/#/appointments/demo-3?from=today');
  await expect(outcome).toHaveJSProperty('open', false);
  await outcome.locator('summary').click();
  await outcome.getByRole('link', { name: 'Complete and add follow-up' }).click();
  await expect(page.getByRole('radio', { name: 'Laboratory' })).toBeChecked();
  await page.getByRole('button', { name: 'Complete and save follow-up' }).click();
  await expect(page.locator('.row-heading .pill')).toHaveText('Completed');

  await page.goto('/#/appointments/demo-4?from=today');
  await expect(outcome).toHaveJSProperty('open', false);
  await outcome.locator('summary').click();
  const confirmation = page.getByRole('dialog', { name: 'Did the visit take place today?' });
  await outcome.getByRole('button', { name: 'Complete and add follow-up' }).click();
  await expect(confirmation).toContainText('Scheduled appointment');
  await confirmation.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('.row-heading .pill')).toHaveText('Scheduled');
  await outcome.getByRole('button', { name: 'Completed', exact: true }).click();
  await confirmation.getByRole('button', { name: 'Yes, it took place today' }).click();
  await expect(page.locator('.row-heading .pill')).toHaveText('Completed');
});

test('outcome filters, appointment details and confirmed deletion preserve linked encounter notes', async ({ page }) => {
  const now = new Date('2026-11-23T11:00:00+03:00');
  await page.clock.setFixedTime(now);
  const records = fictionalRecords(now);
  const visit = records.appointments.find(item => item.id === 'demo-1')!;
  records.appointments.push({ ...visit, id: 'earlier-visit', date: '2026-11-22', title: 'Earlier appointment', notes: '' });
  records.notes.push({ ...records.notes[0], id: 'linked-note', date: visit.date, appointmentId: visit.id,
    title: 'Retained encounter note', body: 'Keep this note on the patient record.' });
  await page.addInitScript(data => {
    const key = 'akisync-fictional-preview-v1';
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(data));
  }, records);
  await page.goto('/#/today');

  const agenda = page.locator('.today-agenda');
  const mira = agenda.getByRole('link', { name: /MİRA ARDEN.*Outcome pending/ });
  await expect(mira).toBeVisible();
  await expect(agenda.getByRole('link', { name: /NORA VALE.*Scheduled/ })).toBeVisible();
  await mira.click();
  await expect(page.getByRole('heading', { name: 'Restoration review' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Edit appointment' })).toBeVisible();

  const confirmation = page.getByRole('dialog', { name: 'Delete this appointment?' });
  await page.getByRole('button', { name: 'Delete appointment', exact: true }).click();
  await expect(confirmation).toContainText('MİRA ARDEN');
  await expect(confirmation).toContainText('Linked encounter notes will stay in the patient record.');
  await expect(confirmation.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await confirmation.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('link', { name: 'Back', exact: true }).click();
  await expect(mira).toBeVisible();

  await page.getByRole('link', { name: /Awaiting appointment outcomes/ }).click();
  const queue = page.getByRole('group', { name: 'Filter appointments by date' });
  const today = queue.getByRole('button', { name: /^Today / });
  await queue.getByRole('button', { name: /^Earlier / }).click();
  await expect(page.getByRole('link', { name: /Earlier appointment/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Routine examination/ })).toHaveCount(0);
  await today.click();
  const eli = page.getByRole('link', { name: /ELİ DEMİR.*Routine examination/ });
  const eliRow = page.locator('.outcome-row').filter({ has: eli });
  await expect(eliRow.getByRole('link')).toHaveCount(1);
  await expect(eliRow.getByRole('button')).toHaveCount(0);
  const detailUrl = /#\/appointments\/demo-2\?from=appointment-outcomes$/;
  await eli.getByText('Record outcome', { exact: true }).click();
  await expect(page).toHaveURL(detailUrl);
  await expect(page.getByRole('heading', { name: 'Routine examination' })).toBeVisible();
  await page.getByRole('link', { name: 'Back', exact: true }).click();
  await expect(today).toHaveAttribute('aria-pressed', 'true');
  await eli.getByText('ELİ DEMİR', { exact: true }).click();
  await expect(page).toHaveURL(detailUrl);
  await page.getByRole('button', { name: 'Other outcomes' }).click();
  await page.getByRole('dialog', { name: 'Other outcomes' }).getByRole('button', { name: 'No-show', exact: true }).click();
  await expect(page.locator('.row-heading .pill')).toHaveText('No-show');
  await page.getByRole('link', { name: 'Back', exact: true }).click();
  await expect(today).toHaveAttribute('aria-pressed', 'true');
  await expect(eli).toHaveCount(0);

  await page.getByRole('link', { name: /MİRA ARDEN Restoration review/ }).click();
  await page.getByRole('button', { name: 'Delete appointment', exact: true }).click();
  await confirmation.getByRole('button', { name: 'Delete appointment', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Awaiting appointment outcomes' })).toBeVisible();
  await expect(today).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('No outcomes pending today.')).toBeVisible();
  await expect(page.getByText('Appointment deleted.')).toBeVisible();

  await page.goto('/#/today');
  await expect(agenda.getByRole('link', { name: /MİRA ARDEN/ })).toHaveCount(0);
  await expect(agenda.getByRole('link', { name: /ELİ DEMİR.*No-show/ })).toBeVisible();
  await page.goto('/#/patients/demo-mira');
  await expect(page.getByRole('link', { name: /Latex allergy.*Critical/ })).toBeVisible();
  await page.getByRole('tab', { name: 'History', exact: true }).click();
  const note = page.getByRole('article').filter({ hasText: 'Retained encounter note' });
  await expect(note).toBeVisible();
  await page.reload();
  await note.locator('summary').click();
  await note.getByRole('link', { name: 'Edit' }).click();
  await expect(page.getByRole('textbox', { name: 'Note', exact: true })).toHaveValue('Keep this note on the patient record.');
  await page.getByText('Note details', { exact: true }).click();
  await expect(page.getByLabel('Appointment (optional)')).toHaveValue('');
});

test('completing a visit with a lab follow-up saves both records together', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-23T09:15:00+03:00'));
  await page.goto('/#/appointments/demo-1');
  const completeWithFollowUp = page.getByRole('link', { name: 'Complete and add follow-up' });
  await expect(completeWithFollowUp).toBeVisible();
  await completeWithFollowUp.click();
  await page.getByRole('link', { name: 'Back', exact: true }).click();
  await expect(page.getByText('Scheduled', { exact: true })).toBeVisible();
  await completeWithFollowUp.click();
  await page.getByRole('radio', { name: 'Laboratory' }).check();
  await expect(page.getByRole('switch', { name: /Block booking/ })).toBeChecked();
  await page.getByRole('button', { name: 'Complete and save follow-up' }).click();
  await expect(page.locator('.row-heading .pill')).toHaveText('Completed');
  await expect(page.getByRole('dialog', { name: 'Ready to book' })).toHaveCount(0);
  await page.getByRole('link', { name: 'MİRA ARDEN', exact: true }).click();
  await openPatientGroup(page, 'Follow-ups');
  await expect(page.getByRole('link', { name: /^Lab check/ })).toBeVisible();
});

test('resolving a blocking wait makes a patient with zero treatments eligible', async ({ page }) => {
  await page.goto('/#/planning');
  await expect(page.getByRole('link', { name: /^ADA KESTREL/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /^JONAH LAKE/ })).toHaveCount(0);
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Work' }).click();
  await expect(page.getByRole('heading', { name: 'Tasks' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Follow-ups' })).toBeVisible();
  await page.getByRole('link', { name: 'Follow-ups' }).click();
  await page.getByRole('link', { name: 'Confirm availability' }).click();
  await expect(page.getByRole('heading', { name: 'Confirm availability' })).toBeVisible();
  await expect(page.getByText('Blocks booking', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Waiting', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Completed', exact: true }).click();
  await dismissBookingOffer(page, 'JONAH LAKE');
  await page.getByRole('link', { name: 'Back', exact: true }).click();
  await expect(page).toHaveURL(/#\/work\?view=responses$/);
  await expect(page.getByRole('heading', { name: 'Follow-ups' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Status', exact: true }).selectOption('Resolved');
  await expect(page.getByText('Confirm availability')).toBeVisible();
  await page.getByRole('navigation').getByRole('link', { name: 'Planning' }).click();
  await page.getByRole('link', { name: /^JONAH LAKE/ }).click();
  await openPatientGroup(page, 'Treatments');
  await expect(page.getByText('No treatments recorded.')).toBeVisible();
  await page.getByRole('link', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Planning', exact: true })).toBeVisible();
});

test('a lab check tracks a patient’s laboratory return and releases the booking hold when resolved', async ({ page }) => {
  const records = fictionalRecords(new Date('2026-11-23T08:00:00+03:00'));
  records.tasks.push({ id: 'prior-blocker', patientId: 'demo-ada', title: 'Confirm visit details', notes: '',
    completedOn: '2026-11-23', blocks: true });
  await page.addInitScript(data => {
    const key = 'akisync-fictional-preview-v1';
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(data));
  }, records);
  const main = page.getByRole('navigation', { name: 'Main navigation' });
  await page.goto('/#/patients/demo-ada');
  await openPatientGroup(page, 'Follow-ups');
  await page.getByRole('link', { name: 'Add lab check' }).click();
  await expect(page.getByRole('heading', { name: 'Add lab check' })).toBeVisible();
  await expect(page.getByLabel('Title (optional)')).toHaveAttribute('placeholder', 'Lab check');
  await expect(page.getByRole('radio', { name: 'Laboratory' })).toBeChecked();
  await expect(page.getByRole('switch', { name: /Block booking/ })).toBeChecked();
  await page.getByText('Details', { exact: true }).click();
  await expect(page.getByLabel('Review date (optional)')).toHaveValue('');
  await page.getByLabel('Notes (optional)').fill('Follow up on the impressions sent to the lab.');
  await page.getByRole('button', { name: 'Save follow-up' }).click();
  await expect(page.getByRole('link', { name: /^Lab check/ })).toBeVisible();

  await main.getByRole('link', { name: 'Planning' }).click();
  await expect(page.getByRole('heading', { name: 'Planning' })).toBeVisible();
  await expect(page.getByRole('link', { name: /^ADA KESTREL/ })).toHaveCount(0);
  await main.getByRole('link', { name: 'Today' }).click();
  await page.reload();
  const attention = page.getByRole('link', { name: /Need attention/ });
  await expect(attention.getByText('0', { exact: true })).toBeVisible();
  const todayFollowUps = page.locator('details.today-follow-ups');
  await expect(todayFollowUps).not.toHaveAttribute('open', '');
  await todayFollowUps.locator('summary').click();
  await expect(todayFollowUps.getByRole('button', { name: 'Resolve lab follow-up for ADA KESTREL' })).toBeVisible();
  await attention.click();
  const labCheck = page.getByRole('link', { name: 'Lab follow-up for ADA KESTREL' });
  await labCheck.click();
  await expect(page.getByText('Follow up on the impressions sent to the lab.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit field Notes' }).click();
  await page.getByRole('textbox', { name: 'Notes', exact: true }).fill('Check if the lab has the impressions.');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Check if the lab has the impressions.', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Resolve lab follow-up for ADA KESTREL' }).click();
  await dismissBookingOffer(page, 'ADA KESTREL');
  await expect(page.getByRole('heading', { name: 'Needs attention', exact: true })).toBeVisible();
  await expect(labCheck).toHaveCount(0);
  await main.getByRole('link', { name: 'Planning' }).click();
  const ada = page.getByRole('link', { name: /^ADA KESTREL/ });
  const labFilter = page.getByRole('button', { name: 'Patients with work returned from lab' });
  await expect(ada).toBeVisible();
  await expect(labFilter).toHaveAttribute('aria-pressed', 'false');
  await labFilter.click();
  await expect(labFilter).toHaveAttribute('aria-pressed', 'true');
  const ready = page.getByRole('region', { name: 'Ready to book', exact: true });
  await expect(ready.getByRole('link', { name: /^ADA KESTREL/ })).toBeVisible();
  await page.reload();
  await expect(labFilter).toHaveAttribute('aria-pressed', 'true');
  await expect(ada).toBeVisible();
  await labFilter.click();
  await expect(labFilter).toHaveAttribute('aria-pressed', 'false');
});

test('open tasks drive the attention count and patient task holds follow completion', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-23T11:00:00+03:00'));
  const main = page.getByRole('navigation', { name: 'Main navigation' });
  const taskName = 'Receive implant components';
  const blocksTask = page.getByRole('switch', { name: /Block booking/ });
  const patientInPlanning = page.getByRole('link', { name: /^ADA KESTREL/ });
  const planningHeading = page.getByRole('heading', { name: 'Planning' });
  await page.goto('/#/patients/demo-ada');
  await openPatientGroup(page, 'Tasks');
  await page.getByRole('link', { name: 'Add task' }).click();
  await expect(page.getByText('ADA KESTREL', { exact: true })).toBeVisible();
  await page.getByLabel('Title').fill(taskName);
  await expect(page.getByLabel('Due date', { exact: false })).toHaveCount(0);
  await expect(blocksTask).toBeChecked();
  await page.locator('.task-form summary').click();
  await page.getByRole('textbox', { name: 'Notes (optional)' }).fill('Keep the patient on hold until the parts arrive.');
  await page.getByRole('button', { name: 'Save task' }).click();
  await expect(page.getByRole('heading', { name: 'ADA KESTREL' })).toBeVisible();
  await expect(page.getByRole('link', { name: taskName })).toBeVisible();
  await page.getByRole('link', { name: 'New appointment' }).click();
  await expect(page.getByText(`Booking is blocked by: ${taskName}.`)).toBeVisible();
  await expect(page.getByLabel('Blocking tasks exception reason')).toBeVisible();
  await page.getByRole('link', { name: 'Back', exact: true }).click();
  await main.getByRole('link', { name: 'Planning' }).click();
  await expect(planningHeading).toBeVisible();
  await expect(patientInPlanning).toHaveCount(0);

  await main.getByRole('link', { name: 'Work' }).click();
  await page.getByRole('link', { name: 'Add task' }).click();
  await expect(page.getByRole('radio', { name: 'General clinic' })).toBeChecked();
  await expect(blocksTask).toHaveCount(0);
  await page.getByLabel('Title').fill('Order general clinic supplies');
  await page.getByRole('button', { name: 'Save task' }).click();
  await expect(page.getByRole('link', { name: 'Order general clinic supplies' })).toBeVisible();
  await expect(page.getByText('General clinic', { exact: true })).toBeVisible();

  await page.getByRole('link', { name: 'Add task' }).click();
  await page.getByLabel('Title').fill('Call implant supplier');
  await page.getByRole('radio', { name: 'Patient task' }).check();
  const patientSearch = page.getByRole('searchbox', { name: 'Search patients' });
  await expect(page.locator('.patient-search-row')).toHaveCount(0);
  await patientSearch.fill('Kestrel');
  await page.getByRole('button', { name: /ADA KESTREL/ }).click();
  await expect(page.getByLabel('Title')).toHaveValue('Call implant supplier');
  await expect(blocksTask).toBeChecked();
  await blocksTask.uncheck();
  await page.getByRole('button', { name: 'Save task' }).click();

  await page.getByRole('link', { name: 'Add follow-up' }).click();
  await expect(page.locator('.patient-search-row')).toHaveCount(0);
  await patientSearch.fill('Kestrel');
  await page.getByRole('link', { name: /ADA KESTREL/ }).click();
  await page.getByLabel('Title').fill('Waiting for supplier confirmation');
  await page.getByRole('radio', { name: 'Other' }).check();
  await page.getByText('Details', { exact: true }).click();
  await expect(page.getByLabel('Review date (optional)')).toHaveValue('');
  await blocksTask.uncheck();
  await page.getByRole('button', { name: 'Save follow-up' }).click();
  await expect(page.getByRole('heading', { name: 'Work', exact: true })).toBeVisible();
  if (process.env.AKISYNC_TEST_SCREENSHOTS) {
    await page.screenshot({ path: '/tmp/akisync-work-mobile.png', fullPage: true });
  }

  await main.getByRole('link', { name: 'Today' }).click();
  const attention = page.getByRole('link', { name: /Need attention/ });
  await expect(attention.getByText('3', { exact: true })).toBeVisible();
  await expect(page.locator('.today-tasks').getByRole('link', { name: /ADA KESTREL.*Receive implant components/ }))
    .toHaveAttribute('href', '#/patients/demo-ada');
  await attention.click();
  await expect(page.getByRole('heading', { name: 'Open tasks' })).toBeVisible();
  await page.getByRole('link', { name: /Awaiting appointment outcomes/ }).click();
  await expect(page.getByRole('link', { name: 'Routine examination' })).toBeVisible();
  await page.getByRole('link', { name: 'Needs attention', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Confirm availability' })).toBeVisible();
  await page.getByRole('link', { name: 'Waiting for supplier confirmation' }).click();
  await expect(page.getByText('Blocks booking', { exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'Back' }).click();
  await expect(page.getByRole('heading', { name: 'Needs attention' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Order general clinic supplies' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Call implant supplier' })).toBeVisible();
  await page.getByRole('link', { name: taskName }).click();
  await expect(page.getByRole('heading', { name: taskName })).toBeVisible();
  await expect(page.getByText('Keep the patient on hold until the parts arrive.', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Edit', exact: true }).click();
  await expect(page.locator('.mobile-form-patient')).toContainText('ADA KESTREL');
  await page.locator('.task-form summary').click();
  await expect(page.getByRole('textbox', { name: 'Notes (optional)' })).toHaveValue('Keep the patient on hold until the parts arrive.');
  await expect(blocksTask).toBeChecked();
  await page.getByRole('link', { name: 'Back' }).click();
  await page.getByRole('link', { name: 'Back' }).click();
  await page.getByRole('button', { name: 'Complete ' + taskName }).click();
  await dismissBookingOffer(page, 'ADA KESTREL');
  await expect(page.getByRole('link', { name: taskName })).toHaveCount(0);
  await main.getByRole('link', { name: 'Today' }).click();
  await expect(attention.getByText('2', { exact: true })).toBeVisible();
  await main.getByRole('link', { name: 'Planning' }).click();
  await expect(planningHeading).toBeVisible();
  await expect(patientInPlanning).toBeVisible();

  await main.getByRole('link', { name: 'Work' }).click();
  await page.getByRole('navigation', { name: 'Work views' }).getByRole('link', { name: 'Tasks', exact: true }).click();
  await page.reload();
  await page.getByText('Completed tasks (1)').click();
  await page.getByRole('button', { name: 'Reopen ' + taskName }).click();
  await expect(page.getByRole('link', { name: taskName })).toBeVisible();
  await expect(page.getByRole('listitem').filter({ has: page.getByRole('link', { name: taskName }) })
    .getByRole('img', { name: 'Blocks booking' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  for (const viewport of [{ width: 812, height: 375 }, { width: 1370, height: 900 }]) {
    await page.setViewportSize(viewport);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
  }
  await main.getByRole('link', { name: 'Planning' }).click();
  await expect(planningHeading).toBeVisible();
  await expect(patientInPlanning).toHaveCount(0);
});

test('agenda layout fits desktop and narrow screens in both orientations', async ({ page }) => {
  for (const viewport of [{ width: 375, height: 812 }, { width: 812, height: 375 }, { width: 1370, height: 900 }]) {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Today’s agenda' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'New appointment' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    if (process.env.AKISYNC_TEST_SCREENSHOTS) {
      await page.screenshot({ path: `/tmp/akisync-today-${viewport.width}.png`, fullPage: true });
    }
  }
});

test('the working-days filter keeps off-day patient visits and follows schedule changes by date', async ({ page }) => {
  const records = fictionalRecords(new Date('2026-11-23T08:00:00+03:00'));
  records.workingHours = records.workingHours.filter(hours => [1, 2, 4].includes(hours.day));
  records.appointments = records.appointments.map(item => item.id === 'demo-4' ? { ...item, status: 'Cancelled' } : item);
  records.hoursOverrides = [
    { date: '2026-12-02', windows: [{ start: '10:00', end: '15:00' }] },
    { date: '2026-12-03', windows: [] },
  ];
  records.timeOff = [
    { id: 'friday-off', title: 'Friday leave', from: '2026-11-27', through: '2026-11-27', hours: null },
    { id: 'tuesday-off', title: 'Tuesday leave', from: '2026-12-01', through: '2026-12-01', hours: null },
    { id: 'week-off', title: 'Clinic closed', from: '2026-12-07', through: '2026-12-13', hours: null },
  ];
  await page.addInitScript(data => {
    if (!localStorage.getItem('akisync-fictional-preview-v1')) localStorage.setItem('akisync-fictional-preview-v1', JSON.stringify(data));
  }, records);
  await page.setViewportSize({ width: 384, height: 832 });
  await page.goto('/#/calendar');
  await calendarLayout(page).selectOption('week');
  const days = page.locator('.calendar-column-day');
  const viewOptions = page.getByLabel('Calendar view options');
  const workingDays = page.getByRole('checkbox', { name: 'Working days only' });
  await expect(days).toHaveCount(7);
  await viewOptions.click();
  await workingDays.check();
  await expect(days).toHaveCount(4);
  expect(await days.evaluateAll(links => links.map(link => link.getAttribute('href')))).toEqual(
    ['23', '24', '26', '27'].map(day => '#/calendar?date=2026-11-' + day),
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(384);
  await page.getByRole('heading', { name: 'Calendar', exact: true }).click();
  await expect(workingDays).toBeHidden();
  await viewOptions.click();
  await page.getByRole('button', { name: /^Choose date in/ }).focus();
  await expect(workingDays).toBeHidden();
  await viewOptions.click();
  await page.keyboard.press('Escape');
  await expect(workingDays).toBeHidden();
  await expect(viewOptions).toBeFocused();
  await days.getByText('27').click();
  await page.locator('.calendar-column[data-date="2026-11-27"]').getByRole('button', { name: /NORA VALE/ }).click();
  await expect(page.getByRole('region', { name: 'Appointment details' })).toContainText('Restoration review');
  await page.reload();
  await expect(days).toHaveCount(4);
  await viewOptions.click();
  await expect(workingDays).toBeChecked();
  await viewOptions.click();

  await page.getByRole('link', { name: 'Next week' }).click();
  await expect(page).toHaveURL(/date=2026-12-02$/);
  await expect(days).toHaveCount(2);
  expect(await days.evaluateAll(links => links.map(link => link.getAttribute('href')))).toEqual(
    ['#/calendar?date=2026-11-30', '#/calendar?date=2026-12-02'],
  );
  await page.getByRole('link', { name: 'Next week' }).click();
  await expect(page.getByText('No working days or patient appointments this week.')).toBeVisible();
  await viewOptions.click();
  await workingDays.uncheck();
  await expect(days).toHaveCount(7);

  await page.goto('/#/calendar?date=2026-11-24');
  await calendarLayout(page).selectOption('three');
  await viewOptions.click();
  await workingDays.check();
  await expect(days).toHaveCount(3);
  expect(await days.evaluateAll(links => links.map(link => new URL((link as HTMLAnchorElement).href).hash.split('&')[0]))).toEqual(
    ['24', '26', '27'].map(day => '#/calendar?date=2026-11-' + day),
  );
});

test('the working-days filter shows every day for a seven-day clinic', async ({ page }) => {
  const records = fictionalRecords(new Date('2026-11-23T08:00:00+03:00'));
  records.workingHours = Array.from({ length: 7 }, (_, day) => ({ day, start: '09:00', end: '17:00' }));
  await page.addInitScript(data => localStorage.setItem('akisync-fictional-preview-v1', JSON.stringify(data)), records);
  await page.goto('/#/calendar');
  await calendarLayout(page).selectOption('week');
  await page.getByLabel('Calendar view options').click();
  await page.getByRole('checkbox', { name: 'Working days only' }).check();
  await expect(page.locator('.calendar-column-day')).toHaveCount(7);
});

test('opens the calendar in the three-day timeline and switches between calendar views', async ({ page }) => {
  await page.setViewportSize({ width: 384, height: 832 });
  await page.goto('/#/calendar');
  const columns = page.locator('.calendar-column');
  const layout = calendarLayout(page);
  await expect(layout).toHaveValue('three');
  await expect(layout.locator('option')).toHaveText(['Daily', '3 days', 'Weekly view', 'Monthly']);
  await expect(columns).toHaveCount(3);
  await expect(columns.first()).toHaveAttribute('data-date', '2026-11-23');
  await page.getByRole('button', { name: /MİRA ARDEN.*09:00/ }).click();
  const details = page.getByRole('region', { name: 'Appointment details' });
  await expect(details).toContainText('Restoration review');
  await expect(details.getByRole('link', { name: 'Open appointment' })).toHaveAttribute('href', '#/appointments/demo-1?from=calendar');
  await details.getByRole('button', { name: 'Close' }).click();
  await expect(details).toHaveCount(0);
  await columns.nth(1).getByRole('link', { name: /November 24/ }).click();
  await expect(columns.first()).toHaveAttribute('data-date', '2026-11-23');
  await expect(page.locator('.calendar-column-day[aria-current="date"]')).toHaveAccessibleName('Tuesday, November 24');
  const bookingActions = page.getByRole('group', { name: 'Appointment actions' });
  const newAppointment = bookingActions.getByRole('link', { name: 'New appointment' });
  await expect(bookingActions).toHaveAccessibleDescription(/Selected date.*Nov 24/);
  await expect(newAppointment).toHaveText('');
  await expect(newAppointment).toHaveAttribute('href', /date=2026-11-24/);
  await expect(bookingActions.getByRole('link', { name: 'Close for appointments' })).toHaveAttribute('href', /date=2026-11-24.*kind=block/);
  await newAppointment.click();
  await expectBookingTime(page, '2026-11-24', '09:00–10:30');
  await page.getByRole('link', { name: 'Back', exact: true }).click();
  await layout.selectOption('week');
  await expect(columns).toHaveCount(7);
  await layout.selectOption('month');
  await expect(page.locator('.calendar-month-panel .calendar-month-day')).toHaveCount(42);
  await page.locator('.calendar-month-panel').getByRole('link', { name: /November 27/ }).click();
  await expect(layout).toHaveValue('day');
  await expect(columns).toHaveCount(1);
  await expect(columns.first()).toHaveAttribute('data-date', '2026-11-27');
  await expect(page.getByRole('heading', { name: 'Upcoming visits' })).toHaveCount(0);
  await page.reload();
  await expect(layout).toHaveValue('day');
  await page.getByRole('link', { name: 'Availability' }).click();
  await expect(page.getByRole('link', { name: 'Close for appointments' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Back', exact: true }).click();
  await page.getByRole('link', { name: 'Close for appointments' }).click();
  await expect(page.getByLabel('Date', { exact: true })).toHaveValue('2026-11-27');
  await expect(page.getByText('Appointments cannot be added during this time range.')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(384);
});

test('records a clinical alert, edits working hours and uses time off in the calendar', async ({ page }) => {
  await page.goto('/#/patients/demo-eli');
  await openPatientGroup(page, 'Clinical alerts');
  await page.getByRole('link', { name: 'Add alert' }).click();
  await page.getByLabel('Alert label').fill('Fictional medication caution');
  await page.getByLabel('Alert type').selectOption('Medication');
  await page.getByLabel('Severity').selectOption('Caution');
  await page.getByLabel('Notes').fill('Fictional note for preparation.');
  await page.getByRole('button', { name: 'Save alert' }).click();
  await expect(page.getByText('Fictional note for preparation.')).toBeVisible();
  await page.getByRole('navigation').getByRole('link', { name: 'Today' }).click();
  await expect(page.getByText('Caution: Fictional medication caution')).toBeVisible();

  await page.getByRole('navigation').getByRole('link', { name: 'Calendar' }).click();
  await page.getByRole('link', { name: 'Availability' }).click();
  const monday = page.getByRole('group', { name: 'Monday', exact: true });
  await monday.getByLabel('From').fill('08:30');
  await page.getByRole('button', { name: 'Save working hours' }).click();
  await expect(page.getByText('Working hours saved.')).toBeVisible();
  await page.getByRole('button', { name: 'Add time off' }).click();
  await page.getByLabel('Title').fill('Fictional clinic leave');
  await page.getByLabel('Set a time range for each day').check();
  await page.getByLabel('Time off starts').fill('15:00');
  await page.getByLabel('Time off ends').fill('16:00');
  await page.getByRole('button', { name: 'Save time off' }).click();
  await page.getByRole('navigation').getByRole('link', { name: 'Calendar' }).click();
  await expect(page.getByRole('link', { name: /Fictional clinic leave/ })).toBeVisible();
  await page.getByRole('link', { name: 'Close for appointments' }).click();
  await page.getByLabel('Title', { exact: true }).fill('Fictional cleanup');
  await page.getByLabel('Start time').fill('15:00');
  await page.getByLabel('End time').fill('15:30');
  await expect(page.getByText('Time off overlaps this slot: Fictional clinic leave.')).toBeVisible();
  await page.getByLabel('Working hours / time off exception reason').fill('Time off changed for cleanup.');
  await page.getByRole('button', { name: 'Save closure' }).click();
  await expect(page.getByRole('heading', { name: 'Fictional cleanup' })).toBeVisible();
  await expect(page.getByText('Blocked time', { exact: true })).toBeVisible();
});

test('deletes a patient only after confirmation and removes their visits from Today', async ({ page }) => {
  await page.goto('/#/patients/demo-mira/edit');
  await page.getByRole('link', { name: 'Delete patient' }).click();
  await page.getByRole('button', { name: 'Permanently delete patient' }).click();
  await expect(page.getByRole('heading', { name: 'Delete patient' })).toBeVisible();
  await page.getByRole('link', { name: 'Cancel', exact: true }).click();
  await expect(page.getByLabel('Full name')).toHaveValue('MİRA ARDEN');

  await page.getByRole('link', { name: 'Delete patient' }).click();
  await page.getByRole('checkbox', { name: 'Delete this patient and their linked records' }).check();
  await page.getByRole('button', { name: 'Permanently delete patient' }).click();
  await expect(page.getByRole('heading', { name: 'Patients', exact: true })).toBeVisible();
  await expect(page.getByText('MİRA ARDEN')).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('ELİ DEMİR')).toBeVisible();
  await page.getByRole('navigation').getByRole('link', { name: 'Today' }).click();
  await expect(page.getByText('MİRA ARDEN')).toHaveCount(0);
  await expect(page.getByText('Latex allergy', { exact: false })).toHaveCount(0);
  await expect(page.getByText('Lunch break')).toBeVisible();
});

test('sets common hours, overrides one date and moves or skips a recurring break from the agenda', async ({ page }) => {
  await page.goto('/#/availability');
  await page.getByText('Set the same hours for several weekdays').click();
  const bulk = page.locator('.availability-bulk');
  await bulk.getByLabel('From').fill('10:00');
  await bulk.getByLabel('Until').fill('18:00');
  for (const day of ['Monday', 'Wednesday', 'Friday']) await bulk.getByRole('checkbox', { name: day }).uncheck();
  await bulk.getByRole('button', { name: 'Save hours for selected days' }).click();
  await expect(page.getByRole('group', { name: 'Tuesday', exact: true }).getByLabel('From')).toHaveValue('10:00');
  await expect(page.getByRole('group', { name: 'Monday', exact: true }).getByLabel('From')).toHaveValue('09:00');

  const dateHours = page.getByRole('heading', { name: 'Hours for a specific date' }).locator('../..');
  await dateHours.getByRole('button', { name: 'Override a date' }).click();
  await dateHours.getByLabel('Date', { exact: true }).fill('2026-11-24');
  await dateHours.getByLabel('From').fill('13:00');
  await dateHours.getByLabel('Until').fill('15:00');
  await dateHours.getByRole('button', { name: 'Save date hours' }).click();
  await expect(dateHours.getByText('13:00–15:00')).toBeVisible();

  await page.getByRole('button', { name: 'Add break' }).click();
  await page.getByLabel('Break name').fill('Fictional clinic break');
  await page.getByLabel('Break starts').fill('09:30');
  await page.getByLabel('Break ends').fill('10:00');
  await page.getByRole('button', { name: 'Save break', exact: true }).click();
  await expect(page.getByText('1 scheduled visit overlaps a break')).toBeVisible();
  await page.getByRole('navigation').getByRole('link', { name: 'Today' }).click();
  await expect(page.getByText('1 scheduling conflict', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'View current conflicts' }).click();
  await page.getByRole('button', { name: 'Ignore Fictional clinic break for this appointment' }).click();
  await page.reload();
  await expect(page.getByText('No current scheduling conflicts.')).toBeVisible();
  await page.getByRole('link', { name: 'Ignored conflicts' }).click();
  await page.getByRole('button', { name: 'Restore warning for Fictional clinic break for this appointment' }).click();
  await expect(page.getByText('No ignored scheduling overlaps.')).toBeVisible();
  await page.getByRole('navigation').getByRole('link', { name: 'Calendar' }).click();
  await expect(page.getByRole('button', { name: /MİRA ARDEN.*Break conflict/ })).toBeVisible();
  await calendarLayout(page).selectOption('day');
  await page.getByRole('link', { name: 'Availability' }).click();

  await page.getByRole('button', { name: 'Add break' }).click();
  await page.getByLabel('Break name').fill('Fictional recurring lunch');
  await page.getByLabel('Repeat').selectOption('weekly');
  await page.getByRole('checkbox', { name: 'Monday' }).uncheck();
  await page.getByRole('checkbox', { name: 'Tuesday' }).check();
  await page.getByRole('checkbox', { name: 'Thursday' }).check();
  await page.getByRole('combobox', { name: 'Ends', exact: true }).selectOption('count');
  await page.getByLabel('Occurrences', { exact: true }).fill('2');
  await expect(page.getByText(/Occurrences: Tuesday, November 24.*Thursday, November 26/)).toBeVisible();
  await page.getByRole('button', { name: 'Save break', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Add break' })).toBeVisible();

  await page.goto('/#/calendar?date=2026-11-24');
  await expect(page.getByRole('link', { name: /Working hours for this date.*13:00–15:00/ })).toBeVisible();
  const lunch = page.getByRole('link', { name: /Fictional recurring lunch/ });
  await lunch.click();
  await page.getByLabel('New break date').fill('2026-11-25');
  await page.getByRole('button', { name: 'Save occurrence' }).click();
  await expect(page).toHaveURL(/#\/availability$/);
  await page.goto('/#/calendar?date=2026-11-24');
  await expect(lunch).toHaveCount(0);
  await page.goto('/#/calendar?date=2026-11-25');
  await expect(lunch).toBeVisible();
  await page.goto('/#/calendar?date=2026-11-26');
  await lunch.click();
  await page.getByLabel('Change this occurrence').selectOption('skip');
  await page.getByRole('button', { name: 'Save occurrence' }).click();
  await expect(page).toHaveURL(/#\/availability$/);
  await page.goto('/#/calendar?date=2026-11-26');
  await expect(lunch).toHaveCount(0);
  await page.goto('/#/calendar?date=2026-12-01');
  await expect(lunch).toHaveCount(0);
});
