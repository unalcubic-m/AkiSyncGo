/// <reference types="vite/client" />
import { useLayoutEffect, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import App from '../../src/App';
import LanguageSelect from '../../src/components/LanguageSelect';
import { ButtonLink, PageHeader } from '../../src/components/ui';
import { getLocale, subscribeLocale, t } from '../../src/i18n';
import { repository } from './records';
import '../../src/theme.css';

function Mockup() {
  const locale = useSyncExternalStore(subscribeLocale, getLocale);
  useLayoutEffect(() => { document.documentElement.lang = locale; }, [locale]);
  return <App repository={repository} dataPanel={() => <>
    <PageHeader title={t('Preview data')} back="/work" />
    <div className="setup-panel"><LanguageSelect /></div>
    <ButtonLink to="/data/notifications" secondary>{t('Notifications')}</ButtonLink>
  </>} />;
}

const preview = createRoot(document.getElementById('root')!);
preview.render(<Mockup />);
import.meta.hot?.dispose(() => preview.unmount());
