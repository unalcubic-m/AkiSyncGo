import { t } from '../i18n';
import { CalendarBlank, CalendarPlus, CaretDown, CaretRight, Clock, ListChecks, WarningCircle } from '@phosphor-icons/react';
import { useMemo } from 'react';
import { useCalendarRead, type CalendarDateRange, type DeviceCalendarAccess } from '../components/DeviceCalendarAccess';
import { formatDuration } from '../domain/availability';
import { availabilityAlertDates } from '../domain/availability-settings';
import { getBookingDurations } from '../domain/booking-durations';
import { addDays, daysBetween, formatDate, titleDate } from '../domain/dates';
import type { RecordChange, Records, Visit } from '../domain/model';
import { agenda, appointmentOpeningsOn, openTasks, planningCandidates, responseReviews, upcomingVisits } from '../domain/workflows';
import { AgendaEmpty, Empty, More, NewVisitLink, PageHeader, path, Pill, Section, VisitList } from '../components/ui';
import { FollowUpList } from '../components/FollowUpList';
import { OutcomeShortcut } from './AppointmentOutcomes';
import { TaskList } from './Tasks';
import { LabCheckShortcut } from './DailyLabCheck';
import { AppointmentsToReview, PatientsToCall } from './TodayFollowUp';

function UpcomingOpenings({ records, today, readyCount, calendarAccess }: {
  records: Records; today: string; readyCount: number; calendarAccess: DeviceCalendarAccess;
}) {
  const dates = useMemo(() => availabilityAlertDates(records, today), [records, today]);
  const ranges = useMemo(() => {
    const batches: CalendarDateRange[] = [];
    for (const date of dates) {
      const batch = batches.at(-1);
      // Android calendar reads are limited to 136 days, including both endpoints.
      if (batch && daysBetween(batch.from, date) < 135) batch.through = date;
      else batches.push({ from: date, through: date });
    }
    return batches;
  }, [dates]);
  const calendar = useCalendarRead(calendarAccess, ranges);
  if (calendar.state === 'loading' || calendar.state === 'error') return null;

  const openings = dates.flatMap(date => appointmentOpeningsOn(records, date, calendar.state === 'ready' ? calendar.events : []));
  const first = openings[0];
  if (!first) return null;

  const tomorrow = addDays(today, 1);
  const dateLabel = (date: string) => date === tomorrow ? t('Tomorrow') : formatDate(date, { weekday: 'short', month: 'short', day: 'numeric' });
  const visitDurations = getBookingDurations(records).presets;
  return <details className="panel today-openings">
    <summary>
      <span className="opening-icon"><CalendarPlus aria-hidden size={20} /></span>
      <span>
        <strong>{first.date === tomorrow
          ? t('{duration} open tomorrow', { duration: formatDuration(first.duration) })
          : t('{duration} open · {date}', { duration: formatDuration(first.duration), date: dateLabel(first.date) })}</strong>
        <small>{first.start}–{first.end}{readyCount > 0 && <> · {t(readyCount === 1
          ? '{count} patient ready to book' : '{count} patients ready to book', { count: readyCount })}</>}</small>
      </span>
      <CaretDown className="opening-caret" aria-hidden size={16} />
    </summary>
    <ul aria-label={t('Upcoming appointment openings')}>
      {openings.map(({ date, start, end, duration }) => {
        const fits = visitDurations.filter(length => length <= duration).map(formatDuration).join(' / ');
        return <li key={`${date}-${start}`}>
          <a className="small-row" href={path(`/appointments/new?from=today&date=${date}&start=${start}&end=${end}`)}>
            <span><strong>{dateLabel(date)} · {start}–{end}</strong>{fits && <small>{t('Fits {duration}', { duration: fits })}</small>}</span>
            <Pill tone="green">{formatDuration(duration)}</Pill>
            <CaretRight aria-hidden />
          </a>
        </li>;
      })}
    </ul>
    <div className="opening-actions">
      <More to="/planning">{t('View ready-to-book patients')}</More>
      <More to="/data/availability?from=today">{t('Settings')}</More>
      {(calendar.state === 'prompt' || calendar.state === 'denied') && <small>{t('Based on the AkiSync calendar.')}</small>}
    </div>
  </details>;
}

export default function Today({ records, today, now, outstanding, calendarAccess, save }: {
  records: Records; today: string; now: Date; outstanding: Visit[]; calendarAccess: DeviceCalendarAccess; save: (change: RecordChange) => Promise<void>;
}) {
  const visits = agenda(records, today);
  const count = visits.filter(item => item.kind === 'Visit' && !['Cancelled', 'Postponed'].includes(item.status)).length;
  const ready = planningCandidates(records, today);
  const tasks = openTasks(records.tasks);
  const waits = responseReviews(records, today);
  const pendingOutcomeIds = new Set(outstanding.filter(visit => visit.date === today).map(visit => visit.id));
  const upcoming = upcomingVisits(records, today, now).filter(item => item.date > today).slice(0, 3);
  return <>
    <div className="today-overview">
      <PageHeader title={t('Today')} subtitle={titleDate(today)} action={<NewVisitLink to="/appointments/new?from=today" />} />
      <div className="overview-tiles">
        {([
          { label: 'Visits today', count, icon: CalendarBlank, to: '/calendar' },
          { label: 'Ready to book', count: ready.length, icon: ListChecks, to: '/planning' },
          { label: 'Need attention', count: tasks.length, icon: WarningCircle, to: '/attention' },
        ] as const).map(({ label, count, icon: IconComponent, to }) => <a className="metric" href={path(to)} key={to}>
          <div className="metric-icon"><IconComponent aria-hidden /></div>
          <strong>{count}</strong><span>{t(label)}</span>
        </a>)}
      </div>
    </div>
    <AppointmentsToReview records={records} today={today} />
    <PatientsToCall records={records} today={today} now={now} />
    <LabCheckShortcut records={records} today={today} />
    <OutcomeShortcut visits={outstanding} today={today} />
    <UpcomingOpenings records={records} today={today} readyCount={ready.length} calendarAccess={calendarAccess} />
    <div className="today-columns">
      <div>
        <Section className="today-agenda" title={t('Today’s agenda')} action={<More to="/calendar">{t('Calendar')}</More>}>
          {visits.length ? <VisitList records={records} visits={visits} alerts from="today" pendingOutcomeIds={pendingOutcomeIds} />
            : <AgendaEmpty>{t('No visits or blocked time today.')}</AgendaEmpty>}
        </Section>
        <TaskList tasks={records.tasks} patients={records.patients} today={today} save={save} from="today" />
        <Section title={t('Upcoming visits')}>
          {upcoming.length ? <VisitList records={records} visits={upcoming} dates from="today" /> : <Empty>{t('No upcoming visits after today.')}</Empty>}
        </Section>
      </div>
      <div>
        {waits.length > 0 && <details className="panel today-follow-ups">
          <summary>
            <span className="compact-row-icon"><Clock size={18} aria-hidden /></span>
            <strong>{t('Follow-ups')}</strong>
            <Pill>{waits.length}</Pill>
            <CaretDown className="opening-caret" size={16} aria-hidden />
          </summary>
          <FollowUpList patients={records.patients} today={today} waits={waits} save={save} from="today" />
          <div className="today-follow-ups-footer"><More to="/work?view=responses">{t('All follow-ups')}</More></div>
        </details>}
        {!tasks.length && !waits.length && !outstanding.length && <Section title={t('Needs attention')}>
          <div className="panel"><Empty>{t('No items need attention.')}</Empty></div>
        </Section>}
        <Section title={t('Ready to book')} action={<More to="/planning">{t('Planning')}</More>}>
          <div className="panel">
            {ready.slice(0, 3).map(({ patient }) => <a className="small-row" key={patient.id} href={path(`/patients/${patient.id}`)}>
              <span><strong>{patient.name}</strong>{patient.nextAction && <small>{patient.nextAction}</small>}</span>
              <Pill tone={patient.priority === 'Normal' ? 'neutral' : 'amber'}>{t(patient.priority)}</Pill>
            </a>)}
            {ready.length === 0 && <Empty>{t('No patients ready to book.')}</Empty>}
          </div>
        </Section>
      </div>
    </div>
  </>;
}
