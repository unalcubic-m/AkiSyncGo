import { registerPlugin } from '@capacitor/core';

const bridge = registerPlugin<{
  requestNotificationAccess(): Promise<{ granted: boolean }>;
  notificationAccess(): Promise<{ granted: boolean }>;
  openNotificationSettings(): Promise<void>;
  exactAlarmAccess(): Promise<{ granted: boolean }>;
  openExactAlarmSettings(): Promise<void>;
}>('AkiSyncAvailabilityReminders');

export async function getNotificationAccess() {
  return (await bridge.notificationAccess()).granted;
}

export function openNotificationSettings() {
  return bridge.openNotificationSettings();
}

export async function requestAvailabilityReminderPermission() {
  return (await bridge.requestNotificationAccess()).granted;
}

export async function getExactAlarmAccess() {
  return (await bridge.exactAlarmAccess()).granted;
}

export function openExactAlarmSettings() {
  return bridge.openExactAlarmSettings();
}
