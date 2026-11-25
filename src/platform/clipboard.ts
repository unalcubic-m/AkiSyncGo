import { Capacitor, registerPlugin } from '@capacitor/core';

const clipboard = registerPlugin<{
  copyPatientPhone(options: { phone: string }): Promise<void>;
  copyAppointmentTime(options: { text: string }): Promise<void>;
}>('AkiSyncClipboard');

export async function copyPatientPhone(phone: string) {
  if (Capacitor.getPlatform() === 'android') {
    await clipboard.copyPatientPhone({ phone });
    return;
  }
  await navigator.clipboard.writeText(phone);
}

export async function copyAppointmentTime(text: string) {
  if (Capacitor.getPlatform() === 'android') {
    await clipboard.copyAppointmentTime({ text });
    return;
  }
  await navigator.clipboard.writeText(text);
}
