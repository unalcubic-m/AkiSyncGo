import { turkish } from './tr';

export type Locale = 'tr' | 'en';
export type Message = keyof typeof turkish;
export type MessageValues = Record<string, string | number>;
const languagePreferenceKey = 'akisync-language';
const defaultLocale: Locale = 'tr';
const listeners = new Set<() => void>();

function storedLocale(): Locale {
  if (typeof window === 'undefined') return defaultLocale;
  try {
    return window.localStorage.getItem(languagePreferenceKey) === 'en' ? 'en' : defaultLocale;
  } catch {
    return defaultLocale;
  }
}

let locale = storedLocale();

export const getLocale = () => locale;

export function subscribeLocale(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function setLocale(next: Locale) {
  if (next === locale) return;
  locale = next;
  try {
    window.localStorage.setItem(languagePreferenceKey, next);
  } catch {
    // The current session can still use the selected language.
  }
  listeners.forEach(listener => listener());
}

function isMessage(key: string): key is Message {
  return Object.prototype.hasOwnProperty.call(turkish, key);
}

export function translate(key: Message, values?: MessageValues, language = locale): string {
  const pattern = language === 'tr' ? turkish[key] : key;
  return values ? pattern.replace(/\{(\w+)\}/g, (match, name) => values[name]?.toString() ?? match) : pattern;
}

export function t(key: Message, values?: MessageValues): string {
  return translate(key, values);
}

export class LocalizedError extends Error {
  constructor(message: string, readonly localize: () => string) {
    super(message);
  }
}

export function errorMessage(error: unknown, fallback: Message): string {
  if (error instanceof LocalizedError) return error.localize();
  const message = typeof error === 'object' && error !== null && 'message' in error ? error.message : undefined;
  if (typeof message === 'string' && isMessage(message)) return t(message);
  return locale === 'en' && typeof message === 'string' ? message : t(fallback);
}

export function lastSeen(days: number): string {
  if (days === 0) return t('Seen today');
  return t(days === 1 ? 'Last seen {count} day ago' : 'Last seen {count} days ago', { count: days });
}
