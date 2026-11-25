import {
  ArrowLeft, ArrowRight, CalendarBlank, CaretDown, CaretRight, ClipboardText, ClockCounterClockwise, CopySimple,
  FileText, FirstAid, ListChecks, Notebook, PencilSimple, Phone, Plus, ShieldCheck, SquaresFour, UsersThree, Warning, type Icon,
} from '@phosphor-icons/react';
import { useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App, { Brand } from '../../src/App';
import { FollowUpList } from '../../src/components/FollowUpList';
import { AlertBadge, ButtonLink, Empty, NewVisitLink, path, Pill, VisitList } from '../../src/components/ui';
import { addDays, formatDate, localDate } from '../../src/domain/dates';
import { decodeRecords, type Encounter, type Patient, type RecordChange, type Records, type Visit } from '../../src/domain/model';
import { activeAlerts, openTasks, outstandingVisits, upcomingVisits } from '../../src/domain/workflows';
import { getLocale, subscribeLocale, t } from '../../src/i18n';
import { restoreScrollPosition, useAppRoute, useRouteField } from '../../src/navigation';
import { copyPatientPhone } from '../../src/platform/clipboard';
import { TaskList } from '../../src/screens/Tasks';
import { fictionalRecords } from '../../src/storage/fixtures';
import type { Repository } from '../../src/storage/repository';
import '../../src/theme.css';
import './mockup.css';

const now = new Date();
const today = localDate(now);
const copy = (tr: string, en: string) => getLocale() === 'tr' ? tr : en;

function sampleRecords(): Records {
  const examples = fictionalRecords(now);
  const earlier = addDays(today, -5);
  const next = addDays(today, 2);
  return {
    ...examples,
    patients: examples.patients.map(patient => patient.id === 'demo-eli' ? {
      ...patient,
      summary: copy('Düzenli kontrollerde. Son ziyarette hassasiyet kaydedildi.', 'Attends regular checkups. Sensitivity was noted at the last visit.'),
      nextAction: copy('Kontrolde hassasiyeti yeniden değerlendir.', 'Review sensitivity at the next checkup.'),
    } : patient),
    appointments: examples.appointments.map(item => {
      if (item.id === 'demo-2' && item.kind === 'Visit') {
        return { ...item, date: earlier, status: 'Completed', title: copy('Rutin muayene', 'Routine examination') };
      }
      if (item.id === 'demo-4') return { ...item, date: next, title: copy('Kontrol muayenesi', 'Follow-up exam') };
      return item;
    }),
    notes: [...examples.notes, {
      id: 'profile-eli-note', patientId: 'demo-eli', appointmentId: 'demo-2', date: earlier, type: 'Clinical visit',
      title: copy('Muayene notu', 'Exam note'),
      body: copy('Kontrol sırasında hassasiyet kaydedildi.', 'Sensitivity was recorded during the examination.'),
      nextPlan: copy('Bir sonraki kontrolde yeniden değerlendir.', 'Review at the next checkup.'),
    }],
    alerts: examples.alerts.map(alert => alert.id === 'demo-allergy'
      ? { ...alert, label: copy('Lateks alerjisi', 'Latex allergy') } : alert),
  };
}

let records = decodeRecords(sampleRecords());
const listeners = new Set<() => void>();
const snapshot = () => records;
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
const repository: Repository = {
  async load() { return records; },
  async update(change) {
    records = decodeRecords(change(records));
    listeners.forEach(listener => listener());
    return records;
  },
};
async function save(change: RecordChange) {
  await repository.update(change);
}

const navigation = [
  { route: 'today', label: 'Today', icon: SquaresFour },
  { route: 'patients', label: 'Patients', icon: UsersThree },
  { route: 'calendar', label: 'Calendar', icon: CalendarBlank },
  { route: 'planning', label: 'Planning', icon: ListChecks },
  { route: 'work', label: 'Work', icon: ClipboardText },
] as const;

function ContactDetails({ patient }: { patient: Patient }) {
  const [feedback, setFeedback] = useState('');
  async function copyPhone() {
    try {
      await copyPatientPhone(patient.phone);
      setFeedback(t('Copied'));
    } catch {
      setFeedback(t('Could not copy'));
    }
  }
  return <div className="patient-demo-contact">
    {patient.phone && <button type="button" className="patient-demo-phone" onClick={() => void copyPhone()}
      aria-label={t('Copy patient phone {number}', { number: patient.phone })}>
      <Phone size={16} aria-hidden /><span dir="ltr">{patient.phone}</span><CopySimple size={15} aria-hidden />
    </button>}
    {patient.email && <span className="patient-demo-email">{patient.email}</span>}
    {!patient.phone && !patient.email && <small>{t('No contact details')}</small>}
    <span role="status" className={feedback ? 'contact-feedback' : 'visually-hidden'}>{feedback}</span>
  </div>;
}

type HistoryEntry = { kind: 'note'; item: Encounter } | { kind: 'visit'; item: Visit };

function HistoryList({ entries, patientHref, pendingIds }: {
  entries: HistoryEntry[]; patientHref: string; pendingIds: ReadonlySet<string>;
}) {
  if (!entries.length) return <div className="panel"><Empty>{copy('Henüz geçmiş kayıt yok.', 'No history yet.')}</Empty></div>;
  return <ul className="panel patient-demo-history">
    {entries.map(entry => {
      const { item } = entry;
      const isNote = entry.kind === 'note';
      const title = isNote ? item.title || t('Encounter note') : item.title;
      const target = isNote ? patientHref + '/notes/' + item.id : '/appointments/' + item.id;
      const status = isNote ? t('Note') : pendingIds.has(item.id) ? t('Outcome pending') : t(entry.item.status);
      return <li key={entry.kind + item.id}>
        <a href={path(target)} className="patient-demo-history-row">
          <span className={'patient-demo-history-icon ' + (isNote ? 'note' : 'visit')}>
            {isNote ? <FileText size={18} aria-hidden /> : <CalendarBlank size={18} aria-hidden />}
          </span>
          <span className="patient-demo-history-text">
            <strong>{title}</strong>
            <small><time dateTime={item.date}>{formatDate(item.date)}</time> · {status}</small>
          </span>
          <CaretRight size={15} aria-hidden />
        </a>
      </li>;
    })}
  </ul>;
}

function NextAppointment({ visits, records }: { visits: Visit[]; records: Records }) {
  const [next, ...other] = visits;
  return <section className="patient-demo-section">
    <h2>{copy('Yaklaşan randevu', 'Next appointment')}</h2>
    {next ? <>
      <a href={path('/appointments/' + next.id)} className="patient-demo-next">
        <time className="patient-demo-date" dateTime={next.date}>
          <strong>{formatDate(next.date, { day: 'numeric' })}</strong>
          <span>{formatDate(next.date, { month: 'short' })}</span>
        </time>
        <span className="patient-demo-next-text">
          <strong>{next.title}</strong>
          <small>{next.start}–{next.end} · {t(next.status)}</small>
        </span>
        <CaretRight size={17} weight="bold" aria-hidden />
      </a>
      {other.length > 0 && <details className="panel patient-demo-group">
        <summary><CalendarBlank size={18} aria-hidden /><strong>{copy('Diğer randevular', 'Other appointments')}</strong>
          <Pill>{other.length}</Pill><CaretDown size={16} aria-hidden /></summary>
        <div className="patient-demo-group-content"><VisitList records={records} visits={other} dates /></div>
      </details>}
    </> : <div className="panel"><Empty>{copy('Yaklaşan randevu yok.', 'No upcoming appointments.')}</Empty></div>}
  </section>;
}

function PatientSummary({ patient, href }: { patient: Patient; href: string }) {
  return <section className="patient-demo-section">
    <div className="patient-demo-section-heading">
      <h2>{t('Clinical summary')}</h2>
      <a href={path(href + '/memory')} className="patient-demo-text-link">{t('Edit')}<ArrowRight size={15} aria-hidden /></a>
    </div>
    {(patient.summary || patient.nextAction) ? <div className="panel patient-demo-summary">
      {patient.summary && <p>{patient.summary}</p>}
      {patient.nextAction && <div className="patient-demo-next-step">
        <ArrowRight size={16} weight="bold" aria-hidden /><div><strong>{t('Next action')}</strong><p>{patient.nextAction}</p></div>
      </div>}
    </div> : <div className="panel"><Empty>{t('No clinical summary.')}</Empty></div>}
  </section>;
}

function ProfileGroup({ name, icon: Icon, count, children }: {
  name: string; icon: Icon; count: number; children: ReactNode;
}) {
  return <details className="panel patient-demo-group" open={count > 0}>
    <summary><Icon size={19} aria-hidden /><strong>{name}</strong>
      {count > 0 && <Pill>{count}</Pill>}<CaretDown size={16} aria-hidden /></summary>
    <div className="patient-demo-group-content">{children}</div>
  </details>;
}

function FollowUpPanel({ patient, records, href }: { patient: Patient; records: Records; href: string }) {
  const tasks = records.tasks.filter(task => task.patientId === patient.id);
  const waits = records.waits.filter(wait => wait.patientId === patient.id);
  const treatments = records.treatments.filter(treatment => treatment.patientId === patient.id)
    .sort((a, b) => a.status.localeCompare(b.status) || b.startedOn.localeCompare(a.startedOn));
  const alerts = [...activeAlerts(records, patient.id), ...records.alerts.filter(alert => alert.patientId === patient.id && !alert.active)];
  return <div className="patient-demo-follow-up">
    <ProfileGroup name={t('Tasks')} icon={ListChecks} count={openTasks(tasks).length}>
      <TaskList tasks={tasks} today={today} save={save} from="patient" history />
      <ButtonLink to={'/tasks/new?from=patient&patient=' + patient.id} icon={Plus} secondary>{t('Add task')}</ButtonLink>
    </ProfileGroup>
    <ProfileGroup name={t('Follow-ups')} icon={ClipboardText} count={waits.filter(wait => wait.status === 'Waiting').length}>
      <FollowUpList waits={waits} patients={[patient]} today={today} save={save} from="patient" />
      <div className="row-actions">
        <ButtonLink to={href + '/responses/new'} icon={Plus} secondary>{t('Add follow-up')}</ButtonLink>
        <ButtonLink to={href + '/responses/new?preset=lab'} secondary>{t('Add lab check')}</ButtonLink>
      </div>
    </ProfileGroup>
    <ProfileGroup name={t('Treatments')} icon={FirstAid} count={treatments.filter(item => item.status === 'Active').length}>
      {treatments.length > 0 && <div className="panel">
        {treatments.map(item => <article className="record-row" key={item.id}>
          <div className="row-heading"><strong>{item.title}</strong><Pill tone={item.status === 'Active' ? 'green' : 'neutral'}>{t(item.status)}</Pill></div>
          <small>{t('Started {date}', { date: formatDate(item.startedOn, { day: 'numeric', month: 'short', year: 'numeric' }) })}</small>
          {item.closedOn && <p>{t('Closed {date}', { date: formatDate(item.closedOn) })}</p>}
          {item.closureNote && <p>{item.closureNote}</p>}
          <div className="row-actions">
            <a className="more" href={path(href + '/treatments/' + item.id)}>{t('Edit')}</a>
            {item.status === 'Active' && <a className="more" href={path(href + '/treatments/' + item.id + '/close')}>{t('Close treatment')}</a>}
          </div>
        </article>)}
      </div>}
      <ButtonLink to={href + '/treatments/new'} icon={Plus} secondary>{t('Add treatment')}</ButtonLink>
    </ProfileGroup>
    <ProfileGroup name={t('Clinical alerts')} icon={Warning} count={alerts.filter(item => item.active).length}>
      {alerts.length > 0 && <div className="panel">{alerts.map(item => <article className="record-row" key={item.id}>
        <div className="row-heading">
          <AlertBadge alert={item} /><a className="more" href={path(href + '/alerts/' + item.id)}>{t('Edit')}</a>
        </div>
        <p>{t(item.type)}{!item.active && ' · ' + t('Inactive')}</p>
        {item.notes && <p>{item.notes}</p>}
      </article>)}</div>}
      <ButtonLink to={href + '/alerts/new'} icon={Plus} secondary>{t('Add alert')}</ButtonLink>
    </ProfileGroup>
  </div>;
}

const tabs = ['overview', 'history', 'follow-up'] as const;
type ProfileTab = typeof tabs[number];

function PatientProfile({ patient, records }: { patient: Patient; records: Records }) {
  const [tab, setTab] = useRouteField<ProfileTab>('patientProfileTab', 'overview');
  const tabBar = useRef<HTMLDivElement>(null);
  const href = '/patients/' + patient.id;
  const initials = patient.name.split(/\s+/).slice(0, 2).map(word => [...word][0]).join('');
  const alerts = activeAlerts(records, patient.id);
  const visits = upcomingVisits(records, today, now).filter((visit): visit is Visit => visit.kind === 'Visit' && visit.patientId === patient.id);
  const upcomingIds = new Set(visits.map(visit => visit.id));
  const pendingIds = new Set(outstandingVisits(records, now).map(visit => visit.id));
  const history: HistoryEntry[] = [
    ...records.notes.filter(item => item.patientId === patient.id).reverse().map(item => ({ kind: 'note' as const, item })),
    ...records.appointments.flatMap(item => item.kind === 'Visit' && item.patientId === patient.id && !upcomingIds.has(item.id)
      ? [{ kind: 'visit' as const, item }] : []),
  ];
  history.sort((a, b) => b.item.date.localeCompare(a.item.date)
    || (a.kind === 'visit' && b.kind === 'visit' ? b.item.start.localeCompare(a.item.start) : 0));
  const labels = { overview: copy('Özet', 'Overview'), history: t('History'), 'follow-up': copy('Takip', 'Follow-up') };

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
    focusTab(tabs[next]);
  }

  return <div className="patient-demo-profile">
    <div className="patient-demo-top">
      <a className="patient-demo-back" href={path('/patients')}><ArrowLeft size={17} aria-hidden />{t('Patients')}</a>
      <a className="patient-demo-text-link" href={path(href + '/edit')} aria-label={t('Edit patient')}>
        <PencilSimple size={17} aria-hidden />{t('Edit')}
      </a>
    </div>
    <header className="panel patient-demo-identity">
      <div className="patient-demo-person">
        <span className="patient-demo-avatar" aria-hidden>{initials}</span>
        <div>
          <h1 tabIndex={-1}>{patient.name}</h1>
          <div className="badges">
            <Pill tone={patient.status === 'Active' ? 'green' : 'neutral'}>{t(patient.status)}</Pill>
            {patient.priority !== 'Normal' && <Pill tone="amber">{t('{priority} priority', { priority: t(patient.priority) })}</Pill>}
          </div>
        </div>
      </div>
      <ContactDetails patient={patient} />
      {patient.priorityNote && <p className="patient-demo-priority">{patient.priorityNote}</p>}
    </header>
    {alerts.length > 0 && <ul className="patient-demo-alerts" aria-label={t('Clinical alerts')}>
      {alerts.map(alert => <li key={alert.id}>
        <a className={'patient-demo-alert ' + alert.severity.toLowerCase()} href={path(href + '/alerts/' + alert.id)}>
          <Warning size={19} weight="duotone" aria-hidden />
          <span><strong>{alert.label}</strong><small>{t(alert.severity)} · {t(alert.type)}</small></span>
          <CaretRight size={15} aria-hidden />
        </a>
      </li>)}
    </ul>}
    <div className="patient-demo-actions">
      <NewVisitLink to={'/appointments/new?patient=' + patient.id} />
      <ButtonLink to={href + '/notes/new'} icon={Notebook} secondary>{t('Add note')}</ButtonLink>
    </div>
    <div className="patient-demo-tabs" role="tablist" aria-label={copy('Hasta kaydı', 'Patient record')} ref={tabBar}>
      {tabs.map((item, index) => <button type="button" role="tab" id={'patient-tab-' + item} key={item}
        aria-selected={tab === item} aria-controls="patient-demo-tabpanel" tabIndex={tab === item ? 0 : -1}
        onClick={() => setTab(item)} onKeyDown={event => navigateTabs(event, index)}>{labels[item]}</button>)}
    </div>
    <div id="patient-demo-tabpanel" role="tabpanel" aria-labelledby={'patient-tab-' + tab}>
      {tab === 'overview' && <>
        <NextAppointment visits={visits} records={records} />
        <PatientSummary patient={patient} href={href} />
        <section className="patient-demo-section">
          <div className="patient-demo-section-heading">
            <h2>{copy('Son kayıtlar', 'Recent activity')}</h2>
            {history.length > 0 && <button type="button" className="patient-demo-text-link" onClick={() => focusTab('history')}>
              {copy('Tüm geçmiş', 'View history')}<ArrowRight size={15} aria-hidden />
            </button>}
          </div>
          <HistoryList entries={history.slice(0, 2)} patientHref={href} pendingIds={pendingIds} />
        </section>
      </>}
      {tab === 'history' && <section className="patient-demo-section">
        <h2><ClockCounterClockwise size={19} aria-hidden />{t('History')}</h2>
        <HistoryList entries={history} patientHref={href} pendingIds={pendingIds} />
      </section>}
      {tab === 'follow-up' && <FollowUpPanel patient={patient} records={records} href={href} />}
    </div>
  </div>;
}

function Mockup() {
  const route = useAppRoute();
  const records = useSyncExternalStore(subscribe, snapshot);
  const locale = useSyncExternalStore(subscribeLocale, getLocale);
  const main = useRef<HTMLElement>(null);
  const patientId = /^\/patients\/([^/?]+)(?:\?.*)?$/.exec(route)?.[1];
  const patient = records.patients.find(item => item.id === patientId);
  useLayoutEffect(() => { document.documentElement.lang = locale; }, [locale]);
  useLayoutEffect(() => {
    if (patientId && main.current) {
      restoreScrollPosition();
      main.current.querySelector('h1')?.focus({ preventScroll: true });
    }
  }, [route, patientId]);

  if (!patient) return <App repository={repository} dataPanel={() => <p className="empty">{t('Fictional preview')}</p>} />;

  return <div className="app-shell patient-demo-shell">
    <a className="skip" href="#main-content" onClick={event => { event.preventDefault(); main.current?.focus(); }}>{t('Skip to content')}</a>
    <header className="mobile-header"><Brand /><span className="device-status"><ShieldCheck aria-hidden />{t('Fictional preview')}</span></header>
    <aside className="navigation">
      <div className="desktop-brand"><Brand /></div>
      <nav aria-label={t('Main navigation')}>{navigation.map(({ route, label, icon: Icon }) => <a key={route}
        href={path('/' + route)} aria-current={route === 'patients' ? 'page' : undefined}>
        <Icon aria-hidden weight={route === 'patients' ? 'fill' : 'regular'} /><span>{t(label)}</span>
      </a>)}</nav>
      <div className="desktop-status device-status"><ShieldCheck aria-hidden />{t('Fictional preview')}</div>
    </aside>
    <main className="main" id="main-content" ref={main} tabIndex={-1}>
      <PatientProfile key={route} patient={patient} records={records} />
    </main>
  </div>;
}

createRoot(document.getElementById('root')!).render(<Mockup />);
