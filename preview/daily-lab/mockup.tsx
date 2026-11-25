import { Bell, CalendarBlank, CaretRight, CheckCircle, ClipboardText, ListChecks, ShieldCheck, SquaresFour, UsersThree, WarningCircle, X } from '@phosphor-icons/react';
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App, { Brand } from '../../src/App';
import { AgendaEmpty, More, NewVisitLink, PageHeader, path, Section, VisitList } from '../../src/components/ui';
import { parseDate, titleDate } from '../../src/domain/dates';
import type { Records } from '../../src/domain/model';
import { agenda, outstandingVisits, planningCandidates, responseReviews, upcomingVisits } from '../../src/domain/workflows';
import { getLocale, subscribeLocale, t } from '../../src/i18n';
import { finishRoute, restoreScrollPosition, useAppRoute } from '../../src/navigation';
import { OutcomeShortcut } from '../../src/screens/AppointmentOutcomes';
import { Planning } from '../../src/screens/Operations';
import { Work } from '../../src/screens/Work';
import { Laboratory, labResultLabel, labTitle, LabWidget } from './Laboratory';
import { AvailabilityOptions, CalendarBuffer, Notifications, Settings } from './Settings';
import { SlotPicker } from './SlotPicker';
import { WorkFollowUps } from './WorkFollowUps';
import { bookingRoute, bufferRoute, copy, followUpsRoute, labRoute, notificationsRoute, pendingLabs, previewDate, reopenCheckedLab, repository, setCheck, snapshot, subscribe } from './state';
import '../../src/theme.css';
import './mockup.css';

const tabs = [
  { route: 'today', label: 'Today', icon: SquaresFour },
  { route: 'patients', label: 'Patients', icon: UsersThree },
  { route: 'calendar', label: 'Calendar', icon: CalendarBlank },
  { route: 'planning', label: 'Planning', icon: ListChecks },
  { route: 'work', label: 'Work', icon: ClipboardText },
] as const;

function Today({ today, records, checked }: { today: string; records: Records; checked: boolean }) {
  const now = new Date();
  const visits = agenda(records, today);
  const ready = planningCandidates(records, today);
  const pending = pendingLabs(records);
  const followUps = responseReviews(records, today);
  const outstanding = outstandingVisits(records, now);
  const upcoming = upcomingVisits(records, today, now).filter(item => item.date > today).slice(0, 3);
  const metrics = [
    { label: 'Visits today', count: visits.filter(item => item.kind === 'Visit' && !['Cancelled', 'Postponed'].includes(item.status)).length, icon: CalendarBlank, to: '/calendar' },
    { label: 'Ready to book', count: ready.length, icon: ListChecks, to: '/planning' },
    { label: 'Need attention', count: followUps.length + records.tasks.filter(task => !task.completedOn).length, icon: WarningCircle, to: '/attention' },
  ] as const;
  return <>
    <PageHeader title={t('Today')} subtitle={titleDate(today)} action={<NewVisitLink to={bookingRoute} />} />
    <div className="overview-tiles">{metrics.map(({ label, count, icon: Icon, to }) => <a className="metric" href={path(to)} key={to}>
      <div className="metric-icon"><Icon aria-hidden /></div><strong>{count}</strong><span>{t(label)}</span>
    </a>)}</div>
    {!checked && <LabWidget pending={pending.length} />}
    <OutcomeShortcut visits={outstanding} today={today} />
    <Section className="today-agenda" title={t('Today’s agenda')} action={<More to="/calendar">{t('Calendar')}</More>}>
      {visits.length ? <VisitList records={records} visits={visits} alerts from="today"
        pendingOutcomeIds={new Set(outstanding.filter(visit => visit.date === today).map(visit => visit.id))} />
        : <AgendaEmpty>{t('No visits or blocked time today.')}</AgendaEmpty>}
    </Section>
    {upcoming.length > 0 && <Section title={t('Upcoming visits')}><VisitList records={records} visits={upcoming} dates from="today" /></Section>}
  </>;
}

function NotificationPreview({ time, enabled, scheduledToday, checked }: { time: string; enabled: boolean; scheduledToday: boolean; checked: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const emptyMessage = checked ? copy('There are no more laboratory reminders today.', 'Bugün başka laboratuvar hatırlatması yok.')
    : !enabled ? copy('Daily laboratory check notifications are off.', 'Günlük laboratuvar kontrolü bildirimleri kapalı.')
    : copy('No laboratory notification is scheduled for today.', 'Bugün için laboratuvar bildirimi planlanmadı.');
  return <>
    <button type="button" className="icon-button lab-notification-trigger" aria-haspopup="dialog"
      aria-label={copy('Preview notification', 'Bildirimi önizle')} onClick={() => dialog.current?.showModal()}><Bell size={21} aria-hidden /></button>
    <dialog ref={dialog} className="lab-notification-dialog" aria-labelledby="lab-notification-heading">
      <header><h2 id="lab-notification-heading">{copy('Notification preview', 'Bildirim önizlemesi')}</h2>
        <button type="button" className="icon-button" aria-label={t('Close')} onClick={() => dialog.current?.close()}><X size={20} aria-hidden /></button></header>
      {enabled && scheduledToday && !checked ? <a href={path(labRoute)} className="panel lab-notification" onClick={() => dialog.current?.close()}>
        <span className="lab-icon lab-icon-blue"><Bell size={18} aria-hidden /></span>
        <span><small>AkiSync Go · <time>{time}</time></small><strong>{labTitle()}</strong>
          <small>{copy('Check whether any laboratory work has arrived.', 'Laboratuvar işlerinin ulaşıp ulaşmadığını kontrol et.')}</small></span>
        <CaretRight size={16} aria-hidden />
      </a> : <p className="padded muted">{emptyMessage}</p>}
    </dialog>
  </>;
}

function Mockup() {
  const route = useAppRoute();
  const [screen, query] = route.split('?');
  const params = new URLSearchParams(query);
  const locale = useSyncExternalStore(subscribeLocale, getLocale);
  const { records, check, notification, buffer } = useSyncExternalStore(subscribe, snapshot);
  const [today, setToday] = useState(previewDate);
  const [notice, setNotice] = useState('');
  const main = useRef<HTMLElement>(null);
  const closed = check?.date === today ? check.result : undefined;
  const labScheduledToday = notification.days.includes(parseDate(today).getDay());
  const newAppointment = screen === '/appointments/new';
  const booking = !reopenCheckedLab && newAppointment && !params.has('kind') && !params.has('date');
  const planning = reopenCheckedLab && screen === '/planning';
  const labFromFollowUps = screen === labRoute && params.get('from') === 'responses';
  const selectedTab = planning ? 'planning'
    : screen === '/today' || screen === labRoute && !labFromFollowUps ? 'today' : 'work';

  useLayoutEffect(() => { document.documentElement.lang = locale; }, [locale]);
  useLayoutEffect(() => {
    if (!main.current) return;
    restoreScrollPosition();
    const heading = main.current.querySelector('h1');
    if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
  }, [route]);
  useEffect(() => {
    const tick = () => setToday(previewDate());
    const timer = window.setInterval(tick, 15_000);
    window.addEventListener('focus', tick);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', tick);
      document.removeEventListener('visibilitychange', tick);
    };
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 4500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  let body: ReactNode;
  if (screen === '/today') body = <Today today={today} records={records} checked={!!closed} />;
  else if (planning) body = <Planning records={records} today={today} now={new Date()} labOnly={params.get('view') === 'lab-returns'} />;
  else if (screen === labRoute) body = <Laboratory key={today} records={records} today={today} closed={closed}
    fromFollowUps={labFromFollowUps} onClose={result => {
      setCheck(today, result);
      setNotice(labResultLabel(result));
      finishRoute(labFromFollowUps ? followUpsRoute : '/today');
    }} />;
  else if (screen === '/work' && params.get('view') === 'responses') body = <WorkFollowUps records={records} today={today} result={closed} />;
  else if (screen === '/work') body = <Work records={records} today={today} save={async change => { await repository.update(change); }} native view={params.get('view')} />;
  else if (screen === '/data') body = <Settings notification={notification} buffer={buffer} />;
  else if (screen === notificationsRoute) body = <Notifications notification={notification} records={records} />;
  else if (screen === bufferRoute) body = <CalendarBuffer buffer={buffer} />;
  else if (screen === '/data/availability') body = <AvailabilityOptions records={records} fromNotifications={params.get('from') === 'notifications'} />;
  else if (booking) {
    const from = params.get('from');
    const patient = params.get('patient') ?? undefined;
    const back = from === 'calendar' || from === 'planning' || from === 'attention' ? '/' + from
      : !from && patient ? '/patients/' + patient : '/today';
    body = <SlotPicker records={records} today={today} buffer={buffer} selectedPatient={patient} back={back} onSave={() => {
      setNotice(copy('Fictional appointment saved.', 'Örnek randevu kaydedildi.'));
      finishRoute('/today');
    }} />;
  } else return <App repository={repository} dataPanel={() => <Settings notification={notification} buffer={buffer} />} />;

  return <div className={booking ? 'app-shell booking-shell' : 'app-shell lab-shell'}>
    <a className="skip" href="#main-content" onClick={event => { event.preventDefault(); main.current?.focus(); }}>{t('Skip to content')}</a>
    {!booking && <>
      <header className={planning ? 'mobile-header' : 'mobile-header lab-header'}><Brand /><div className="lab-header-actions">
        <span className="device-status"><ShieldCheck aria-hidden />{t('Fictional preview')}</span>
        {!planning && <NotificationPreview time={notification.time} enabled={notification.enabled} scheduledToday={labScheduledToday} checked={!!closed} />}
      </div></header>
      <aside className="navigation"><div className="desktop-brand"><Brand /></div><nav aria-label={t('Main navigation')}>
        {tabs.map(({ route, label, icon: Icon }) => <a key={route} href={path('/' + route)} aria-current={selectedTab === route ? 'page' : undefined}>
          <Icon weight={selectedTab === route ? 'fill' : 'regular'} aria-hidden /><span>{t(label)}</span></a>)}
      </nav></aside>
    </>}
    <main id="main-content" ref={main} tabIndex={-1} className="main"><div className="content" key={route}>{body}</div></main>
    <div className={notice ? 'appointment-notice' : 'visually-hidden'} role="status">
      {notice && <><CheckCircle size={20} weight="fill" aria-hidden /><span>{notice}</span>
        <button type="button" aria-label={t('Close')} onClick={() => setNotice('')}><X size={18} aria-hidden /></button></>}
    </div>
  </div>;
}

createRoot(document.getElementById('root')!).render(<Mockup />);
