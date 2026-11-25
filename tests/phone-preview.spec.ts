import { expect, test } from '@playwright/test';
import { fictionalRecords } from '../src/storage/fixtures';

test('the Galaxy S24 Ultra preview retains its viewport and route across resizes and reloads', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 901 });
  await page.goto('/preview/s24-ultra.html#/today');
  const phone = page.frameLocator('iframe');
  const assertPhoneViewport = async () => {
    const size = await phone.locator('html').evaluate(() => ({ width: innerWidth, height: innerHeight }));
    expect(size).toEqual({ width: 384, height: 832 });
  };

  await expect(phone.getByRole('heading', { name: 'Bugün', exact: true })).toBeVisible();
  await expect(phone.getByRole('link', { name: 'Yeni randevu' })).toHaveText('Yeni randevu');
  await assertPhoneViewport();
  await phone.getByRole('link', { name: 'Hastalar', exact: true }).click();
  await expect(page).toHaveURL(/#\/patients$/);

  await page.setViewportSize({ width: 360, height: 650 });
  await assertPhoneViewport();
  await page.reload();
  await expect(phone.getByRole('heading', { name: 'Hastalar', exact: true })).toBeVisible();
  await assertPhoneViewport();

  await phone.getByRole('link', { name: 'Takvim', exact: true }).click();
  const actions = phone.getByRole('group', { name: 'Randevu işlemleri' });
  await expect(actions.getByRole('link', { name: 'Yeni randevu' })).toHaveText('');
  const closure = actions.getByRole('link', { name: 'Randevuya kapat' });
  await expect(closure).toHaveText('');
  await expect(closure).toHaveClass(/secondary/);
  const [newAppointmentTop, closureTop] = await actions.evaluate(group => [...group.querySelectorAll('a')]
    .map(link => link.getBoundingClientRect().top));
  expect(newAppointmentTop).toBe(closureTop);
  await closure.click();
  await expect(phone.getByRole('heading', { name: 'Randevuya kapat', exact: true })).toBeVisible();
  await expect(phone.getByText('Bu saat aralığına randevu eklenemez.', { exact: true })).toBeVisible();
});

test('the Daily Lab mockup keeps the full Optimum picker and opens on the selected Calendar date', async ({ page }) => {
  const now = new Date('2026-11-23T08:00:00+03:00');
  await page.clock.setFixedTime(now);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://127.0.0.1:5173' });
  const records = fictionalRecords(now);
  records.appointments = [];
  records.workingHours = [];
  records.hoursOverrides = [
    { date: '2026-11-23', windows: [{ start: '09:00', end: '12:00' }, { start: '13:00', end: '14:00' }] },
    { date: '2026-11-25', windows: [{ start: '13:30', end: '14:30' }] },
    { date: '2026-11-26', windows: [{ start: '10:00', end: '11:00' }] },
  ];
  records.bookingDurations = { presets: [60, 90, 180], defaultMinutes: 60 };
  await page.addInitScript(data => {
    localStorage.setItem('akisync-language', 'en');
    const key = 'akisync-preview-daily-lab-inline-v1';
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ records: data,
      notification: { enabled: true, days: [1, 2, 3, 4, 5], time: '10:00' }, buffer: { enabled: true, minutes: 60 } }));
  }, records);

  const preview = '/preview/s24-ultra.html?mockup=daily-lab-inline';
  await page.goto(preview + '#/today');
  const phone = page.frameLocator('iframe');
  const summary = phone.locator('#booking-slot-summary');
  const earlier = phone.getByRole('button', { name: 'Earlier time', exact: true });
  const later = phone.getByRole('button', { name: 'Later time', exact: true });
  const moreActions = phone.getByRole('button', { name: 'More actions', exact: true });
  await phone.getByRole('link', { name: 'New appointment', exact: true }).click();
  await expect(summary).toContainText('Suggested · Optimum');
  await expect(summary).toContainText('13:00–14:00');
  await expect(phone.locator('.booking-optimum-reserve')).toHaveAttribute('data-state', 'preserved');
  await earlier.click();
  await expect(summary).toContainText('09:00–10:00');
  await later.click();
  await expect(summary).toContainText('13:00–14:00');

  await page.goto(preview + '#/calendar?date=2026-11-25');
  await phone.getByRole('link', { name: 'New appointment', exact: true }).click();
  await expect(summary.locator('time')).toHaveAttribute('datetime', '2026-11-25');
  await expect(summary).toContainText('13:30–14:30');
  await expect(earlier).toBeEnabled();
  await expect(later).toBeEnabled();
  await expect(phone.getByRole('button', { name: 'Book visit' })).toBeVisible();
  await moreActions.click();
  await phone.getByRole('button', { name: 'Copy time', exact: true }).click();
  await expect(phone.getByText('Date and time copied.')).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('13:30–14:30');
  await phone.getByRole('button', { name: 'Close for appointments', exact: true }).click();
  const confirmation = phone.getByRole('dialog', { name: 'Close for appointments', exact: true });
  await expect(confirmation.locator('time')).toHaveAttribute('datetime', '2026-11-25');
  await expect(confirmation).toContainText('13:30–14:30');
  const blockTitle = confirmation.getByRole('textbox', { name: 'Title', exact: true });
  await expect(blockTitle).toBeFocused();
  await expect(blockTitle).toHaveValue('');
  await expect(blockTitle).toHaveAttribute('placeholder', 'Blocked time');
  await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
  const appointmentTitle = phone.getByRole('textbox', { name: 'Visit title (optional)', exact: true });
  await appointmentTitle.fill('Appointment draft');
  await moreActions.click();
  await phone.getByRole('button', { name: 'Close for appointments', exact: true }).click();
  await expect(blockTitle).toHaveValue('Appointment draft');
  await blockTitle.fill('Reserved for pickup');
  await confirmation.getByRole('button', { name: 'Save closure' }).click();
  await expect(page).toHaveURL(/#\/calendar\?date=2026-11-25$/);
  await phone.getByRole('link', { name: 'New appointment', exact: true }).click();
  await expect(summary.locator('time')).toHaveAttribute('datetime', '2026-11-25');
  await expect(summary).toContainText('No time selected');
  await later.click();
  await expect(summary.locator('time')).toHaveAttribute('datetime', '2026-11-26');

  await phone.getByRole('link', { name: 'Back', exact: true }).click();
  const savedBlock = phone.getByRole('button', { name: /^Reserved for pickup · 13:30–14:30/ });
  await savedBlock.click();
  await phone.getByRole('link', { name: 'Open appointment', exact: true }).click();
  const deleteBlock = phone.getByRole('button', { name: 'Delete blocked time', exact: true });
  const deleteConfirmation = phone.getByRole('dialog', { name: 'Delete this blocked time?' });
  await deleteBlock.click();
  await expect(deleteConfirmation).toContainText('13:30–14:30');
  await deleteConfirmation.getByRole('button', { name: 'Cancel' }).click();
  await expect(phone.getByRole('heading', { name: 'Reserved for pickup', exact: true })).toBeVisible();
  await deleteBlock.click();
  await deleteConfirmation.getByRole('button', { name: 'Delete blocked time', exact: true }).click();
  await expect(page).toHaveURL(/#\/calendar\?date=2026-11-25$/);
  await expect(savedBlock).toHaveCount(0);
  await phone.getByRole('link', { name: 'New appointment', exact: true }).click();
  await expect(summary.locator('time')).toHaveAttribute('datetime', '2026-11-25');
  await expect(summary).toContainText('13:30–14:30');
});
