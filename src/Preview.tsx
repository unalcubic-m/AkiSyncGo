import { useState } from 'react';
import { t } from './i18n';
import App from './App';
import LanguageSelect from './components/LanguageSelect';
import { ButtonLink, PageHeader, RecordForm } from './components/ui';
import { phoneSnapshotKey, PreviewRepository } from './storage/repository';

const fictionalRepository = new PreviewRepository();
const phoneRepository = new PreviewRepository(sessionStorage, phoneSnapshotKey);

export default function Preview() {
  const [usingPhoneSnapshot, setUsingPhoneSnapshot] = useState(() => sessionStorage.getItem(phoneSnapshotKey) !== null);
  const repository = usingPhoneSnapshot ? phoneRepository : fictionalRepository;
  return <App key={String(usingPhoneSnapshot)} repository={repository} previewStatus={usingPhoneSnapshot ? 'Phone snapshot' : undefined} dataPanel={({ refresh }) => <>
    <PageHeader title={t('Preview data')} back="/work" />
    <div className="setup-panel"><LanguageSelect /></div>
    <ButtonLink to="/data/notifications" secondary>{t('Notifications')}</ButtonLink>
    <ButtonLink to="/data/event-buffer" secondary>{t('Calendar event buffer')}</ButtonLink>
    <ButtonLink to="/data/durations" secondary>{t('Appointment durations')}</ButtonLink>
    <ButtonLink to="/data/availability" secondary>{t('Availability alerts')}</ButtonLink>
    {usingPhoneSnapshot
      ? <RecordForm submit={t('Discard phone snapshot')} onSave={async () => {
        phoneRepository.reset();
        setUsingPhoneSnapshot(false);
      }}>
        <p className="form-intro">{t('Edits to this snapshot stay in this browser tab.')}</p>
      </RecordForm>
      : <RecordForm submit={t('Reset fictional records')} onSave={async () => { fictionalRepository.reset(); await refresh(); }}>
        <p className="form-intro">{t('This preview stores fictional records in this browser. Resetting removes edits made in this preview.')}</p>
      </RecordForm>}
  </>} />;
}
