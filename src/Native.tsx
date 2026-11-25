import { errorMessage, t, type Message } from './i18n';
import { App as CapacitorApp } from '@capacitor/app';
import { useEffect, useRef, useState } from 'react';
import App, { Brand } from './App';
import LanguageSelect from './components/LanguageSelect';
import { ButtonLink, Field, PageHeader, Pill, RecordForm } from './components/ui';
import { decodeRecords, emptyRecords, type Records } from './domain/model';
import { labNotificationUrl, labRoute } from './domain/daily-lab';
import { openRoute } from './navigation';
import PatientImport from './screens/PatientImport';
import { bridge, folderRepository } from './storage/android';
import { appLockVerifier, verifyAppPassphrase } from './storage/app-lock';
import { keyForEnvelope, openRecords, readBackup, readEnvelope } from './storage/encryption';

const idleMs = 5 * 60_000;
type Phase = 'loading' | 'folder' | 'legacy' | 'locked' | 'open' | 'error';

function Password({ label, name, create }: { label: string; name: string; create?: boolean }) {
  return <Field label={label}><input name={name} type="password" autoComplete={create ? 'new-password' : 'current-password'}
    minLength={create ? 12 : undefined} maxLength={256} required /></Field>;
}

function password(data: FormData, name: string) { return String(data.get(name) ?? ''); }
const parseRecords = (records: string) => decodeRecords(JSON.parse(records));

export default function Native() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState<{ cause: unknown; fallback: Message }>();
  const [folderName, setFolderName] = useState('');
  const [legacyEnvelope, setLegacyEnvelope] = useState<string>();
  const [migration, setMigration] = useState<Records>();
  const [verifier, setVerifier] = useState<string>();
  const [message, setMessage] = useState<Message | ''>('');
  const [passphraseForm, setPassphraseForm] = useState(false);
  const [labRequested, setLabRequested] = useState(false);
  const folder = useRef<string | undefined>(undefined);
  const localLock = useRef<string | undefined>(undefined);
  const pickerOpen = useRef(false);
  const backgrounded = useRef(false);
  const idleAt = useRef(0);

  function lock() {
    setMessage('');
    setPassphraseForm(false);
    setPhase('locked');
  }

  async function openSavedFolder() {
    if (!folder.current) return setPhase('folder');
    try {
      const result = await bridge.inspectFolder({ uri: folder.current });
      if (!result.records) throw new Error('The folder no longer contains the AkiSync database.');
      parseRecords(result.records);
      setFolderName(result.name);
      setError(undefined);
      if (localLock.current && backgrounded.current) lock();
      else setPhase('open');
    } catch (failure) {
      setError({ cause: failure, fallback: 'Could not open the records folder.' });
      setPhase(localLock.current && backgrounded.current ? 'locked' : 'folder');
    }
  }

  useEffect(() => {
    let active = true;
    const receive = ({ url }: { url: string }) => { if (active && url === labNotificationUrl) setLabRequested(true); };
    const listener = CapacitorApp.addListener('appUrlOpen', receive).catch(() => undefined);
    void CapacitorApp.getLaunchUrl().then(launch => { if (launch) receive(launch); }).catch(() => undefined);
    return () => {
      active = false;
      void listener.then(handle => handle?.remove()).catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    if (phase !== 'open' || !labRequested) return;
    openRoute(labRoute);
    setLabRequested(false);
  }, [phase, labRequested]);

  useEffect(() => {
    async function load() {
      const config = await bridge.configuration();
      folder.current = config.folder;
      localLock.current = config.verifier;
      setVerifier(config.verifier);
      if (config.verifier) return setPhase('locked');
      if (config.folder) return openSavedFolder();
      if (config.legacy) {
        const { encrypted } = await bridge.readLegacy();
        if (encrypted) {
          setLegacyEnvelope(encrypted);
          return setPhase('legacy');
        }
      }
      setPhase('folder');
    }
    load().catch(failure => {
      setError({ cause: failure, fallback: 'Could not open AkiSync settings.' });
      setPhase('error');
    });
  }, []);

  useEffect(() => {
    let listener: { remove: () => Promise<void> } | undefined;
    let disposed = false;
    CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      backgrounded.current = !isActive;
      const pastIdleLimit = idleAt.current > 0 && Date.now() >= idleAt.current;
      if (localLock.current && ((!isActive && !pickerOpen.current) || pastIdleLimit)) lock();
    }).then(result => { if (disposed) void result.remove(); else listener = result; });
    return () => { disposed = true; void listener?.remove(); };
  }, []);

  useEffect(() => {
    if ((phase !== 'open' && phase !== 'folder') || !verifier) return;
    let timer = 0;
    const reset = () => {
      window.clearTimeout(timer);
      idleAt.current = Date.now() + idleMs;
      timer = window.setTimeout(lock, idleMs);
    };
    reset();
    window.addEventListener('pointerdown', reset);
    window.addEventListener('keydown', reset);
    return () => {
      window.clearTimeout(timer);
      idleAt.current = 0;
      window.removeEventListener('pointerdown', reset);
      window.removeEventListener('keydown', reset);
    };
  }, [phase, verifier]);

  async function pick<T>(action: () => Promise<T>): Promise<T> {
    if (pickerOpen.current) throw new Error('Finish the current file selection first.');
    pickerOpen.current = true;
    try { return await action(); }
    finally { pickerOpen.current = false; }
  }

  async function selectFolder(copy?: Records) {
    const selection = await pick(() => bridge.chooseFolder());
    if (selection.cancelled) return false;
    const info = await bridge.inspectFolder({ uri: selection.uri });
    const records = info.records === undefined ? undefined : parseRecords(info.records);
    if (copy && records && JSON.stringify(copy) !== JSON.stringify(records)) {
      throw new Error('This folder already contains different AkiSync records. Choose an empty folder.');
    }
    if (!copy && folder.current && !records) throw new Error('Choose the folder that contains your existing AkiSync database.');
    const result = await bridge.setFolder({
      uri: selection.uri,
      seed: records ? undefined : JSON.stringify(copy ?? emptyRecords()),
      adopted: info.records,
      migrated: !!migration,
    });
    folder.current = selection.uri;
    setFolderName(result.name);
    setMigration(undefined);
    setLegacyEnvelope(undefined);
    setError(undefined);
    if (localLock.current && backgrounded.current) lock();
    else setPhase('open');
    return true;
  }

  async function setAppLock(next: string | null) {
    await bridge.setVerifier({ verifier: next });
    localLock.current = next ?? undefined;
    setVerifier(next ?? undefined);
    setPassphraseForm(false);
    setMessage(next ? 'App passphrase turned on.' : 'App passphrase turned off.');
    if (next && backgrounded.current) lock();
  }

  return phase === 'open' ? <App native repository={folderRepository} dataPanel={({ refresh, save, restoreRecords, records, today, calendarPublishing }) => <>
    <PageHeader title={t('Settings')} back="/work" />
    <div className="setup-panel"><LanguageSelect /></div>
    <div className="setup-panel"><ButtonLink to="/data/notifications" secondary>{t('Notifications')}</ButtonLink></div>
    <div className="setup-panel"><ButtonLink to="/data/event-buffer" secondary>{t('Calendar event buffer')}</ButtonLink></div>
    <div className="setup-panel"><ButtonLink to="/data/durations" secondary>{t('Appointment durations')}</ButtonLink></div>
    <div className="setup-panel"><ButtonLink to="/data/availability" secondary>{t('Availability alerts')}</ButtonLink></div>
    {calendarPublishing}
    <PatientImport records={records} today={today} save={save} chooseFile={async () => {
      const selection = await pick(() => bridge.chooseRecordsFile({ kind: 'patient-list' }));
      return selection.cancelled ? undefined : selection.content;
    }} />
    <div className="setup-panel">
      <h2>{t('Records folder')}</h2>
      <RecordForm submit={t('Change folder')} onSave={async () => {
        if (await selectFolder(await folderRepository.load())) {
          await refresh();
          setMessage('Records folder changed.');
        }
      }}>
        <p><strong>{folderName}</strong></p>
        <p className="form-intro">{t('Records are stored in readable SQLite files in this folder. Changing folders copies the current records.')}</p>
      </RecordForm>
    </div>
    <div className="setup-panel">
      <div className="row-heading"><h2>{t('App passphrase')}</h2><Pill>{t(verifier ? 'On' : 'Off')}</Pill></div>
      <p className="form-intro">{t('The passphrase only locks the app. Anyone with access to the records folder can read its files.')}</p>
      {verifier ? <RecordForm submit={t('Turn off app passphrase')} onSave={() => setAppLock(null)}>
        <button type="button" className="button secondary" onClick={lock}>{t('Lock now')}</button>
      </RecordForm> : passphraseForm ? <RecordForm submit={t('Save app passphrase')} resetOnSave onSave={async data => {
        const passphrase = password(data, 'passphrase');
        if (passphrase !== password(data, 'confirmation')) throw new Error('The passphrases must match.');
        await setAppLock(await appLockVerifier(passphrase));
      }}>
        <Password label={t('App passphrase')} name="passphrase" create />
        <Password label={t('Confirm app passphrase')} name="confirmation" create />
        <button type="button" className="button secondary" onClick={() => setPassphraseForm(false)}>{t('Cancel')}</button>
      </RecordForm> : <button className="button secondary settings-action" onClick={() => setPassphraseForm(true)}>{t('Turn on app passphrase')}</button>}
    </div>
    <div className="setup-panel">
      <details>
        <summary>{t('Restore a backup from an older version')}</summary>
        <RecordForm submit={t('Choose backup file')} resetOnSave onSave={async data => {
          const selection = await pick(() => bridge.chooseRecordsFile({ kind: 'legacy-backup' }));
          if (selection.cancelled) return;
          const records = await readBackup(selection.content, password(data, 'backup'));
          await restoreRecords(records);
          setMessage('Backup restored to the records folder.');
        }}>
          <Password label={t('Backup passphrase')} name="backup" />
          <label className="check"><input type="checkbox" required />{t('Replace current records with this backup')}</label>
        </RecordForm>
      </details>
    </div>
    {message && <p className="save-status" role="status">{t(message)}</p>}
  </>} /> : <div className="lock-page">
    <main className="lock-content">
      <Brand />
      {phase === 'loading' && <p role="status">{t('Opening local storage…')}</p>}
      {error && phase !== 'locked' && <p role="alert">{errorMessage(error.cause, error.fallback)}</p>}
      {phase === 'locked' && <>
        <h1>{t('Unlock AkiSync')}</h1>
        <RecordForm submit={t('Unlock')} onSave={async data => {
          await verifyAppPassphrase(password(data, 'passphrase'), localLock.current!);
          await openSavedFolder();
        }}>
          <Password label={t('App passphrase')} name="passphrase" />
        </RecordForm>
      </>}
      {phase === 'legacy' && legacyEnvelope && <>
        <h1>{t('Move existing records')}</h1>
        <p>{t('Enter your old app passphrase to move these records to the folder you choose.')}</p>
        <RecordForm submit={t('Continue')} onSave={async data => {
          const envelope = readEnvelope(legacyEnvelope, 'akisync-vault');
          setMigration(await openRecords(envelope, await keyForEnvelope(password(data, 'passphrase'), envelope)));
          setPhase('folder');
        }}>
          <Password label={t('Previous app passphrase')} name="passphrase" />
        </RecordForm>
      </>}
      {phase === 'folder' && <>
        <h1>{t('Choose a records folder')}</h1>
        <p>{t(folder.current ? 'Select the folder containing your AkiSync database to restore access.'
          : 'Choose or create a folder on this device for your unencrypted AkiSync database.')}</p>
        <RecordForm submit={t('Choose folder')} onSave={async () => { await selectFolder(migration); }} />
      </>}
      {phase !== 'loading' && <LanguageSelect />}
    </main>
  </div>;
}
