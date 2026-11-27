import { CalendarBlank, CaretDown, CaretRight, Check, CheckCircle, Flask, Plus, UserCircle, WarningCircle } from '@phosphor-icons/react';
import { useEffect, useRef, useState, type FormEvent, type ReactNode, type Ref } from 'react';
import { ButtonLink, Field, PageHeader, path, Pill, value } from '../../src/components/ui';
import { addDays, formatDate, titleDate } from '../../src/domain/dates';
import { labReturnsRoute, labReturnsView, returnedLabPatients } from '../../src/domain/lab-returns';
import type { Patient, Records, Visit, Wait } from '../../src/domain/model';
import { searchBookingPatients, upcomingVisits } from '../../src/domain/workflows';
import { t } from '../../src/i18n';
import { addNamedLabReturn, addPatient, confirmLab, confirmPatient, confirmedLabs, copy, exactNameMatches, followUpsRoute, labRoute, pendingLabs,
  reopenCheckedLab, returnReviewPatientId, reviewLabReturns, type LabResult } from './state';

export const labTitle = () => copy('Daily Laboratory Check', 'Günlük laboratuvar kontrolü');
const pendingLabel = (count: number) => copy(`${count} pending`, `${count} bekliyor`);
const doneLabel = (count: number) => copy(`${count} done today`, `Bugün ${count} tamamlandı`);
const checkedToday = () => copy('Checked today', 'Bugün kontrol edildi');
const caseTitles: Record<string, string> = {
  'Zirconia bridge': 'Zirkonyum köprü', 'Ceramic crown': 'Seramik kuron', 'Night guard': 'Gece plağı', 'Lab check': 'Laboratuvar kontrolü',
};
const caseTitle = (job: Wait) => copy(job.title, caseTitles[job.title] ?? job.title);

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
      <small>{caseTitle(wait)}</small>
    </div>
    {onDone ? <button type="button" className="button secondary lab-case-action"
      aria-label={copy(`Mark ${patient.name}, ${wait.title} done`, `${patient.name}, ${caseTitles[wait.title] ?? wait.title} tamamlandı olarak işaretle`)}
      onClick={onDone}><Check size={15} weight="bold" aria-hidden />{copy('Done', 'Tamamla')}</button>
      : <Pill tone="green">{copy('Done', 'Tamamlandı')}</Pill>}
  </li>;
}

type Review = { patient: Patient; jobs: Wait[]; pending: Wait[]; sameDay: boolean; appointment?: Visit; ready: boolean };

function ReturnReview({ review, today, card, onCancel, onAdd, onConfirmPending }: {
  review: Review; today: string; card: Ref<HTMLElement>; onCancel: () => void; onAdd: (title?: string) => void;
  onConfirmPending: (job: Wait) => void;
}) {
  const { appointment, jobs, pending, sameDay, ready, patient } = review;
  const [newTitle, setNewTitle] = useState<string>();
  const newJobField = useRef<HTMLInputElement>(null);
  const yesterday = addDays(today, -1);
  const booking = appointment ? { to: `/appointments/${appointment.id}?from=${labReturnsView}`, label: t('Open appointment') }
    : ready ? { to: `/appointments/new?from=${labReturnsView}&patient=${patient.id}`, label: copy('Schedule appointment', 'Randevu planla') }
      : undefined;

  function addAnother() {
    if (!sameDay && !pending.length) {
      onAdd();
      return;
    }
    setNewTitle('');
    requestAnimationFrame(() => newJobField.current?.focus());
  }

  return <section className="lab-return-review" aria-labelledby="lab-return-review-title" tabIndex={-1} ref={card}>
    <h3 id="lab-return-review-title">
      <WarningCircle size={19} weight="fill" aria-hidden />{sameDay ? copy('Already recorded today', 'Bugün zaten kaydedildi')
        : copy('Lab return already recorded', 'Dönüş kaydı zaten var')}
    </h3>
    <dl>
      <div>
        <dt><Flask size={17} aria-hidden />{copy('Recorded return', 'Kayıtlı dönüş')}</dt>
        {jobs.map(job => <dd key={job.id}><strong>{caseTitle(job)}</strong>
          {job.endedOn && <small>{job.endedOn === today && <>{copy('Today', 'Bugün')} · </>}
            {job.endedOn === yesterday && <>{copy('Yesterday', 'Dün')} · </>}
            <time dateTime={job.endedOn}>{formatDate(job.endedOn, { day: 'numeric', month: 'long' })}</time>
          </small>}</dd>)}
      </div>
      {(appointment || ready) && <div>
        <dt><CalendarBlank size={17} aria-hidden />{appointment ? copy('Booked appointment', 'Planlanan randevu') : t('Ready to book')}</dt>
        {appointment ? <dd><strong>{titleDate(appointment.date)} · {appointment.start}</strong><small>{appointment.title}</small></dd>
          : <dd><strong>{copy('No appointment booked', 'Planlanan randevu yok')}</strong></dd>}
      </div>}
    </dl>
    {pending.length > 0 && <div className="lab-return-review-pending">
      <h4>{copy('Pending lab work', 'Bekleyen laboratuvar işleri')}</h4>
      <ul>{pending.map(job => <li key={job.id}><strong>{caseTitle(job)}</strong>
        <button className="button secondary" type="button" aria-label={copy(`Complete ${caseTitle(job)}`, `${caseTitle(job)} tamamla`)}
          onClick={() => onConfirmPending(job)}>{copy('Done', 'Tamamla')}</button></li>)}</ul>
    </div>}
    {newTitle !== undefined && <form className="lab-return-review-form" onSubmit={event => {
      event.preventDefault();
      const title = newTitle.trim();
      if (title) onAdd(title);
    }}>
      <Field label={copy('What arrived?', 'Gelen işin adı')}><input ref={newJobField} required maxLength={255}
        value={newTitle} onChange={event => setNewTitle(event.target.value)} /></Field>
      <button className="button" type="submit" disabled={!newTitle.trim()}>{copy('Save lab return', 'Dönüşü kaydet')}</button>
    </form>}
    <div className="lab-return-review-actions">
      {booking && <ButtonLink to={booking.to}>{booking.label}</ButtonLink>}
      <div className="lab-return-review-secondary">
        <button className="text-button" type="button" onClick={onCancel}>{t('Cancel')}</button>
        {newTitle === undefined && <button className={`button${booking ? ' secondary' : ''}`} type="button" onClick={addAnother}>
          {copy('Add another return', 'Başka dönüş ekle')}
        </button>}
      </div>
    </div>
  </section>;
}

function MissingCases({ records, today, onConfirmed }: { records: Records; today: string; onConfirmed: (name: string, another?: boolean) => void }) {
  const examplePatient = reviewLabReturns ? records.patients.find(patient => patient.id === returnReviewPatientId) : undefined;
  const [query, setQuery] = useState(examplePatient?.name ?? '');
  const [reviewPatientId, setReviewPatientId] = useState(examplePatient?.id);
  const [create, setCreate] = useState<'confirm' | 'form'>();
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const results = useRef<HTMLDivElement>(null);
  const firstName = useRef<HTMLInputElement>(null);
  const reviewCard = useRef<HTMLElement>(null);
  const { patients } = records;
  const matches = searchBookingPatients(patients, query);
  const exact = exactNameMatches(patients, query);
  const parts = query.trim().split(/\s+/).filter(Boolean);
  const hasName = parts.length > 0 && /\p{L}/u.test(query);
  const waiting = pendingLabs(records);
  const doneToday = confirmedLabs(records, today);
  const now = new Date();
  const returns = reviewLabReturns ? returnedLabPatients(records, today, now) : undefined;
  const returned = returns ? [...returns.booked, ...returns.ready, ...returns.blocked] : [];
  const appointments = reviewLabReturns ? upcomingVisits(records, today, now) : [];
  const selectedPatient = patients.find(patient => patient.id === reviewPatientId);
  const review = selectedPatient ? reviewFor(selectedPatient) : undefined;
  const visibleReviewId = review?.patient.id;

  useEffect(() => {
    if (!visibleReviewId) return;
    const frame = requestAnimationFrame(() => reviewCard.current?.scrollIntoView({ block: 'nearest' }));
    return () => cancelAnimationFrame(frame);
  }, [visibleReviewId]);

  function reviewFor(patient: Patient): Review | undefined {
    if (!reviewLabReturns) return undefined;
    const recent = doneToday.filter(wait => wait.patientId === patient.id);
    const previous = returned.find(entry => entry.patient.id === patient.id)?.jobs[0];
    if (!recent.length && !previous) return undefined;
    return { patient, jobs: recent.length ? recent : previous ? [previous] : [], sameDay: recent.length > 0,
      pending: waiting.filter(wait => wait.patientId === patient.id), appointment: appointments.find(visit => visit.patientId === patient.id),
      ready: returns?.ready.some(entry => entry.patient.id === patient.id) ?? false };
  }

  function selectPatient(patient: Patient) {
    if (!reviewFor(patient)) {
      complete(patient);
      return;
    }
    setReviewPatientId(patient.id);
    requestAnimationFrame(() => reviewCard.current?.focus({ preventScroll: true }));
  }

  function complete(patient: Patient, another = false) {
    confirmPatient(patient, today);
    clear(patient.name, another);
  }

  function clear(name: string, another = false) {
    setQuery('');
    setReviewPatientId(undefined);
    setCreate(undefined);
    setError('');
    onConfirmed(name, another);
    input.current?.focus();
  }

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (exact.length === 1) selectPatient(exact[0]);
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

  return <details className="panel lab-missing" open={reviewLabReturns}>
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
            setReviewPatientId(undefined);
            setCreate(undefined);
            setError('');
          }} /></Field>
        <button type="submit" className="button secondary" disabled={!hasName}>{copy('Find', 'Bul')}</button>
      </form>
      {error && <p className="form-error" role="alert">{error}</p>}
      {review && <ReturnReview key={review.patient.id} review={review} today={today} card={reviewCard} onAdd={title => {
        if (title) {
          addNamedLabReturn(review.patient, today, title);
          clear(review.patient.name, true);
        } else complete(review.patient, true);
      }} onConfirmPending={job => {
        confirmLab(job.id, today);
        clear(review.patient.name, true);
      }} onCancel={() => {
        setReviewPatientId(undefined);
        input.current?.focus();
      }} />}
      {matches.length > 0 && !create && !review && <div className="lab-matches" ref={results} aria-label={copy('Matching patients', 'Eşleşen hastalar')}>
        {(exact.length ? exact : matches).map(patient => {
          const pending = waiting.some(wait => wait.patientId === patient.id);
          const confirmed = doneToday.some(wait => wait.patientId === patient.id);
          const reviewable = reviewFor(patient);
          const label = reviewable?.sameDay ? copy('Already recorded today', 'Bugün zaten kaydedildi')
            : reviewable ? copy('Review previous return', 'Önceki dönüşü incele')
              : pending ? copy('Complete pending LabCheck', 'Bekleyen kontrolü tamamla')
                : confirmed ? copy('Already confirmed today', 'Bugün zaten onaylandı') : copy('Add a completed LabCheck', 'Tamamlanmış kontrol ekle');
          const phone = patient.phone.replace(/\D/g, '').slice(-4);
          return <button key={patient.id} type="button" className="lab-match" onClick={() => selectPatient(patient)}>
            <span><strong>{patient.name}{phone && <small> · •••• {phone}</small>}</strong>
              <small>{label}</small></span>
            {reviewable ? <CaretRight size={18} aria-hidden /> : <Check size={18} aria-hidden />}
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
  function announce(name: string, another = false) {
    setStatus(another ? copy(`${name} · New lab return saved`, `${name} · Yeni laboratuvar dönüşü kaydedildi`)
      : copy(`${name} · LabCheck done`, `${name} · Laboratuvar kontrolü tamamlandı`));
  }

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
      {reviewLabReturns && <a className="panel lab-widget" href={path(labReturnsRoute)}>
        <span className="lab-icon lab-icon-blue"><Flask size={21} aria-hidden /></span>
        <strong>{t('Jobs returned from lab')}</strong><CaretRight size={16} aria-hidden />
      </a>}
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
