import { CaretDown, CaretRight, Check, CheckCircle, Flask, Plus, UserCircle } from '@phosphor-icons/react';
import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ButtonLink, Field, PageHeader, path, Pill, value } from '../../src/components/ui';
import { titleDate } from '../../src/domain/dates';
import type { Patient, Records, Wait } from '../../src/domain/model';
import { searchBookingPatients } from '../../src/domain/workflows';
import { t } from '../../src/i18n';
import { addPatient, confirmLab, confirmPatient, confirmedLabs, copy, exactNameMatches, followUpsRoute, labRoute, pendingLabs, reopenCheckedLab, type LabResult } from './state';

export const labTitle = () => copy('Daily Laboratory Check', 'Günlük laboratuvar kontrolü');
const pendingLabel = (count: number) => copy(`${count} pending`, `${count} bekliyor`);
const doneLabel = (count: number) => copy(`${count} done today`, `Bugün ${count} tamamlandı`);
const checkedToday = () => copy('Checked today', 'Bugün kontrol edildi');
const caseTitles: Record<string, string> = {
  'Zirconia bridge': 'Zirkonyum köprü', 'Ceramic crown': 'Seramik kuron', 'Night guard': 'Gece plağı', 'Lab check': 'Laboratuvar kontrolü',
};

function LabEntry({ to, closed = false, children }: { to: string; closed?: boolean; children: ReactNode }) {
  const Icon = closed ? CheckCircle : Flask;
  return <a className="panel lab-widget" href={path(to)}>
    <span className={`lab-icon ${closed ? 'lab-icon-green' : 'lab-icon-blue'}`}><Icon size={22} weight="duotone" aria-hidden /></span>
    <span className="lab-widget-copy"><strong>{labTitle()}</strong>{children}</span>
    <CaretRight size={17} aria-hidden />
  </a>;
}

export function LabWidget({ pending }: { pending: number }) {
  return <LabEntry to={labRoute}>
    <small>{copy('Check what arrived in the lab drawer', 'Çekmeceye gelen laboratuvar işlerini kontrol et')}</small>
    {pending > 0 && <Pill tone="blue">{pendingLabel(pending)}</Pill>}
  </LabEntry>;
}

export function LabShortcut({ result }: { result?: LabResult }) {
  return <LabEntry to={`${labRoute}?from=responses`} closed={!!result && (reopenCheckedLab || result === 'finished')}>
    <small>{result ? (reopenCheckedLab ? checkedToday() : labResultLabel(result))
      : copy('Today’s check is still open.', 'Bugünkü kontrol hâlâ açık.')}</small>
  </LabEntry>;
}

function CaseRow({ wait, patient, onDone }: { wait: Wait; patient: Patient | undefined; onDone?: () => void }) {
  if (!patient) return null;
  return <li className="lab-case">
    <span className={`lab-icon ${onDone ? '' : 'lab-icon-green'}`}>
      {onDone ? <UserCircle size={22} aria-hidden /> : <CheckCircle size={22} weight="fill" aria-hidden />}
    </span>
    <div className="lab-case-copy">
      <a href={path(`/patients/${patient.id}`)}>{patient.name}</a>
      <small>{copy(wait.title, caseTitles[wait.title] ?? wait.title)}</small>
    </div>
    {onDone ? <button type="button" className="button secondary lab-case-action"
      aria-label={copy(`Mark ${patient.name}, ${wait.title} done`, `${patient.name}, ${caseTitles[wait.title] ?? wait.title} tamamlandı olarak işaretle`)}
      onClick={onDone}><Check size={15} weight="bold" aria-hidden />{copy('Done', 'Tamamla')}</button>
      : <Pill tone="green">{copy('Done', 'Tamamlandı')}</Pill>}
  </li>;
}

function MissingCases({ records, today, onConfirmed }: { records: Records; today: string; onConfirmed: (name: string) => void }) {
  const [query, setQuery] = useState('');
  const [create, setCreate] = useState<'confirm' | 'form'>();
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const results = useRef<HTMLDivElement>(null);
  const firstName = useRef<HTMLInputElement>(null);
  const { patients } = records;
  const matches = searchBookingPatients(patients, query);
  const exact = exactNameMatches(patients, query);
  const parts = query.trim().split(/\s+/).filter(Boolean);
  const hasName = parts.length > 0 && /\p{L}/u.test(query);

  function complete(patient: Patient) {
    confirmPatient(patient, today);
    clear(patient.name);
  }

  function clear(name: string) {
    setQuery('');
    setCreate(undefined);
    setError('');
    onConfirmed(name);
    input.current?.focus();
  }

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (exact.length === 1) complete(exact[0]);
    else if (matches.length) results.current?.querySelector('button')?.focus();
    else if (hasName) setCreate('confirm');
  }

  function savePatient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const first = value(data, 'first');
    const last = value(data, 'last');
    if (!/\p{L}/u.test(first) || !/\p{L}/u.test(last)) {
      setError(copy('Enter a first and last name.', 'Adı ve soyadı girin.'));
      firstName.current?.focus();
      return;
    }
    const result = addPatient(first, last, today);
    if (result.patient) clear(result.patient.name);
    else {
      setQuery(`${first} ${last}`);
      setCreate(undefined);
      setError(copy('This name is already in the patient list. Choose the matching record below.',
        'Bu ad hasta listesinde zaten var. Aşağıdan eşleşen kaydı seçin.'));
      input.current?.focus();
    }
  }

  return <details className="panel lab-missing">
    <summary>
      <span className="lab-icon lab-icon-blue"><Plus size={20} aria-hidden /></span>
      <span><strong>{copy('Add Missing Patients / LabCheck Tasks', 'Eksik hasta / laboratuvar kontrolü ekle')}</strong>
        <small>{copy('Optional · For cases already in the drawer', 'İsteğe bağlı · Çekmecedeki işler için')}</small></span>
      <CaretDown size={17} aria-hidden />
    </summary>
    <div className="lab-missing-body">
      <form onSubmit={search} className="lab-search">
        <Field label={copy('Patient name', 'Hasta adı')}><input ref={input} type="search" autoComplete="off" maxLength={255}
          placeholder={copy('First and last name', 'Ad ve soyad')} value={query} onChange={event => {
            setQuery(event.target.value);
            setCreate(undefined);
            setError('');
          }} /></Field>
        <button type="submit" className="button secondary" disabled={!hasName}>{copy('Find', 'Bul')}</button>
      </form>
      {error && <p className="form-error" role="alert">{error}</p>}
      {matches.length > 0 && !create && <div className="lab-matches" ref={results} aria-label={copy('Matching patients', 'Eşleşen hastalar')}>
        {(exact.length ? exact : matches).map(patient => {
          const pending = pendingLabs(records).some(wait => wait.patientId === patient.id);
          const confirmed = confirmedLabs(records, today).some(wait => wait.patientId === patient.id);
          const phone = patient.phone.replace(/\D/g, '').slice(-4);
          return <button key={patient.id} type="button" className="lab-match" onClick={() => complete(patient)}>
            <span><strong>{patient.name}{phone && <small> · •••• {phone}</small>}</strong>
              <small>{pending ? copy('Complete pending LabCheck', 'Bekleyen kontrolü tamamla') : confirmed
                ? copy('Already confirmed today', 'Bugün zaten onaylandı') : copy('Add a completed LabCheck', 'Tamamlanmış kontrol ekle')}</small></span>
            <Check size={18} aria-hidden />
          </button>;
        })}
      </div>}
      {hasName && matches.length === 0 && !create && <p className="muted" role="status">{copy('No matching patients.', 'Eşleşen hasta yok.')}</p>}
      {create === 'confirm' && <div className="lab-create">
        <strong>{copy(`Create a patient record for ${query.trim()}?`, `${query.trim()} için hasta kaydı oluşturulsun mu?`)}</strong>
        <p>{copy('The LabCheck will be saved as Done on the new record.', 'Laboratuvar kontrolü yeni kayda tamamlandı olarak eklenecek.')}</p>
        <div className="row-actions"><button className="button" type="button" onClick={() => {
          setCreate('form');
          requestAnimationFrame(() => firstName.current?.focus());
        }}>{copy('Create patient', 'Hasta oluştur')}</button><button className="text-button" type="button" onClick={() => {
          setCreate(undefined);
          input.current?.focus();
        }}>{t('Cancel')}</button></div>
      </div>}
      {create === 'form' && <form className="lab-create" onSubmit={savePatient}>
        <div className="form-grid">
          <Field label={copy('First name', 'Ad')}><input ref={firstName} name="first" defaultValue={parts[0]} maxLength={100} required /></Field>
          <Field label={copy('Last name', 'Soyad')}><input name="last" defaultValue={parts.slice(1).join(' ')} maxLength={100} required /></Field>
        </div>
        <div className="row-actions"><button className="button" type="submit">{copy('Save and mark Done', 'Kaydet ve tamamla')}</button>
          <button className="text-button" type="button" onClick={() => {
            setCreate(undefined);
            input.current?.focus();
          }}>{t('Cancel')}</button></div>
      </form>}
    </div>
  </details>;
}

export function labResultLabel(result: LabResult) {
  if (result === 'nothing') return copy('No laboratory work arrived today.', 'Bugün laboratuvar işi gelmedi.');
  if (result === 'dismissed') return copy('Laboratory check dismissed for today.', 'Laboratuvar kontrolü bugün için kapatıldı.');
  return copy('Today’s laboratory check is complete.', 'Bugünkü laboratuvar kontrolü tamamlandı.');
}

export function Laboratory({ records, today, closed, fromFollowUps, onClose }: {
  records: Records; today: string; closed?: LabResult; fromFollowUps: boolean; onClose: (result: LabResult) => void;
}) {
  const [status, setStatus] = useState('');
  const pending = pendingLabs(records);
  const confirmed = confirmedLabs(records, today);
  const returnTo = fromFollowUps ? followUpsRoute : '/today';
  const patientFor = (wait: Wait) => records.patients.find(patient => patient.id === wait.patientId);
  function announce(name: string) { setStatus(copy(`${name} · LabCheck done`, `${name} · Laboratuvar kontrolü tamamlandı`)); }

  return <div className="lab-page">
    <PageHeader title={labTitle()} subtitle={titleDate(today)} back={returnTo} />
    {closed && !reopenCheckedLab ? <div className="panel lab-empty">
      <CheckCircle size={29} aria-hidden /><p>{labResultLabel(closed)}</p>
      <div className="badges lab-summary-badges">
        <Pill tone="green">{doneLabel(confirmed.length)}</Pill>
        {pending.length > 0 && <Pill tone="amber">{pendingLabel(pending.length)}</Pill>}
      </div>
      <ButtonLink to={returnTo} secondary back={fromFollowUps}>{fromFollowUps
        ? copy('Back to Follow-ups', 'Takiplere dön') : t('Go to Today')}</ButtonLink>
    </div> : <>
      {closed && <p className="lab-check-recorded"><CheckCircle size={20} aria-hidden /> <strong>{checkedToday()}</strong></p>}
      <p className="lab-intro muted">{copy('Mark the cases that are in the lab drawer as Done.', 'Çekmecede bulunan laboratuvar işlerini tamamlandı olarak işaretle.')}</p>
      <section aria-labelledby="pending-lab-heading">
        <div className="lab-section-heading"><h2 id="pending-lab-heading">{copy('Pending LabCheck tasks', 'Bekleyen laboratuvar işleri')}</h2><Pill tone="blue">{pendingLabel(pending.length)}</Pill></div>
        {pending.length ? <ul className="panel lab-list">
          {pending.map(wait => <CaseRow key={wait.id} wait={wait} patient={patientFor(wait)} onDone={() => {
            const patient = patientFor(wait);
            confirmLab(wait.id, today);
            if (patient) announce(patient.name);
          }} />)}
        </ul> : <div className="panel lab-empty"><CheckCircle size={26} aria-hidden />
          <p>{copy('No pending laboratory cases.', 'Bekleyen laboratuvar işi yok.')}</p></div>}
      </section>
      <MissingCases records={records} today={today} onConfirmed={announce} />
      <p className={status ? 'lab-status' : 'visually-hidden'} role="status">{status}</p>
      {confirmed.length > 0 && <details className="panel lab-confirmed">
        <summary><span className="lab-icon lab-icon-green"><CheckCircle size={21} weight="fill" aria-hidden /></span>
          <strong>{doneLabel(confirmed.length)}</strong><CaretDown size={17} aria-hidden /></summary>
        <ul className="lab-list">{confirmed.map(wait => <CaseRow key={wait.id} wait={wait} patient={patientFor(wait)} />)}</ul>
      </details>}
      {!closed && <div className="lab-actions">
        {pending.length === 0 && <button className="button" type="button" onClick={() => onClose('finished')}>{copy('Finish check', 'Kontrolü bitir')}</button>}
        {confirmed.length === 0 && <button className={`button${pending.length ? '' : ' secondary'}`} type="button" onClick={() => onClose('nothing')}>
          {copy('Nothing arrived', 'Hiçbir iş gelmedi')}
        </button>}
        <button className="button secondary" type="button" onClick={() => onClose('dismissed')}>{copy('Dismiss for today', 'Bugün için kapat')}</button>
        {pending.length > 0 && <small>{copy('Pending cases stay open for the next check.', 'Bekleyen işler bir sonraki kontrol için açık kalır.')}</small>}
      </div>}
    </>}
  </div>;
}
