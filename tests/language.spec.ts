import { expect, test } from '@playwright/test';

test('Turkish is the default and the selected language survives reopening', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-23T08:00:00+03:00'));
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'tr');
  await expect(page.getByRole('heading', { name: 'Bugün', exact: true })).toBeVisible();
  await expect(page.getByText('23 Kasım Pazartesi', { exact: true })).toBeVisible();

  const navigation = page.getByRole('navigation', { name: 'Ana gezinme' });
  await navigation.getByRole('link', { name: 'Hastalar' }).click();
  await page.getByRole('link', { name: 'Hasta ekle' }).click();
  await page.getByLabel('Ad soyad').fill('İpek Çelik');
  await page.getByLabel('Durum').selectOption({ label: 'Pasif' });
  await page.getByRole('button', { name: 'Hastayı kaydet' }).click();
  await expect(page.getByRole('heading', { name: 'İPEK ÇELİK' })).toBeVisible();
  await expect(page.getByText('Pasif', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Yeni randevu' }).click();
  await expect(page.getByRole('heading', { name: 'Randevu ekle' })).toBeVisible();
  await expect(page.getByRole('button', { name: '90 dk', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('Randevu başlığı').fill('Kontrol muayenesi');
  await page.getByRole('button', { name: 'Randevu oluştur' }).click();
  await expect(page.getByRole('heading', { name: 'Kontrol muayenesi' })).toBeVisible();
  await expect(page.locator('.row-heading .pill')).toHaveText('Planlandı');

  await navigation.getByRole('link', { name: 'İşler' }).click();
  await page.getByRole('link', { name: 'Önizleme verileri' }).click();
  await page.getByLabel('Dil').selectOption('en');
  await expect(page.getByRole('heading', { name: 'Preview data' })).toBeVisible();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByLabel('Language')).toHaveValue('en');
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Patients' }).click();
  const passivePatient = page.getByRole('link', { name: /İPEK ÇELİK.*Passive/ });
  await expect(page.getByRole('combobox', { name: 'Status' })).toHaveValue('Active');
  await expect(passivePatient).toHaveCount(0);
  const search = page.getByRole('searchbox', { name: 'Search patients' });
  await search.fill('ipek');
  await expect(passivePatient).toBeVisible();
  await search.clear();
  await expect(passivePatient).toHaveCount(0);

  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Work' }).click();
  await page.getByRole('link', { name: 'Preview data' }).click();
  await page.getByLabel('Language').selectOption('tr');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'tr');
  await expect(page.getByLabel('Dil')).toHaveValue('tr');
});
