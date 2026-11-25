import type { Page } from '@playwright/test';

export async function jumpToCalendarDate(page: Page, date: string) {
  const input = page.getByLabel('Jump to date', { exact: true }).and(page.locator('input[type="date"]'));
  if (!(await input.isVisible())) await page.getByRole('button', { name: /Choose date in/ }).click();
  await input.fill(date);
}
