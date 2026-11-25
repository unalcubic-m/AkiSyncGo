import {
  ArrowLeft, ArrowRight, CalendarBlank, CaretDown, CaretRight, ClipboardText, ClockCounterClockwise, CopySimple,
  FileText, FirstAid, ListChecks, Notebook, PencilSimple, Phone, Plus, Warning, type Icon,
} from '@phosphor-icons/react';
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { FollowUpList } from '../components/FollowUpList';
import { AlertBadge, ButtonLink, Empty, More, NewVisitLink, path, Pill, VisitList } from '../components/ui';
import { formatDate } from '../domain/dates';
import type { Appointment, Encounter, Patient, RecordChange, Records, Visit } from '../domain/model';
import { activeAlerts, openTasks } from '../domain/workflows';
import { t } from '../i18n';
import { useRouteField } from '../navigation';
import { copyPatientPhone } from '../platform/clipboard';
import { NoteEditor } from './PatientForms';
import { TaskList } from './Tasks';
import './patient-profile.css';

type Save = (change: RecordChange) => Promise<void>;
type HistoryEntry = { kind: 'note'; item: Encounter } | { kind: 'visit'; item: Visit };
const tabs = [
  { id: 'overview', label: 'Overview' },
  { id: 'history', label: 'History' },
  { id: 'follow-up', label: 'Follow-up' },
] as const;
type ProfileTab = typeof tabs[number]['id'];
type NoteState = { mode: 'idle' | 'editing' | 'cancelled' } | { mode: 'saved'; id: string };

function ContactDetails({ patient }: { patient: Patient }) {
  const [feedback, setFeedback] = useState('');
  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => setFeedback(''), 2200);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  async function copyPhone() {
    try {
      await copyPatientPhone(patient.phone);
      setFeedback(t('Copied'));
    } catch {
      setFeedback(t('Could not copy'));
    }
  }

  return <div className="patient-profile-contact">
    {patient.phone && <button type="button" className="patient-profile-phone" onClick={() => void copyPhone()}
      aria-label={t('Copy patient phone {number}', { number: patient.phone })}>
      <Phone size={16} aria-hidden /><span dir="ltr">{patient.phone}</span><CopySimple size={15} aria-hidden />
    </button>}
    {patient.email && <span className="patient-profile-email">{patient.email}</span>}
    {!patient.phone && !patient.email && <small>{t('No contact details')}</small>}
    <span role="status" className={feedback ? 'patient-profile-copy-feedback' : 'visually-hidden'}>{feedback}</span>
  </div>;
}

function ProfileHistory({ entries, patientHref, pendingIds, detailed = false, expandedNote, expandedNoteRef }: {
  entries: HistoryEntry[]; patientHref: string; pendingIds: ReadonlySet<string>; detailed?: boolean; expandedNote?: string;
  expandedNoteRef?: RefObject<HTMLDetailsElement | null>;
}) {
  if (!entries.length) return <div className="panel"><Empty>{t('No history yet.')}</Empty></div>;
  return <ul className="panel patient-profile-history">
    {entries.map(entry => {
      const { kind, item } = entry;
      const isNote = kind === 'note';
      const noteHref = patientHref + '/notes/' + item.id;
      const status = isNote ? t('Note') : pendingIds.has(item.id) ? t('Outcome pending') : t(entry.item.status);
      const row = <>
        <span className={'patient-profile-history-icon ' + (isNote ? 'note' : 'visit')}>
          {isNote ? <FileText size={18} aria-hidden /> : <CalendarBlank size={18} aria-hidden />}
        </span>
        <span className="patient-profile-history-text">
          <strong>{isNote ? item.title || t('Encounter note') : item.title}</strong>
          <small><time dateTime={item.date}>{formatDate(item.date, detailed ? { day: 'numeric', month: 'short', year: 'numeric' } : undefined)}</time> · {status}</small>
        </span>
      </>;
      return <li key={kind + item.id}>
        {detailed && kind === 'note' ? <article>
          <details className="patient-profile-note" open={expandedNote === item.id} ref={expandedNote === item.id ? expandedNoteRef : undefined}>
            <summary className="patient-profile-history-row">{row}<CaretDown size={15} aria-hidden /></summary>
            <div className="patient-profile-note-body">
              {item.type !== 'Other' && <small>{t(item.type)}</small>}
              <p className="preserve">{item.body}</p>
              {item.nextPlan && <p className="preserve"><strong>{t('Next plan')}</strong> {item.nextPlan}</p>}
              <div className="row-actions">
                <More to={noteHref}>{t('Edit')}</More>
                {item.appointmentId && <More to={'/appointments/' + item.appointmentId}>{t('Linked appointment')}</More>}
              </div>
            </div>
          </details>
        </article> : <a href={path(isNote ? noteHref : '/appointments/' + item.id)} className="patient-profile-history-row">
          {row}<CaretRight size={15} aria-hidden />
        </a>}
      </li>;
    })}
  </ul>;
}

function NextAppointment({ visits, records }: { visits: Visit[]; records: Records }) {
  const [next, ...other] = visits;
  return <section className="patient-profile-section">
    <h2>{t('Next appointment')}</h2>
    {next ? <>
      <a href={path('/appointments/' + next.id)} className="patient-profile-next">
        <time className="patient-profile-date" dateTime={next.date}>
          <strong>{formatDate(next.date, { day: 'numeric' })}</strong>
          <span>{formatDate(next.date, { month: 'short' })}</span>
        </time>
        <span className="patient-profile-next-text">
          <strong>{next.title}</strong>
          <small>{next.start}–{next.end} · {t(next.status)}</small>
        </span>
        <CaretRight size={17} weight="bold" aria-hidden />
      </a>
      {other.length > 0 && <ProfileGroup id="upcoming" name={t('Other appointments')} icon={CalendarBlank} count={other.length} startClosed>
        <VisitList records={records} visits={other} dates />
      </ProfileGroup>}
    </> : <div className="panel"><Empty>{t('No upcoming appointments.')}</Empty></div>}
  </section>;
}

function PatientSummary({ patient, href }: { patient: Patient; href: string }) {
  return <section className="patient-profile-section">
    <div className="patient-profile-section-heading">
      <h2>{t('Clinical summary')}</h2>
      <a href={path(href + '/memory')} className="patient-profile-text-link" aria-label={t('Edit patient memory')}>
        {t('Edit')}<ArrowRight size={15} aria-hidden />
      </a>
    </div>
    {(patient.summary || patient.nextAction) ? <div className="panel patient-profile-summary">
      {patient.summary && <p className="preserve">{patient.summary}</p>}
      {patient.nextAction && <div className="patient-profile-next-step">
        <ArrowRight size={16} weight="bold" aria-hidden /><div><strong>{t('Next action')}</strong><p className="preserve">{patient.nextAction}</p></div>
      </div>}
    </div> : <div className="panel"><Empty>{t('No clinical summary.')}</Empty></div>}
  </section>;
}

function ProfileGroup({ id, name, icon: Icon, count, startClosed = false, children }: {
  id: string; name: string; icon: Icon; count: number; startClosed?: boolean; children: ReactNode;
}) {
  const [expanded, setExpanded] = useRouteField<boolean | undefined>('profileGroup-' + id, undefined);
  const open = expanded ?? (!startClosed && count > 0);
  return <details className="panel patient-profile-group" open={open} onToggle={event => {
    if (event.currentTarget.open !== open) setExpanded(event.currentTarget.open);
  }}>
    <summary><Icon size={19} aria-hidden /><strong>{name}</strong>
      {count > 0 && <Pill>{count}</Pill>}<CaretDown size={16} aria-hidden /></summary>
    <div className="patient-profile-group-content">{children}</div>
  </details>;
}

function FollowUpPanel({ patient, records, href, today, save }: { patient: Patient; records: Records; href: string; today: string; save: Save }) {
  const tasks = records.tasks.filter(task => task.patientId === patient.id);
  const waits = records.waits.filter(wait => wait.patientId === patient.id);
  const treatments = records.treatments.filter(treatment => treatment.patientId === patient.id)
    .sort((a, b) => a.status.localeCompare(b.status) || b.startedOn.localeCompare(a.startedOn));
  const active = activeAlerts(records, patient.id);
  const alerts = [...active, ...records.alerts.filter(alert => alert.patientId === patient.id && !alert.active)];
  return <div className="patient-profile-follow-up">
    <ProfileGroup id="tasks" name={t('Tasks')} icon={ListChecks} count={openTasks(tasks).length}>
      <TaskList tasks={tasks} today={today} save={save} from="patient" history />
      <ButtonLink to={'/tasks/new?from=patient&patient=' + patient.id} icon={Plus} secondary>{t('Add task')}</ButtonLink>
    </ProfileGroup>
    <ProfileGroup id="follow-ups" name={t('Follow-ups')} icon={ClipboardText} count={waits.filter(wait => wait.status === 'Waiting').length}>
      <FollowUpList waits={waits} patients={[patient]} today={today} save={save} from="patient" />
      <div className="row-actions">
        <ButtonLink to={href + '/responses/new'} icon={Plus} secondary>{t('Add follow-up')}</ButtonLink>
        <ButtonLink to={href + '/responses/new?preset=lab'} secondary>{t('Add lab check')}</ButtonLink>
      </div>
    </ProfileGroup>
    <ProfileGroup id="treatments" name={t('Treatments')} icon={FirstAid} count={treatments.filter(item => item.status === 'Active').length}>
      <div className="panel">
        {treatments.map(item => <article className="record-row" key={item.id}>
          <div className="row-heading"><strong>{item.title}</strong><Pill tone={item.status === 'Active' ? 'green' : 'neutral'}>{t(item.status)}</Pill></div>
          <p>{t('Started {date}', { date: formatDate(item.startedOn, { day: 'numeric', month: 'short', year: 'numeric' }) })}</p>
          {item.closedOn && <p>{t('Closed {date}', { date: formatDate(item.closedOn, { day: 'numeric', month: 'short', year: 'numeric' }) })}</p>}
          {item.closureNote && <p>{item.closureNote}</p>}
          <div className="row-actions">
            <More to={href + '/treatments/' + item.id}>{t('Edit')}</More>
            {item.status === 'Active' && <More to={href + '/treatments/' + item.id + '/close'}>{t('Close treatment')}</More>}
          </div>
        </article>)}
        {!treatments.length && <Empty>{t('No treatments recorded.')}</Empty>}
      </div>
      <ButtonLink to={href + '/treatments/new'} icon={Plus} secondary>{t('Add treatment')}</ButtonLink>
    </ProfileGroup>
    <ProfileGroup id="alerts" name={t('Clinical alerts')} icon={Warning} count={active.length}>
      <div className="panel">
        {alerts.map(item => <article className="record-row" key={item.id}>
          <div className="row-heading"><AlertBadge alert={item} /><More to={href + '/alerts/' + item.id}>{t('Edit')}</More></div>
          <p>{t(item.type)}{!item.active && ' · ' + t('Inactive')}</p>
          {item.notes && <p>{item.notes}</p>}
        </article>)}
        {!alerts.length && <Empty>{t('No clinical alerts.')}</Empty>}
      </div>
      <ButtonLink to={href + '/alerts/new'} icon={Plus} secondary>{t('Add alert')}</ButtonLink>
    </ProfileGroup>
  </div>;
}

export default function PatientDetail({ records, patient, today, upcoming, outstanding, focusedNote, save }: {
  records: Records; patient: Patient; today: string; upcoming: Appointment[]; outstanding: Visit[]; focusedNote?: string; save: Save;
}) {
  const [tab, setTab] = useRouteField<ProfileTab>('patientProfileTab', focusedNote ? 'history' : 'overview');
  const [noteState, setNoteState] = useState<NoteState>({ mode: 'idle' });
  const addNote = useRef<HTMLButtonElement>(null);
  const tabBar = useRef<HTMLDivElement>(null);
  const expandedNoteRef = useRef<HTMLDetailsElement>(null);
  const addingNote = noteState.mode === 'editing';
  const href = '/patients/' + patient.id;
  const initials = patient.name.split(/\s+/).slice(0, 2).map(word => [...word][0]).join('');
  const alerts = activeAlerts(records, patient.id);
  const visits = upcoming.filter((item): item is Visit => item.kind === 'Visit' && item.patientId === patient.id);
  const upcomingIds = new Set(visits.map(item => item.id));
  const pendingIds = new Set(outstanding.filter(item => item.patientId === patient.id).map(item => item.id));
  const notes = records.notes.filter(item => item.patientId === patient.id).reverse();
  const history: HistoryEntry[] = [
    ...notes.map(item => ({ kind: 'note' as const, item })),
    ...records.appointments.flatMap(item => item.kind === 'Visit' && item.patientId === patient.id && !upcomingIds.has(item.id)
      ? [{ kind: 'visit' as const, item }] : []),
  ];
  history.sort((a, b) => b.item.date.localeCompare(a.item.date)
    || (a.kind === 'visit' && b.kind === 'visit' ? b.item.start.localeCompare(a.item.start) : 0));

  useEffect(() => {
    if (noteState.mode === 'saved' || noteState.mode === 'cancelled') addNote.current?.focus({ preventScroll: true });
  }, [noteState]);

  useEffect(() => {
    if (!focusedNote) return;
    const frame = requestAnimationFrame(() => {
      const summary = expandedNoteRef.current?.querySelector('summary');
      summary?.focus({ preventScroll: true });
      summary?.scrollIntoView({ block: 'center' });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusedNote]);

  function focusTab(next: ProfileTab) {
    setTab(next);
    tabBar.current?.querySelector<HTMLButtonElement>('#patient-tab-' + next)?.focus();
  }

  function navigateTabs(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const destinations: Record<string, number> = {
      ArrowLeft: (index + tabs.length - 1) % tabs.length, ArrowRight: (index + 1) % tabs.length, Home: 0, End: tabs.length - 1,
    };
    const next = destinations[event.key];
    if (next === undefined) return;
    event.preventDefault();
    focusTab(tabs[next].id);
  }

  return <div className="patient-profile">
    <div className="patient-profile-top">
      <a className="back patient-profile-back" href={path('/patients')}><ArrowLeft size={17} aria-hidden />{t('Back')}</a>
      <a className="patient-profile-text-link" href={path(href + '/edit')} aria-label={t('Edit patient')}>
        <PencilSimple size={17} aria-hidden />{t('Edit')}
      </a>
    </div>
    <header className="panel patient-profile-identity">
      <div className="patient-profile-person">
        <span className="patient-profile-avatar" aria-hidden>{initials}</span>
        <div>
          <h1 tabIndex={-1}>{patient.name}</h1>
          <div className="badges">
            <Pill tone={patient.status === 'Active' ? 'green' : 'neutral'}>{t(patient.status)}</Pill>
            {patient.priority !== 'Normal' && <Pill tone="amber">{t('{priority} priority', { priority: t(patient.priority) })}</Pill>}
          </div>
        </div>
      </div>
      <ContactDetails patient={patient} />
      {patient.priorityNote && <p className="patient-profile-priority preserve">{patient.priorityNote}</p>}
    </header>
    {alerts.length > 0 && <ul className="patient-profile-alerts" aria-label={t('Clinical alerts')}>
      {alerts.map(alert => <li key={alert.id}>
        <a className={'patient-profile-alert ' + alert.severity.toLowerCase()} href={path(href + '/alerts/' + alert.id)}>
          <Warning size={19} weight="duotone" aria-hidden />
          <span><strong>{alert.label}</strong><small>{t(alert.severity)} · {t(alert.type)}</small></span>
          <CaretRight size={15} aria-hidden />
        </a>
      </li>)}
    </ul>}
    <div className="patient-profile-actions">
      <NewVisitLink to={'/appointments/new?patient=' + patient.id} />
      <button ref={addNote} type="button" className="button secondary" aria-expanded={addingNote && tab === 'history'}
        onClick={() => { setTab('history'); setNoteState({ mode: 'editing' }); }}>
        <Notebook aria-hidden />{t('Add note')}
      </button>
    </div>
    <div className="patient-profile-tabs" role="tablist" aria-label={t('Patient record')} ref={tabBar}>
      {tabs.map(({ id, label }, index) => <button type="button" role="tab" id={'patient-tab-' + id} key={id}
        aria-selected={tab === id} aria-controls={'patient-panel-' + id} tabIndex={tab === id ? 0 : -1}
        onClick={() => setTab(id)} onKeyDown={event => navigateTabs(event, index)}>{t(label)}</button>)}
    </div>
    <div id="patient-panel-overview" role="tabpanel" aria-labelledby="patient-tab-overview" hidden={tab !== 'overview'}>
      {tab === 'overview' && <>
        <NextAppointment visits={visits} records={records} />
        <PatientSummary patient={patient} href={href} />
        <section className="patient-profile-section">
          <div className="patient-profile-section-heading">
            <h2>{t('Recent activity')}</h2>
            {history.length > 0 && <button type="button" className="patient-profile-text-link" onClick={() => focusTab('history')}>
              {t('View history')}<ArrowRight size={15} aria-hidden />
            </button>}
          </div>
          <ProfileHistory entries={history.slice(0, 2)} patientHref={href} pendingIds={pendingIds} />
        </section>
      </>}
    </div>
    <div id="patient-panel-history" role="tabpanel" aria-labelledby="patient-tab-history" hidden={tab !== 'history'}>
      {(tab === 'history' || addingNote) && <section className="patient-profile-section">
        <h2><ClockCounterClockwise size={19} aria-hidden />{t('History')}</h2>
        <p role="status" className="save-status history-note-status">{noteState.mode === 'saved' ? t('Note saved.') : ''}</p>
        {addingNote && <div className="history-note-editor">
          <NoteEditor records={records} patient={patient} today={today} save={save} inline
            cancel={() => setNoteState({ mode: 'cancelled' })} onSaved={note => setNoteState({ mode: 'saved', id: note.id })} />
        </div>}
        {(history.length > 0 || !addingNote) && <ProfileHistory entries={history} patientHref={href} pendingIds={pendingIds}
          detailed expandedNote={noteState.mode === 'saved' ? noteState.id : focusedNote} expandedNoteRef={expandedNoteRef} />}
      </section>}
    </div>
    <div id="patient-panel-follow-up" role="tabpanel" aria-labelledby="patient-tab-follow-up" hidden={tab !== 'follow-up'}>
      {tab === 'follow-up' && <FollowUpPanel patient={patient} records={records} href={href} today={today} save={save} />}
    </div>
  </div>;
}
