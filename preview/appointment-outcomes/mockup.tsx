import {
  ArrowLeft, CalendarBlank, CaretDown, CaretRight, CheckCircle,
  ClipboardText, Clock, ListChecks, ShieldCheck, SquaresFour, UsersThree, WarningCircle, X,
} from '@phosphor-icons/react';
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { z } from 'zod';
import App, { Brand } from '../../src/App';
import { FollowUpList } from '../../src/components/FollowUpList';
import { AgendaEmpty, AlertBadge, Empty, More, navigate, NewVisitLink, path, Pill, Section, VisitList } from '../../src/components/ui';
import { addDays, localDate, titleDate } from '../../src/domain/dates';
import { decodeRecords, slotSchema, type Appointment, type RecordChange, type Records } from '../../src/domain/model';
import {
  activeAlerts, agenda, openTasks, outstandingVisits, planningCandidates, responseReviews, upcomingVisits,
} from '../../src/domain/workflows';
import { getLocale, subscribeLocale, t } from '../../src/i18n';
import { restoreScrollPosition, useAppRoute } from '../../src/navigation';
import AppointmentOutcomes from '../../src/screens/AppointmentOutcomes';
import { TaskList } from '../../src/screens/Tasks';
import { fictionalRecords } from '../../src/storage/fixtures';
import type { Repository } from '../../src/storage/repository';
import AppointmentDetailsMock from './AppointmentDetailsMock';
import { AppointmentBookingMock } from './AppointmentBookingMock';
import { AvailabilityAlertMock, AvailabilitySettingsMock, defaultAvailabilitySettings, type AvailabilitySettings } from './AvailabilityMock';
import { bookingDurationsRoute, BookingDurationSettings, defaultBookingDurations } from './BookingDurationsMock';
import { optimumDemoDurations, optimumDemoNow, optimumDemoRecords } from './BookingOptimumDemo';
import '../../src/theme.css';
import './mockup.css';

type Visit = Extract<Appointment, { kind: 'Visit' }>;

const queueRoute = '/appointment-outcomes';
const previewParams = new URLSearchParams(location.search);
const compactOutcome = previewParams.get('variant') === 'compact';
const optimumDemo = compactOutcome && previewParams.get('scenario') === 'optimum';
const now = optimumDemo ? optimumDemoNow() : new Date();
if (!optimumDemo) now.setHours(15, 15, 0, 0);
const today = localDate(now);
const todayCalendar = optimumDemo ? '/calendar?date=' + today : '/calendar';
const copy = (tr: string, en: string) => getLocale() === 'tr' ? tr : en;
const queueTitle = () => t('Awaiting appointment outcomes');
const agendaStatus = () => copy('Sonuç bekliyor', 'Outcome pending');

function todayAppointmentLink(item: Appointment) {
  return path('/appointments/' + item.id + '?from=today');
}

function appointmentBack(item: Appointment, from: string | null) {
  switch (from) {
    case 'today': return '/today';
    case 'attention': return '/attention';
    case 'appointment-outcomes': return queueRoute;
    case 'attention-outcomes': return queueRoute + '?from=attention';
    case 'calendar': return '/calendar?date=' + item.date;
    case 'availability': return '/availability?date=' + item.date;
    case 'planning': return '/planning';
    case 'calendar-conflicts': return '/calendar-conflicts';
    case 'ignored-calendar-events': return '/ignored-calendar-events';
    default: return item.patientId ? '/patients/' + item.patientId : '/calendar?date=' + item.date;
  }
}

function mockRecords(): Records {
  const records = fictionalRecords(now);
  const extraVisit = (id: string, patientId: string, offset: number, start: string, end: string, title: string): Visit => ({
    id, patientId, date: addDays(today, offset), start, end, title, kind: 'Visit',
    status: 'Scheduled', procedure: '', notes: '', exceptions: [],
  });
  const appointmentTitles = new Map([
    ['demo-1', 'Restorasyon kontrolü'], ['demo-2', 'Rutin muayene'], ['demo-block', 'Öğle arası'],
    ['demo-3', 'Diş temizliği'], ['demo-4', 'Kontrol muayenesi'], ['demo-5', 'Restorasyon kontrolü'],
  ]);
  return {
    ...records,
    appointments: [
      ...records.appointments.flatMap(item => {
        const title = appointmentTitles.get(item.id);
        return title ? [{ ...item, title }] : [];
      }),
      extraVisit('mock-later', 'demo-eli', 0, '16:00', '16:30', 'Kontrol muayenesi'),
      extraVisit('mock-history-1', 'demo-nora', -6, '10:30', '11:15', 'Diş temizliği'),
      extraVisit('mock-history-2', 'demo-jonah', -4, '14:00', '14:45', 'Kontrol muayenesi'),
      extraVisit('mock-history-3', 'demo-ada', -2, '11:00', '12:00', 'İmplant konsültasyonu'),
      extraVisit('mock-history-4', 'demo-mira', -1, '09:00', '09:45', 'Restorasyon kontrolü'),
    ],
    alerts: records.alerts.map(alert => alert.id === 'demo-allergy' ? { ...alert, label: 'Lateks alerjisi' } : alert),
    tasks: [
      { id: 'mock-task-1', patientId: 'demo-nora', title: 'Hazırlık notlarını kontrol et', blocks: true, completedOn: null, notes: '' },
      { id: 'mock-task-2', patientId: null, title: 'Malzemeleri kontrol et', blocks: false, completedOn: null, notes: '' },
      { id: 'mock-task-3', patientId: 'demo-ada', title: 'Laboratuvar işini doğrula', blocks: true, completedOn: null, notes: '' },
    ],
    waits: [
      ...records.waits.filter(wait => wait.id === 'demo-wait').map(wait => ({ ...wait, title: 'Uygunluğu doğrula' })),
      { id: 'mock-wait', patientId: 'demo-nora', title: 'Laboratuvar sonucunu bekle', type: 'Laboratory return', status: 'Waiting',
        blocks: false, startedOn: addDays(today, -3), reviewOn: today, endedOn: null, notes: '' },
    ],
  };
}

const initialRecords = mockRecords();
let records = optimumDemo ? optimumDemoRecords(initialRecords, now) : initialRecords;
const listeners = new Set<() => void>();
const snapshot = () => records;
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
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

const tabs = [
  { route: 'today', label: 'Today', icon: SquaresFour },
  { route: 'patients', label: 'Patients', icon: UsersThree },
  { route: 'calendar', label: 'Calendar', icon: CalendarBlank },
  { route: 'planning', label: 'Planning', icon: ListChecks },
  { route: 'work', label: 'Work', icon: ClipboardText },
] as const;

function OutcomeShortcut({ total, todayCount, from }: { total: number; todayCount: number; from: 'today' | 'attention' }) {
  if (!total) return null;
  const href = path(queueRoute + (from === 'attention' ? '?from=attention' : ''));
  return <a className="outcome-shortcut" href={href}>
    <span className="outcome-shortcut-icon"><ClipboardText size={22} weight="duotone" aria-hidden /></span>
    <span className="outcome-shortcut-copy">
      <strong>{queueTitle()}</strong>
      <small>{copy(`${todayCount} bugün · ${total - todayCount} önceki günlerden`, `${todayCount} today · ${total - todayCount} earlier`)}</small>
    </span>
    <span className="outcome-shortcut-end">
      <span className="outcome-shortcut-count" aria-label={copy(`${total} randevu`, `${total} appointments`)}>{total}</span>
      <CaretRight size={16} weight="bold" aria-hidden />
    </span>
  </a>;
}

function TodayMock({ records, pending, availability, durations }: {
  records: Records; pending: Appointment[]; availability?: AvailabilitySettings; durations: number[];
}) {
  const visits = agenda(records, today);
  const pendingIds = new Set(pending.map(item => item.id));
  const todayCount = visits.filter(item => item.kind === 'Visit' && item.status !== 'Cancelled' && item.status !== 'Postponed').length;
  const ready = planningCandidates(records, today);
  const waits = responseReviews(records, today);
  const upcoming = upcomingVisits(records, today, now).filter(item => item.date > today).slice(0, 3);
  const metrics = [
    { label: 'Visits today', count: todayCount, icon: CalendarBlank, route: todayCalendar },
    { label: 'Ready to book', count: ready.length, icon: ListChecks, route: '/planning' },
    { label: 'Need attention', count: openTasks(records.tasks).length, icon: WarningCircle, route: '/attention' },
  ] as const;
  return <>
    <header className="page-header mock-today-header">
      <div className="page-heading">
        <div><p className="eyebrow">{titleDate(today)}</p><h1 tabIndex={-1}>{t('Today')}</h1></div>
        <NewVisitLink to="/appointments/new?from=today" />
      </div>
    </header>
    <div className="overview-tiles mock-metrics">
      {metrics.map(({ label, count, icon: Icon, route }) => <a className="metric" key={route} href={path(route)}>
        <span className="metric-icon"><Icon aria-hidden /></span>
        <strong>{count}</strong><span>{t(label)}</span>
      </a>)}
    </div>
    <OutcomeShortcut from="today" total={pending.length} todayCount={pending.filter(item => item.date === today).length} />
    {availability && <AvailabilityAlertMock records={records} today={today} readyCount={ready.length} settings={availability} durations={durations} />}
    <Section className="mock-agenda" title={t('Today’s agenda')} action={<More to={todayCalendar}>{t('Calendar')}</More>}>
      {visits.length ? <div className="visit-list mock-agenda-list">
        {visits.map(item => {
          const patient = records.patients.find(patient => patient.id === item.patientId);
          const needsOutcome = pendingIds.has(item.id);
          const block = item.kind === 'Block';
          const status = block ? t('Blocked') : t(item.status);
          return <a className={`visit-row mock-agenda-row${needsOutcome ? ' outcome-pending' : ''}${block ? ' blocked' : ''}`}
            key={item.id} href={todayAppointmentLink(item)}>
            <span className="visit-time"><strong>{item.start}</strong><span>{item.end}</span></span>
            <span className="visit-main">
              <strong>{patient?.name ?? item.title}</strong>
              {patient && <span>{item.title}</span>}
              {patient && activeAlerts(records, patient.id).map(alert => <AlertBadge alert={alert} key={alert.id} />)}
            </span>
            <Pill tone={needsOutcome ? 'amber' : item.status === 'Scheduled' ? 'blue' : item.status === 'Completed' ? 'green' : 'neutral'}>
              {needsOutcome && <Clock size={12} weight="bold" aria-hidden />}
              {needsOutcome ? agendaStatus() : status}
            </Pill>
          </a>;
        })}
      </div> : <AgendaEmpty>{t('No visits or blocked time today.')}</AgendaEmpty>}
    </Section>
    <TaskList tasks={records.tasks} patients={records.patients} today={today} save={save} from="today" />
    <Section title={t('Upcoming visits')}>
      {upcoming.length ? <VisitList records={records} visits={upcoming} dates from="today" /> : <Empty>{t('No upcoming visits after today.')}</Empty>}
    </Section>
    {waits.length > 0 && <details className="panel today-follow-ups">
      <summary><span className="compact-row-icon"><Clock size={18} aria-hidden /></span><strong>{t('Follow-ups')}</strong>
        <Pill>{waits.length}</Pill><CaretDown className="opening-caret" size={16} aria-hidden /></summary>
      <FollowUpList patients={records.patients} today={today} waits={waits} save={save} from="today" />
      <div className="today-follow-ups-footer"><More to="/work?view=responses">{t('All follow-ups')}</More></div>
    </details>}
    <Section title={t('Ready to book')} action={<More to="/planning">{t('Planning')}</More>}>
      <div className="panel">
        {ready.slice(0, 3).map(({ patient }) => <a className="small-row" key={patient.id} href={path('/patients/' + patient.id)}>{patient.name}<CaretRight aria-hidden /></a>)}
        {!ready.length && <Empty>{t('No patients ready to book.')}</Empty>}
      </div>
    </Section>
  </>;
}

function MockBack() {
  return <a className="back mock-back" href={path('/today')}><ArrowLeft size={16} aria-hidden />{t('Today')}</a>;
}

function AttentionMock({ records, pending }: { records: Records; pending: Appointment[] }) {
  const tasks = openTasks(records.tasks);
  const waits = responseReviews(records, today);
  return <>
    <header className="mock-subpage-header">
      <MockBack /><h1 tabIndex={-1}>{t('Needs attention')}</h1>
    </header>
    <OutcomeShortcut from="attention" total={pending.length} todayCount={pending.filter(item => item.date === today).length} />
    <Section className="mock-attention-section" title={t('Open tasks')} action={<More to="/work?view=tasks">{t('All tasks')}</More>}>
      <TaskList tasks={tasks} patients={records.patients} today={today} save={save} from="attention" />
    </Section>
    <Section className="mock-attention-section" title={t('Follow-ups')} action={<More to="/work?view=responses">{t('All follow-ups')}</More>}>
      <FollowUpList patients={records.patients} today={today} waits={waits} save={save} from="attention" />
    </Section>
  </>;
}

function Mockup() {
  const route = useAppRoute();
  const [section, query = ''] = route.split('?');
  const params = new URLSearchParams(query);
  const from = params.get('from');
  const records = useSyncExternalStore(subscribe, snapshot);
  const locale = useSyncExternalStore(subscribeLocale, getLocale);
  const detailId = /^\/appointments\/([^/]+)$/.exec(section)?.[1];
  const detail = detailId && detailId !== 'new' ? records.appointments.find(item => item.id === detailId) : undefined;
  const editId = /^\/appointments\/([^/]+)\/edit$/.exec(section)?.[1];
  const editVisit = records.appointments.find((item): item is Visit => item.id === editId && item.kind === 'Visit');
  const previewBooking = compactOutcome && (section === '/appointments/new' && params.get('kind') !== 'block' || !!editVisit);
  const onMockRoute = section === '/today' || section === '/attention' || section === queueRoute || !!detail;
  const detailBack = detail ? appointmentBack(detail, from) : '';
  const tabPath = detailBack.split(/[/?]/)[1];
  const selectedTab = tabPath === 'availability' || tabPath === 'calendar-conflicts' || tabPath === 'ignored-calendar-events'
    ? 'calendar' : tabPath === 'calendar' || tabPath === 'patients' || tabPath === 'planning' ? tabPath : 'today';
  const main = useRef<HTMLElement>(null);
  const [notice, setNotice] = useState('');
  const [availability, setAvailability] = useState(defaultAvailabilitySettings);
  const [bookingDurations, setBookingDurations] = useState(optimumDemo ? optimumDemoDurations : defaultBookingDurations);
  const pending = outstandingVisits(records, now);

  useLayoutEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 4_500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useLayoutEffect(() => {
    if (onMockRoute || previewBooking) {
      restoreScrollPosition();
      const heading = main.current?.querySelector('h1');
      if (heading) {
        heading.tabIndex = -1;
        heading.focus({ preventScroll: true });
      }
    }
  }, [route, onMockRoute, previewBooking]);

  const noticeElement = <div className={notice ? 'mock-outcome-notice' : 'visually-hidden'} role="status">
    {notice && <><CheckCircle size={18} weight="fill" aria-hidden /><span>{notice}</span>
      <button type="button" aria-label={t('Close')} onClick={() => setNotice('')}><X size={17} aria-hidden /></button></>}
  </div>;

  if (previewBooking) {
    const date = z.iso.date().safeParse(params.get('date')).data;
    const range = slotSchema.safeParse({ date, start: params.get('start'), end: params.get('end') }).data;
    const validRange = range && range.start < range.end ? range : undefined;
    const originQuery = from ? '?from=' + encodeURIComponent(from) : '';
    const patient = records.patients.find(item => item.id === params.get('patient'));
    const newBack = from === 'calendar' || from === 'availability' ? `/${from}${date ? '?date=' + date : ''}`
      : from === 'today' || from === 'planning' || from === 'attention' ? '/' + from
        : patient ? '/patients/' + patient.id : '/calendar';
    return <div className="app-shell booking-shell">
      <main className="main" id="main-content" ref={main} tabIndex={-1}>
        <div className="content" key={route}>
          <AppointmentBookingMock records={records} settings={bookingDurations} now={now} item={editVisit}
            selectedPatient={patient?.id} selectedDate={date} opening={from === 'today' ? validRange : undefined}
            selectedRange={from === 'calendar' ? validRange : undefined}
            back={editVisit ? '/appointments/' + editVisit.id + originQuery : newBack} originQuery={originQuery} save={save} />
        </div>
      </main>
    </div>;
  }

  if (!onMockRoute) return <>
    <App repository={repository} dataPanel={() => {
      if (!compactOutcome) return <p className="empty">{t('Fictional preview')}</p>;
      if (section === bookingDurationsRoute) return <BookingDurationSettings settings={bookingDurations} onSave={setBookingDurations} />;
      return <AvailabilitySettingsMock settings={availability} fromToday={from === 'today'} onSave={setAvailability} />;
    }} />
    {noticeElement}
  </>;

  return <div className="app-shell mock-outcomes">
    <a className="skip" href="#main-content" onClick={event => { event.preventDefault(); main.current?.focus(); }}>{t('Skip to content')}</a>
    <header className="mobile-header"><Brand /><span className="device-status"><ShieldCheck aria-hidden />{t('Fictional preview')}</span></header>
    <aside className="navigation">
      <div className="desktop-brand"><Brand /></div>
      <nav aria-label={t('Main navigation')}>{tabs.map(({ route, label, icon: Icon }) => <a key={route} href={path(route === 'calendar' ? todayCalendar : '/' + route)}
        aria-current={route === selectedTab ? 'page' : undefined}>
        <Icon aria-hidden weight={route === selectedTab ? 'fill' : 'regular'} /><span>{t(label)}</span>
      </a>)}</nav>
      <div className="desktop-status device-status"><ShieldCheck aria-hidden />{t('Fictional preview')}</div>
    </aside>
    <main className="main" id="main-content" ref={main} tabIndex={-1}>
      <div className="content mock-outcomes-content" key={route}>
        {section === '/today' && <TodayMock records={records} pending={pending} durations={bookingDurations.presets}
          availability={compactOutcome ? availability : undefined} />}
        {section === '/attention' && <AttentionMock records={records} pending={pending} />}
        {section === queueRoute && <AppointmentOutcomes records={records} visits={pending} today={today}
          fromAttention={from === 'attention'} />}
        {detail && <AppointmentDetailsMock item={detail} records={records} now={now} back={detailBack} query={query} save={save}
          compactOutcome={compactOutcome} pending={pending.some(item => item.id === detail.id)} onDeleted={() => {
            setNotice(copy('Randevu silindi.', 'Appointment deleted.'));
            navigate(detailBack);
          }} />}
      </div>
    </main>
    {noticeElement}
  </div>;
}

createRoot(document.getElementById('root')!).render(<Mockup />);
