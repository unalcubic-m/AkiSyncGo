import { expect, type Page } from '@playwright/test';

export async function dismissBookingOffer(page: Page, patient: string) {
  const offer = page.getByRole('dialog', { name: 'Ready to book' });
  await expect(offer).toContainText(patient);
  await offer.getByRole('button', { name: 'Later', exact: true }).click();
  await expect(offer).toBeHidden();
}

export async function chooseBookingPatient(page: Page, name: string) {
  await page.getByRole('button', { name: /^Patient / }).click();
  const picker = page.getByRole('dialog', { name: 'Choose a patient' });
  await picker.getByRole('searchbox', { name: 'Search patients' }).fill(name);
  await picker.getByRole('button').filter({ has: page.getByText(name, { exact: true }) }).click();
}

export async function openTimePicker(page: Page) {
  await page.getByRole('button', { name: 'Change time', exact: true }).click();
  return page.getByRole('dialog', { name: 'Change time' });
}

export async function chooseBookingStart(page: Page, start: string) {
  const picker = await openTimePicker(page);
  await picker.getByText('Choose date and time', { exact: true }).click();
  await picker.getByLabel('Start time').fill(start);
  await picker.getByRole('button', { name: 'Use this time' }).click();
}

export async function expectBookingTime(page: Page, day: string, time: string) {
  const summary = page.locator('#booking-slot-summary');
  await expect(summary.locator('time')).toHaveAttribute('datetime', day);
  await expect(summary).toContainText(time);
}
