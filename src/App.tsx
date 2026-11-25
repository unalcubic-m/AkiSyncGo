import { errorMessage, t, type Message } from './i18n';
import { CalendarBlank, CheckCircle, ClipboardText, ListChecks, Pulse, ShieldCheck, SquaresFour, UsersThree, X } from '@phosphor-icons/react';
import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useDeviceCalendarAccess } from './components/DeviceCalendarAccess';
import { GoogleCalendarPublishing, useGoogleCalendarPublishing } from './components/GoogleCalendarPublishing';
import { ButtonLink, Empty, PageHeader, path } from './components/ui';
import { localDate } from './domain/dates';
import { labFollowUpsRoute, labResultMessage, labRoute } from './domain/daily-lab';
import { labReturnsRoute, labReturnsView } from './domain/lab-returns';
import { z } from 'zod';
import { slotSchema, type Patient, type RecordChange, type Records } from './domain/model';
import { conflictAppointmentIds, pruneScheduleOverlapIgnores, scheduleConflicts } from './domain/schedule-conflicts';
import { deleteAppointment, newlyBookablePatients, outstandingVisits, saveVisitOutcome, upcomingVisits } from './domain/workflows';
import { BookingOffer } from './components/BookingOffer';
import { AppointmentDetail, AppointmentForm } from './screens/Appointment';
import AppointmentDurations from './screens/AppointmentDurations';
import AvailabilitySettings, { CalendarBufferSettings, NotificationSettings } from './screens/AvailabilitySettings';
import DailyLabCheck from './screens/DailyLabCheck';
import AppointmentOutcomes, { outcomeReturnRoutes } from './screens/AppointmentOutcomes';
import Calendar from './screens/Calendar';
import { CalendarConflictBanner, CalendarConflicts, useUpcomingCalendarEvents } from './screens/CalendarConflicts';
import IgnoredEvents from './screens/IgnoredCalendarEvents';
import DeletePatient from './screens/DeletePatient';
import { Attention, Availability, Planning } from './screens/Operations';
import PatientDetail from './screens/PatientDetail';
import { AlertForm, MemoryForm, NoteForm, PatientForm, TreatmentForm, WaitForm } from './screens/PatientForms';
import Patients from './screens/Patients';
import { TaskForm } from './screens/Tasks';
import Today from './screens/Today';
import { ChooseResponsePatient, Work } from './screens/Work';
import { FollowUpDetail, TaskDetail } from './screens/WorkItemDetails';
import type { Repository } from './storage/repository';
import { finishRoute, openRoute, readRoute, restoreScrollPosition, returnToPreviousRoute, useAppRoute } from './navigation';
import './screens/appointment-outcomes.css';

const tabs = [
  { route: 'today', label: 'Today', icon: SquaresFour },
  { route: 'patients', label: 'Patients', icon: UsersThree },
  { route: 'calendar', label: 'Calendar', icon: CalendarBlank },
  { route: 'planning', label: 'Planning', icon: ListChecks },
  { route: 'work', label: 'Work', icon: ClipboardText },
] as const;
const isoDate = z.iso.date();
const workReturnRoutes = new Map([
  ['work', '/work'], ['tasks', '/work?view=tasks'], ['responses', '/work?view=responses'],
  ['today', '/today'], ['attention', '/attention'],
  ['patient-search', '/patients'], [labReturnsView, labReturnsRoute],
]);

export function Brand() {
  return <span className="brand"><span className="brand-icon"><Pulse size={23} aria-hidden /></span><span>AkiSync <span>Go</span></span></span>;
}

export default function App({ repository, native = false, previewStatus = 'Fictional preview', dataPanel }: {
  repository: Repository; native?: boolean; previewStatus?: Message; dataPanel: (actions: {
    refresh: () => Promise<void>; save: (change: RecordChange) => Promise<void>;
    restoreRecords: (records: Records) => Promise<void>;
    records: Records; today: string; calendarPublishing?: ReactNode;
  }) => ReactNode;
}) {
  const route = useAppRoute();
  const [[section, id, sub, relatedId, action], params] = (() => {
    const [pathname, query] = route.split('?');
    return [pathname.split('/').filter(Boolean), new URLSearchParams(query)] as const;
  })();
  const [records, setRecords] = useState<Records>();
  const [bookingOffer, setBookingOffer] = useState<Patient[]>([]);
  const [notice, setNotice] = useState<{ message: Message }>();
  const recordsReady = !!records;
  useLayoutEffect(() => {
    if (recordsReady) restoreScrollPosition();
  }, [route, recordsReady]);
  const [error, setError] = useState('');
  const [now, setNow] = useState(() => new Date());
  const today = localDate(now);
  const calendarAccess = useDeviceCalendarAccess(native && !!records);
  const publishing = useGoogleCalendarPublishing(native, records, today);
  const upcoming = useMemo(() => records ? upcomingVisits(records, today, now) : [], [records, today, now]);
  const outstanding = useMemo(() => records ? outstandingVisits(records, now) : [], [records, now]);
  const deviceEvents = useUpcomingCalendarEvents(calendarAccess, upcoming);
  const conflicts = useMemo(() => records ? scheduleConflicts(records, upcoming, deviceEvents.state === 'ready' ? deviceEvents.events : []) : [],
    [records, upcoming, deviceEvents]);
  const currentConflicts = conflicts.filter(conflict => !conflict.ignored);
  const writing = useRef(false);
  const content = useRef<HTMLElement>(null);

  async function refresh() { setRecords(await repository.load()); }
  useEffect(() => {
    let current = true;
    repository.load().then(next => { if (current) setRecords(next); }, err => { if (current) setError(errorMessage(err, 'Could not open local records.')); });
    return () => { current = false; };
  }, [repository]);
  useEffect(() => {
    const tick = () => setNow(new Date());
    const timer = window.setInterval(tick, 30_000);
    window.addEventListener('focus', tick);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', tick);
      document.removeEventListener('visibilitychange', tick);
    };
  }, []);
  useEffect(() => {
    const heading = content.current?.querySelector('h1');
    if (heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
  }, [route]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(undefined), 4500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  async function save(change: RecordChange, { offerBooking = true } = {}) {
    if (writing.current) throw new Error('A change is already saving. Try again in a moment.');
    writing.current = true;
    try {
      let previous: Records | undefined;
      const saved = await repository.update(current => {
        previous = current;
        return pruneScheduleOverlapIgnores(change(current));
      });
      setRecords(saved);
      const newlyReady = offerBooking && previous ? newlyBookablePatients(previous, saved, localDate()) : [];
      if (newlyReady.length) setBookingOffer(newlyReady);
    }
    finally { writing.current = false; }
  }

  function renderScreen() {
    if (!records) return <p role={error ? 'alert' : 'status'}>{error || t('Opening local records…')}</p>;
    const validDate = isoDate.safeParse(params.get('date')).data;
    const patient = records.patients.find(item => item.id === id);
    const appointment = records.appointments.find(item => item.id === id);
    const requestedPatient = records.patients.find(item => item.id === params.get('patient'));
    const from = params.get('from');
    const calendarDay = appointment?.date ?? validDate;
    const calendarBack = '/calendar' + (calendarDay ? '?date=' + calendarDay : '');
    const profileBack = appointment?.patientId ?? requestedPatient?.id;
    const outcomeReturn = from ? outcomeReturnRoutes.get(from) : undefined;
    const appointmentBack = outcomeReturn ?? (from === 'patient-search' ? '/patients' : from === 'today' ? '/today' : from === 'calendar' ? calendarBack
      : from === 'availability' ? '/availability' + (calendarDay ? '?date=' + calendarDay : '')
      : from === 'planning' ? '/planning' : from === labReturnsView ? labReturnsRoute
      : from === 'attention' ? '/attention' : from === 'calendar-conflicts' ? '/calendar-conflicts'
      : from === 'ignored-calendar-events' ? '/ignored-calendar-events'
      : profileBack ? '/patients/' + profileBack : calendarBack);
    const returnTo = from ? workReturnRoutes.get(from) : undefined;
    const fromLabWarning = from === 'today' && params.get('lab-warning') === '1';
    const originQuery = from ? '?from=' + encodeURIComponent(from) + (fromLabWarning ? '&lab-warning=1' : '') : '';
    switch (section) {
      case 'today': return <Today records={records} today={today} now={now} outstanding={outstanding} calendarAccess={calendarAccess} save={save} />;
      case 'daily-lab': {
        const back = from === 'responses' ? labFollowUpsRoute : '/today';
        return <DailyLabCheck key={today} records={records} today={today} back={back}
          save={change => save(change, { offerBooking: false })} onClose={async result => {
            const date = localDate();
            await save(current => ({ ...current, dailyLabCheck: { date, result } }), { offerBooking: false });
            setNotice({ message: labResultMessage(result) });
            if (readRoute() === route) returnToPreviousRoute(back);
          }} />;
      }
      case 'calendar': return <Calendar records={records} today={today} selected={validDate ?? today} calendarAccess={calendarAccess} conflicts={currentConflicts}
        rangeStart={isoDate.safeParse(params.get('range')).data}
        eventId={params.get('event') ?? undefined} back={from === 'calendar-conflicts' ? '/calendar-conflicts' : undefined} />;
      case 'calendar-conflicts': return <CalendarConflicts records={records} conflicts={conflicts} result={deviceEvents} access={calendarAccess} save={save}
        back={from === 'today' ? '/today' : from === 'availability' ? '/availability' : '/calendar'} />;
      case 'ignored-calendar-events': return <IgnoredEvents records={records} conflicts={conflicts} access={calendarAccess} save={save}
        back={from === 'calendar-conflicts' ? '/calendar-conflicts' : '/calendar'} />;
      case 'patients': {
        if (!id) return <Patients records={records} />;
        if (id === 'new') return <PatientForm today={today} save={save} />;
        if (!patient) break;
        const props = { patient, today, save };
        if (!sub) {
          const noteId = params.get('note');
          const focusedNote = noteId ? records.notes.find(note => note.id === noteId && note.patientId === patient.id)?.id : undefined;
          return <PatientDetail records={records} upcoming={upcoming} outstanding={outstanding} focusedNote={focusedNote}
            back={from === labReturnsView ? labReturnsRoute : undefined}
            openFollowUps={from === labReturnsView && params.get('view') === 'follow-up'} {...props} />;
        }
        if (sub === 'edit') return <PatientForm {...props} />;
        if (sub === 'delete') return <DeletePatient patient={patient} save={save} />;
        if (sub === 'memory') return <MemoryForm {...props} />;
        if (sub === 'notes') {
          const note = records.notes.find(item => item.id === relatedId && item.patientId === patient.id);
          if (relatedId === 'new' || note) return <NoteForm {...props} records={records} note={note} linkedId={params.get('appointment') ?? undefined} />;
        }
        if (sub === 'treatments') {
          const treatment = records.treatments.find(item => item.id === relatedId && item.patientId === patient.id);
          if (action === 'close' && treatment?.status !== 'Active') break;
          if (relatedId === 'new' || treatment) return <TreatmentForm {...props} treatment={treatment} close={action === 'close'} />;
        }
        if (sub === 'alerts') {
          const alert = records.alerts.find(item => item.id === relatedId && item.patientId === patient.id);
          if (relatedId === 'new' || alert) return <AlertForm {...props} alert={alert} />;
        }
        if (sub === 'responses') {
          const wait = records.waits.find(item => item.id === relatedId && item.patientId === patient.id);
          if (relatedId === 'new') return <WaitForm {...props} returnTo={returnTo} labCheck={params.get('preset') === 'lab'} />;
          if (wait) {
            const detail = '/patients/' + patient.id + '/responses/' + wait.id;
            if (action === 'edit') return <WaitForm {...props} wait={wait} returnTo={detail + originQuery} />;
            if (!action) return <FollowUpDetail {...props} wait={wait} back={returnTo ?? '/patients/' + patient.id}
              edit={detail + '/edit' + originQuery} />;
          }
        }
        break;
      }
      case 'appointments': {
        const detail = '/appointments/' + id + originQuery;
        if (appointment?.kind === 'Visit' && appointment.status === 'Scheduled' && sub === 'complete') {
          const visitPatient = records.patients.find(item => item.id === appointment.patientId);
          if (!visitPatient) break;
          return <WaitForm patient={visitPatient} today={today} returnTo={detail} completingVisit
            save={change => save(current => change(saveVisitOutcome(current, appointment, 'Completed')))} />;
        }
        if (id === 'new' || (appointment && sub === 'edit')) {
          const block = params.get('kind') === 'block';
          const range = id === 'new'
            ? slotSchema.safeParse({ date: validDate, start: params.get('start'), end: params.get('end') }).data
            : undefined;
          const selectedSlot = range && range.start < range.end ? range : undefined;
          return <AppointmentForm records={records} item={appointment} today={today} now={now} selectedPatient={requestedPatient?.id}
            selectedDate={validDate} opening={from === 'today' && !block ? selectedSlot : undefined}
            selectedRange={from === 'calendar' ? selectedSlot : undefined}
            fromCalendar={from === 'calendar'}
            block={block} calendarAccess={calendarAccess} back={appointment ? detail : appointmentBack} save={save} />;
        }
        if (appointment) return <AppointmentDetail item={appointment} records={records} now={now} back={appointmentBack} save={save}
          fromLabWarning={fromLabWarning}
          outcomePending={outstanding.some(visit => visit.id === appointment.id)}
          remove={() => save(current => deleteAppointment(current, appointment.id, appointment.kind), { offerBooking: false })}
          onDeleted={() => {
            setNotice({ message: appointment.kind === 'Block' ? 'Blocked time deleted.' : 'Appointment deleted.' });
            finishRoute(appointmentBack);
          }}
          conflicts={conflicts.filter(conflict => conflictAppointmentIds(conflict).includes(appointment.id))}
          editLink={`/appointments/${appointment.id}/edit${originQuery}`}
          followUpLink={`/appointments/${appointment.id}/complete${originQuery}`} />;
        break;
      }
      case 'tasks': {
        const task = records.tasks.find(item => item.id === id);
        const taskPatient = from === 'patient'
          ? task ? records.patients.find(item => item.id === task.patientId) : requestedPatient
          : undefined;
        if (from === 'patient' && !taskPatient) break;
        const back = taskPatient ? '/patients/' + taskPatient.id : returnTo ?? '/work';
        if (id === 'new') return <TaskForm patient={taskPatient} patients={records.patients} back={back} save={save} />;
        if (task) {
          const detail = '/tasks/' + task.id;
          if (sub === 'edit') return <TaskForm task={task} patient={taskPatient} patients={records.patients}
            back={detail + originQuery} save={save} />;
          if (!sub) return <TaskDetail task={task} patient={records.patients.find(item => item.id === task.patientId)}
            today={today} save={save} back={back} edit={detail + '/edit' + originQuery} />;
        }
        break;
      }
      case 'planning': return <Planning records={records} today={today} now={now} labOnly={params.get('view') === labReturnsView} />;
      case 'attention': return <Attention records={records} today={today} outstanding={outstanding} save={save} />;
      case 'appointment-outcomes': return <AppointmentOutcomes visits={outstanding} records={records} today={today}
        fromAttention={from === 'attention'} />;
      case 'responses':
        if (id === 'new') return <ChooseResponsePatient records={records} from={from === 'work' ? 'work' : 'responses'} />;
        return <Work records={records} today={today} save={save} native={native} view="responses" />;
      case 'work':
      case 'more': return <Work records={records} today={today} save={save} native={native} view={params.get('view')} />;
      case 'availability': return <Availability records={records} today={today} save={save} selected={validDate} conflicts={currentConflicts}
        editId={params.get('edit') ?? undefined} breakId={params.get('break') ?? undefined}
        hoursDate={isoDate.safeParse(params.get('hours')).data} occurrence={isoDate.safeParse(params.get('occurrence')).data} />;
      case 'data':
        if (id === 'durations') return <AppointmentDurations records={records} save={save} />;
        if (id === 'notifications') return <NotificationSettings records={records} save={save} native={native} />;
        if (id === 'event-buffer') return <CalendarBufferSettings records={records} save={save} />;
        if (id === 'availability') return <AvailabilitySettings records={records} save={save}
          back={from === 'today' ? '/today' : from === 'notifications' ? '/data/notifications' : '/data'} />;
        return dataPanel({
          refresh, save, records, today,
          restoreRecords: restored => save(() => restored),
          calendarPublishing: native ? <GoogleCalendarPublishing publishing={publishing} refreshCalendar={calendarAccess.refresh} /> : undefined,
        });
    }
    return <><PageHeader title={t('Page unavailable')} back="/today" /><Empty>{t('This page or record could not be found.')}</Empty><ButtonLink to="/today">{t('Go to Today')}</ButtonLink></>;
  }

  const from = params.get('from');
  const fromPatient = from === 'patient' || (section === 'patients' && sub === 'responses' && !from);
  let tab = section;
  if (section === 'appointments') tab = from ?? 'calendar';
  if ('/' + section === labRoute) tab = from === 'responses' ? 'work' : 'today';
  if (section === 'tasks' || (section === 'patients' && sub === 'responses')) tab = fromPatient ? 'patients' : from ?? 'work';
  if (tab === labReturnsView) tab = 'planning';
  if (tab === 'patient-search') tab = 'patients';
  if (tab === 'attention' || outcomeReturnRoutes.has(tab)) tab = 'today';
  if (tab === 'availability' || tab === 'calendar-conflicts' || tab === 'ignored-calendar-events') tab = 'calendar';
  if (['more', 'tasks', 'responses', 'data'].includes(tab)) tab = 'work';
  const booking = section === 'appointments' && (id === 'new'
    ? params.get('kind') !== 'block'
    : sub === 'edit' && records?.appointments.some(item => item.id === id && item.kind === 'Visit'));
  const deviceStatus = t(native ? 'On device' : previewStatus);
  return <div className={booking ? 'app-shell booking-shell' : 'app-shell'}>
    <a className="skip" href="#main-content" onClick={event => { event.preventDefault(); content.current?.focus(); }}>{t('Skip to content')}</a>
    {!booking && <><header className="mobile-header"><Brand /><span className="device-status"><ShieldCheck aria-hidden />{deviceStatus}</span></header>
    <aside className="navigation">
      <div className="desktop-brand"><Brand /></div>
      <nav aria-label={t('Main navigation')}>{tabs.map(({ route, label, icon: IconComponent }) => <a
        key={route} href={path('/' + route)} aria-current={tab === route ? 'page' : undefined}>
        <IconComponent aria-hidden weight={tab === route ? 'fill' : 'regular'} /><span>{t(label)}</span>
      </a>)}</nav>
      <div className="desktop-status device-status"><ShieldCheck aria-hidden />{deviceStatus}</div>
    </aside></>}
    <main id="main-content" ref={content} tabIndex={-1} className="main"><div className="content">
      {publishing.problem && (section === 'today' || section === 'calendar') &&
        <p role="status"><a href={path('/data')}>{t('Calendar publishing needs attention')}</a></p>}
      {currentConflicts.length > 0 && (section === 'today' || section === 'calendar') &&
        <CalendarConflictBanner count={currentConflicts.length} from={section} />}
      <div key={route}>{renderScreen()}</div>
    </div></main>
    <div className={notice ? 'appointment-notice' : 'visually-hidden'} aria-live="polite" aria-atomic="true">
      {notice && <><CheckCircle size={18} weight="fill" aria-hidden /><span>{t(notice.message)}</span>
        <button type="button" aria-label={t('Close')} onClick={() => setNotice(undefined)}><X size={17} aria-hidden /></button></>}
    </div>
    {bookingOffer.length > 0 && <BookingOffer patients={bookingOffer} onDismiss={() => setBookingOffer([])} onProceed={() => {
      const [patient] = bookingOffer;
      setBookingOffer([]);
      if (bookingOffer.length === 1) {
        const bookingParams = new URLSearchParams({ patient: patient.id, from: tab });
        openRoute('/appointments/new?' + bookingParams);
      } else {
        openRoute('/planning');
      }
    }} />}
  </div>;
}
