/// <reference types="vite/client" />
import { useLayoutEffect, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';
import App from '../../src/App';
import LanguageSelect from '../../src/components/LanguageSelect';
import { ButtonLink, PageHeader } from '../../src/components/ui';
import { labReturnsRoute } from '../../src/domain/lab-returns';
import { getLocale, subscribeLocale, t } from '../../src/i18n';
import { readRoute } from '../../src/navigation';
import { hasPhoneSnapshot, repository, usingPhone } from './records';
import '../../src/theme.css';
import './mockup.css';

const copy = (en: string, tr: string) => getLocale() === 'tr' ? tr : en;

function DataSourceSelect() {
  function changeSource(source: string) {
    const previewWindow = window.parent;
    const url = new URL(previewWindow.location.href);
    if (source === 'synthetic') url.searchParams.set('data', 'synthetic');
    else url.searchParams.delete('data');

    const route = readRoute();
    const [screen] = route.split('?');
    const sharedScreens = ['/today', '/planning', '/daily-lab', '/work', '/data', '/patients', '/calendar'];
    url.hash = sharedScreens.includes(screen) ? route : labReturnsRoute;
    previewWindow.location.replace(url);
  }

  return <select className="lab-preview-data-source" aria-label={copy('Preview data source', 'Önizleme veri kaynağı')}
    value={usingPhone ? 'phone' : 'synthetic'} onChange={event => changeSource(event.currentTarget.value)}>
    <option value="phone">{copy('Phone copy', 'Telefon kopyası')}</option>
    <option value="synthetic">{copy('Example data', 'Örnek veriler')}</option>
  </select>;
}

function LabReturnsMockup({ root }: { root: HTMLElement }) {
  const locale = useSyncExternalStore(subscribeLocale, getLocale);
  const [sourceSlot, setSourceSlot] = useState<HTMLElement>();

  useLayoutEffect(() => { document.documentElement.lang = locale; }, [locale]);
  useLayoutEffect(() => {
    if (!hasPhoneSnapshot) return;
    const slot = document.createElement('div');
    slot.className = 'lab-preview-source';
    function attach() {
      const status = root.querySelector('.mobile-header > .device-status');
      if (status && status.previousElementSibling !== slot) status.before(slot);
    }

    const observer = new MutationObserver(attach);
    observer.observe(root, { childList: true, subtree: true });
    attach();
    setSourceSlot(slot);
    return () => { observer.disconnect(); slot.remove(); };
  }, [root]);

  return <>
    <App repository={repository} previewStatus={usingPhone ? 'Phone snapshot' : undefined} dataPanel={() => <>
      <PageHeader title={t('Preview data')} back="/work" />
      <div className="setup-panel"><LanguageSelect /></div>
      <ButtonLink to="/data/notifications" secondary>{t('Notifications')}</ButtonLink>
      <ButtonLink to="/data/event-buffer" secondary>{t('Calendar event buffer')}</ButtonLink>
      <ButtonLink to="/data/durations" secondary>{t('Appointment durations')}</ButtonLink>
      <ButtonLink to="/data/availability" secondary>{t('Availability alerts')}</ButtonLink>
    </>} />
    {sourceSlot ? createPortal(<DataSourceSelect />, sourceSlot) : null}
  </>;
}

const root = document.getElementById('root')!;
const preview = createRoot(root);
preview.render(<LabReturnsMockup root={root} />);
import.meta.hot?.dispose(() => preview.unmount());
