import { CaretDown, CaretRight, Check, CheckCircle, Flask, Plus, UserCircle } from '@phosphor-icons/react';
import { useMemo, useRef, useState, type FormEvent } from 'react';
import { Field, newId, PageHeader, path, Pill, value } from '../components/ui';
import { confirmLab, confirmPatientLab, confirmedLabs, createLabPatient, exactLabPatientMatches,
  labResultToday, labRoute, pendingLabs, recordLabReturn } from '../domain/daily-lab';
import { titleDate } from '../domain/dates';
import { labReturnReviews, labReturnsRoute } from '../domain/lab-returns';
import type { Patient, RecordChange, Records, Wait } from '../domain/model';
import type { LabResult } from '../domain/notification-settings';
import { searchBookingPatients } from '../domain/workflows';
import { errorMessage, t } from '../i18n';
import { useRouteField } from '../navigation';
import { LabReturnReview } from './LabReturnReview';
import './daily-lab.css';

const pendingLabel = (count: number) => t('{count} lab cases pending', { count });
const doneLabel = (count: number) => t('{count} lab cases done today', { count });
const labDone = (name: string) => t('{name} · LabCheck done', { name });
type Save = (change: RecordChange) => Promise<void>;

export function LabCheckShortcut({ records, today, fromWork = false }: { records: Records; today: string; fromWork?: boolean }) {
  const checked = Boolean(labResultToday(records, today));
  if (checked && !fromWork) return null;
  const count = pendingLabs(records).length;
  const Icon = checked ? CheckCircle : Flask;
  return <a className="panel lab-widget" href={path(labRoute + (fromWork ? '?from=responses' : ''))}>
    <span className={`lab-icon ${checked ? 'lab-icon-green' : 'lab-icon-blue'}`}><Icon size={22} weight="duotone" aria-hidden /></span>
    <span className="lab-widget-copy"><strong>{t('Daily Laboratory Check')}</strong>
      <small>{t(checked ? 'Checked today' : fromWork ? 'Today’s check is still open.' : 'Check what arrived in the lab drawer')}</small>
      {!fromWork && count > 0 && <Pill tone="blue">{pendingLabel(count)}</Pill>}
    </span><CaretRight size={17} aria-hidden />
  </a>;
}

function CaseRow({ wait, patient, onDone, busy }: { wait: Wait; patient?: Patient; onDone?: () => void; busy?: boolean }) {
  if (!patient) return null;
  return <li className="lab-case">
    <span className={`lab-icon${onDone ? '' : ' lab-icon-green'}`}>{onDone ? <UserCircle size={22} aria-hidden /> : <CheckCircle size={22} weight="fill" aria-hidden />}</span>
    <div className="lab-case-copy"><a href={path(`/patients/${patient.id}`)}>{patient.name}</a><small>{wait.title}</small></div>
    {onDone ? <button type="button" className="button secondary lab-case-action" disabled={busy}
      aria-label={t('Mark {patient}, {case} done', { patient: patient.name, case: wait.title })} onClick={onDone}>
      <Check size={15} weight="bold" aria-hidden />{t('Mark done')}
    </button> : <Pill tone="green">{t('Done')}</Pill>}
  </li>;
}

function MissingCases({ records, today, now, busy, run, save }: {
  records: Records; today: string; now: Date; busy: boolean; run: (action: () => Promise<string | void>) => Promise<void>; save: Save;
}) {
  const [expanded, setExpanded] = useRouteField('labMissingOpen', false);
  const [{ query, reviewPatientId }, setSearch] = useRouteField<{ query: string; reviewPatientId?: string }>('labSearch', { query: '' });
  const [create, setCreate] = useState<'confirm' | 'form'>();
  const [duplicate, setDuplicate] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const results = useRef<HTMLDivElement>(null);
  const firstName = useRef<HTMLInputElement>(null);
  const reviewCard = useRef<HTMLElement>(null);
  const { patients } = records;
  const exact = exactLabPatientMatches(patients, query);
  const matches = exact.length ? exact : searchBookingPatients(patients, query);
  const parts = query.trim().split(/\s+/).filter(Boolean);
  const hasName = /\p{L}/u.test(query);
  const reviews = useMemo(() => labReturnReviews(records, today, now), [records, today, now]);
  const pendingIds = new Set(pendingLabs(records).map(wait => wait.patientId));
  const selectedPatient = patients.find(patient => patient.id === reviewPatientId);
  const review = selectedPatient && reviews.get(selectedPatient.id);

  function changeQuery(next: string) { setSearch({ query: next }); setCreate(undefined); setDuplicate(false); }
  function focusSearch() { requestAnimationFrame(() => input.current?.focus()); }

  function showReview(patient: Patient) {
    if (!input.current) return;
    setSearch({ query, reviewPatientId: patient.id });
    setDuplicate(false);
    requestAnimationFrame(() => {
      reviewCard.current?.scrollIntoView({ block: 'nearest' });
      reviewCard.current?.focus({ preventScroll: true });
    });
  }

  function finishSearch() {
    if (!input.current) return;
    changeQuery('');
    focusSearch();
  }

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (exact.length === 1) selectPatient(exact[0]);
    else if (matches.length) results.current?.querySelector('button')?.focus();
    else if (hasName) setCreate('confirm');
  }

  function selectPatient(patient: Patient) {
    if (reviews.has(patient.id)) {
      showReview(patient);
      return;
    }
    void run(async () => {
      let requiresReview = false;
      const taskId = newId();
      await save(current => {
        requiresReview = labReturnReviews(current, today, now).has(patient.id);
        return requiresReview ? current : confirmPatientLab(current, patient.id, today, taskId);
      });
      if (requiresReview) {
        showReview(patient);
        return;
      }
      finishSearch();
      return labDone(patient.name);
    });
  }

  function addAnotherReturn(patient: Patient, title?: string) {
    void run(async () => {
      let saved = false;
      const taskId = newId();
      await save(current => {
        if (title === undefined && (confirmedLabs(current, today).some(wait => wait.patientId === patient.id)
          || pendingLabs(current).some(wait => wait.patientId === patient.id))) return current;
        saved = true;
        return recordLabReturn(current, patient.id, today, taskId, title);
      });
      if (!saved) return;
      finishSearch();
      return t('{name} · New lab return saved', { name: patient.name });
    });
  }

  function completePending(patient: Patient, job: Wait) {
    void run(async () => {
      let saved = false;
      await save(current => {
        saved = pendingLabs(current).some(wait => wait.id === job.id && wait.patientId === patient.id);
        return saved ? confirmLab(current, job.id, today) : current;
      });
      if (!saved) return;
      finishSearch();
      return labDone(patient.name);
    });
  }

  function createPatient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const first = value(data, 'first');
    const last = value(data, 'last');
    void run(async () => {
      if (!/\p{L}/u.test(first) || !/\p{L}/u.test(last)) throw new Error('Enter a first and last name.');
      const name = `${first} ${last}`.replace(/\s+/g, ' ');
      let found = false;
      await save(current => {
        found = exactLabPatientMatches(current.patients, name).length > 0;
        return found ? current : createLabPatient(current, name, today, newId(), newId());
      });
      if (input.current) {
        changeQuery(found ? name : '');
        setDuplicate(found);
        focusSearch();
      }
      return found ? undefined : labDone(name);
    });
  }

  return <details className="panel lab-missing" open={expanded}
    onToggle={event => { if (event.currentTarget.open !== expanded) setExpanded(event.currentTarget.open); }}>
    <summary><span className="lab-icon lab-icon-blue"><Plus size={20} aria-hidden /></span>
      <span><strong>{t('Add Missing Patients / LabCheck Tasks')}</strong><small>{t('Optional · For cases already in the drawer')}</small></span>
      <CaretDown size={17} aria-hidden />
    </summary>
    <div className="lab-missing-body">
      <form onSubmit={search} className="lab-search">
        <Field label={t('Patient name')}><input ref={input} type="search" autoComplete="off" maxLength={255} placeholder={t('First and last name')}
          value={query} disabled={busy} onChange={event => changeQuery(event.target.value)} /></Field>
        <button type="submit" className="button secondary" disabled={busy || !hasName}>{t('Find')}</button>
      </form>
      {duplicate && <p className="form-error" role="alert">{t('This name is already in the patient list. Choose the matching record below.')}</p>}
      {review && <LabReturnReview key={selectedPatient.id} review={review} patient={selectedPatient} today={today} card={reviewCard} busy={busy}
        onCancel={() => { setSearch({ query }); focusSearch(); }} onAdd={title => addAnotherReturn(selectedPatient, title)}
        onConfirmPending={job => completePending(selectedPatient, job)} />}
      {matches.length > 0 && !create && !review && <div className="lab-matches" ref={results} aria-label={t('Matching patients')}>
        {matches.map(patient => {
          const patientReview = reviews.get(patient.id);
          const label = patientReview ? (patientReview.recordedToday ? 'Already recorded today' : 'Review previous return')
            : pendingIds.has(patient.id) ? 'Complete pending LabCheck' : 'Add a completed LabCheck';
          const phone = patient.phone.replace(/\D/g, '').slice(-4);
          return <button key={patient.id} type="button" className="lab-match" disabled={busy} onClick={() => selectPatient(patient)}>
            <span><strong>{patient.name}{phone && <small> · •••• {phone}</small>}</strong>
              <small>{t(label)}</small></span>
            {patientReview ? <CaretRight size={18} aria-hidden /> : <Check size={18} aria-hidden />}
          </button>;
        })}
      </div>}
      {hasName && !matches.length && !create && <p className="muted" role="status">{t('No matching patients.')}</p>}
      {create === 'confirm' && <div className="lab-create">
        <strong>{t('Create a patient record for {name}?', { name: query.trim() })}</strong>
        <p>{t('The LabCheck will be saved as Done on the new record.')}</p>
        <div className="row-actions"><button className="button" type="button" onClick={() => {
          setCreate('form'); requestAnimationFrame(() => firstName.current?.focus());
        }}>{t('Create patient')}</button><button className="text-button" type="button" onClick={() => { setCreate(undefined); focusSearch(); }}>{t('Cancel')}</button></div>
      </div>}
      {create === 'form' && <form className="lab-create" onSubmit={createPatient}>
        <div className="form-grid">
          <Field label={t('First name')}><input ref={firstName} name="first" defaultValue={parts[0]} disabled={busy} maxLength={100} required /></Field>
          <Field label={t('Last name')}><input name="last" defaultValue={parts.slice(1).join(' ')} disabled={busy} maxLength={100} required /></Field>
        </div>
        <div className="row-actions"><button className="button" type="submit" disabled={busy}>{t('Save and mark Done')}</button>
          <button className="text-button" type="button" disabled={busy} onClick={() => { setCreate(undefined); focusSearch(); }}>{t('Cancel')}</button></div>
      </form>}
    </div>
  </details>;
}

export default function DailyLabCheck({ records, today, now, back, save, onClose }: {
  records: Records; today: string; now: Date; back: string; save: Save; onClose: (result: LabResult) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const pending = pendingLabs(records);
  const confirmed = confirmedLabs(records, today);
  const checked = Boolean(labResultToday(records, today));
  const patientFor = (wait: Wait) => records.patients.find(patient => patient.id === wait.patientId);

  async function run(action: () => Promise<string | void>) {
    if (busy) return;
    setBusy(true); setError(''); setStatus('');
    try {
      const message = await action();
      if (message) setStatus(message);
    } catch (failure) { setError(errorMessage(failure, 'Could not save. Try again.')); }
    finally { setBusy(false); }
  }

  return <div className="lab-page">
    <PageHeader title={t('Daily Laboratory Check')} subtitle={titleDate(today)} back={back} />
    <p className="lab-intro muted">{t('Mark the cases that are in the lab drawer as Done.')}</p>
    {checked && <p className="lab-check-status"><Pill tone="green">{t('Checked today')}</Pill></p>}
    <section aria-labelledby="pending-lab-heading">
      <div className="lab-section-heading"><h2 id="pending-lab-heading">{t('Pending LabCheck tasks')}</h2><Pill tone="blue">{pendingLabel(pending.length)}</Pill></div>
      {pending.length ? <ul className="panel lab-list">{pending.map(wait => <CaseRow key={wait.id} wait={wait} patient={patientFor(wait)} busy={busy}
        onDone={() => void run(async () => {
          await save(current => confirmLab(current, wait.id, today));
          const patient = patientFor(wait);
          return patient ? labDone(patient.name) : undefined;
        })} />)}</ul>
        : <div className="panel lab-empty"><CheckCircle size={26} aria-hidden /><p>{t('No pending laboratory cases.')}</p></div>}
    </section>
    <MissingCases records={records} today={today} now={now} busy={busy} run={run} save={save} />
    <p className={status ? 'lab-status' : 'visually-hidden'} role="status">{status}</p>
    {confirmed.length > 0 && <details className="panel lab-confirmed">
      <summary><span className="lab-icon lab-icon-green"><CheckCircle size={21} weight="fill" aria-hidden /></span>
        <strong>{doneLabel(confirmed.length)}</strong><CaretDown size={17} aria-hidden /></summary>
      <ul className="lab-list">{confirmed.map(wait => <CaseRow key={wait.id} wait={wait} patient={patientFor(wait)} />)}</ul>
    </details>}
    <a className="panel lab-widget" href={path(labReturnsRoute)}>
      <span className="lab-icon lab-icon-blue"><Flask size={21} aria-hidden /></span>
      <strong>{t('Jobs returned from lab')}</strong><CaretRight size={16} aria-hidden />
    </a>
    {error && <p className="form-error lab-error" role="alert">{error}</p>}
    {!checked && <div className="lab-actions">
      {!pending.length && <button className="button" type="button" disabled={busy} onClick={() => void run(() => onClose('finished'))}>{t('Finish check')}</button>}
      {!confirmed.length && <button className={`button${pending.length ? '' : ' secondary'}`} type="button" disabled={busy}
        onClick={() => void run(() => onClose('nothing'))}>{t('Nothing arrived')}</button>}
      <button className="button secondary" type="button" disabled={busy} onClick={() => void run(() => onClose('dismissed'))}>{t('Dismiss for today')}</button>
      {pending.length > 0 && <small>{t('Pending cases stay open for the next check.')}</small>}
    </div>}
  </div>;
}
