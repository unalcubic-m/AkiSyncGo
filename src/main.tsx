/// <reference types="vite/client" />
import { useEffect, useSyncExternalStore, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { getLocale, subscribeLocale, t } from './i18n';
import './theme.css';

function updateDocumentLanguage() {
  document.documentElement.lang = getLocale();
}

function LocalizedApp({ Application }: { Application: ComponentType }) {
  const locale = useSyncExternalStore(subscribeLocale, getLocale);

  useEffect(updateDocumentLanguage, [locale]);

  return <Application />;
}

updateDocumentLanguage();
const root = createRoot(document.getElementById('root')!);
const load = import.meta.env.MODE === 'android' ? import('./Native') : import('./Preview');
load.then(({ default: Application }) => root.render(<LocalizedApp Application={Application} />)).catch(() => {
  root.render(<p role="alert">{t('AkiSync could not start. Close and reopen the app.')}</p>);
});
