import { getLocale, t } from '../i18n';
import { CalendarBlank, CalendarSlashIcon, CaretDown, CaretLeft, CaretRight, Clock, FadersHorizontal } from '@phosphor-icons/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarAccessMessage, useCalendarRead, useDeviceEventIgnore, type CalendarDateRange, type DeviceCalendarAccess } from '../components/DeviceCalendarAccess';
import { breaksForDate, hoursForDate } from '../domain/availability';
import { calendarDateFilter, calendarDateRun, calendarViews, monthDates, shiftMonth, weekDates, type CalendarView } from '../domain/calendar-view';
import { addDays, formatDate, minutes, titleDate } from '../domain/dates';
import { calendarEventLabel, calendarEventsOn } from '../domain/device-calendar';
import type { Records } from '../domain/model';
import { conflictAppointmentIds, type ScheduleConflict } from '../domain/schedule-conflicts';
import { activeAlerts, agenda } from '../domain/workflows';
import { AlertBadge, Empty, Field, More, NewVisitLink, PageHeader, path, Pill, Section } from '../components/ui';
import { CalendarMonth, CalendarTimeline, type CalendarEntry } from './CalendarViews';
import { CalendarGestureArea } from './CalendarGestureArea';
import { breakSettingsLink } from './ScheduleSettings';
import { openRoute } from '../navigation';
import './calendar.css';

const workingDaysPreference = 'akisync-calendar-working-days-only';
const viewPreference = 'akisync-calendar-view';
const viewLabels = { day: 'Daily', three: '3 days', week: 'Weekly view', month: 'Monthly' } as const;
const conflictLabels = ['Calendar conflict', 'Break conflict', 'Scheduling conflict'] as const;
const arrows = {
  day: ['Previous day', 'Next day'],
  three: ['Previous 3 days', 'Next 3 days'],
  week: ['Previous week', 'Next week'],
  month: ['Previous month', 'Next month'],
} as const;

function readCalendarPreference(key: string) {
  try { return localStorage.getItem(key); }
  catch { return null; }
}

function saveCalendarPreference(key: string, value: string) {
  try { localStorage.setItem(key, value); }
  catch { /* The active calendar still uses the new selection. */ }
}

function monthTitle(date: string) {
  return formatDate(date, { month: 'long', year: 'numeric' });
}

export default function Calendar({ records, today, selected, rangeStart, calendarAccess, eventId, back, conflicts }: {
  records: Records; today: string; selected: string; rangeStart?: string; calendarAccess: DeviceCalendarAccess;
  eventId?: string; back?: string; conflicts: ScheduleConflict[];
}) {
  const [view, setView] = useState<CalendarView>(() => {
    const saved = readCalendarPreference(viewPreference);
    return calendarViews.find(option => option === saved) ?? 'three';
  });
  const [workingDaysOnly, setWorkingDaysOnly] = useState(() => readCalendarPreference(workingDaysPreference) === 'true');
  const [anchor, setAnchor] = useState(rangeStart ?? selected);
  const [pickerMonth, setPickerMonth] = useState<string>();
  const [appointmentId, setAppointmentId] = useState<string>();
  const appointmentControl = useRef<HTMLButtonElement>(null);
  const viewOptions = useRef<HTMLDetailsElement>(null);
  const viewOptionsControl = useRef<HTMLElement>(null);

  useEffect(() => {
    function dismissOutside(event: Event) {
      const options = viewOptions.current;
      if (options?.open && event.target instanceof Node && !options.contains(event.target)) options.open = false;
    }

    function dismissOnEscape(event: KeyboardEvent) {
      const options = viewOptions.current;
      if (event.key !== 'Escape' || event.defaultPrevented || !options?.open) return;
      event.preventDefault();
      options.open = false;
      viewOptionsControl.current?.focus({ preventScroll: true });
    }

    document.addEventListener('click', dismissOutside, true);
    document.addEventListener('focusin', dismissOutside);
    document.addEventListener('keydown', dismissOnEscape);
    return () => {
      document.removeEventListener('click', dismissOutside, true);
      document.removeEventListener('focusin', dismissOutside);
      document.removeEventListener('keydown', dismissOnEscape);
    };
  }, []);

  function changeView(next: CalendarView) {
    setView(next);
    setAnchor(activeDate);
    setAppointmentId(undefined);
    saveCalendarPreference(viewPreference, next);
  }

  function changeWorkingDaysOnly(value: boolean) {
    setWorkingDaysOnly(value);
    setAppointmentId(undefined);
    saveCalendarPreference(workingDaysPreference, String(value));
  }

  const filter = useMemo(() => calendarDateFilter(records, workingDaysOnly), [records, workingDaysOnly]);
  let dates: string[];
  switch (view) {
    case 'day': dates = [selected]; break;
    case 'three': dates = calendarDateRun(filter, anchor, 3); break;
    case 'week': dates = weekDates(selected).filter(filter.includes); break;
    case 'month': dates = monthDates(selected).filter(filter.includes); break;
  }
  const activeDate = view === 'three' && !eventId && !dates.includes(selected) ? dates[0] ?? selected : selected;
  const calendarDates = [...new Set([...dates, activeDate])].sort().join(',');
  const ranges = useMemo(() => {
    const result: CalendarDateRange[] = [];
    for (const date of calendarDates.split(',')) {
      const last = result.at(-1);
      if (last && date === addDays(last.through, 1)) last.through = date;
      else result.push({ from: date, through: date });
    }
    return result;
  }, [calendarDates]);
  const deviceCalendar = useCalendarRead(calendarAccess, ranges);
  const ignoreEvent = useDeviceEventIgnore(calendarAccess.refresh);
  const deviceEvents = deviceCalendar.state === 'ready' ? deviceCalendar.events : [];
  const selectedEvents = calendarEventsOn(activeDate, deviceEvents)
    .sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.begin - b.begin || a.title.localeCompare(b.title, getLocale()));
  const eventRow = useRef<HTMLElement>(null);
  const focusedEvent = useRef(false);
  const hasTarget = !!eventId && selectedEvents.some(event => event.id === eventId);
  useEffect(() => {
    const row = eventRow.current;
    if (!hasTarget || !row || focusedEvent.current) return;
    focusedEvent.current = true;
    row.focus({ preventScroll: true });
    row.scrollIntoView({ block: 'center' });
  }, [hasTarget]);
  const dayHref = (date: string) => path('/calendar?date=' + date);
  function adjacentDate(direction: -1 | 1) {
    if (view === 'month') return shiftMonth(selected, direction);
    if (view === 'week') {
      const target = addDays(selected, 7 * direction);
      const visible = weekDates(target).filter(filter.includes);
      return visible.find(date => date >= target) ?? visible.at(-1) ?? target;
    }
    if (view === 'day') return filter.find(addDays(selected, direction), direction);
    if (direction === 1) return filter.find(addDays(dates.at(-1) ?? anchor, 1));
    return calendarDateRun(filter, addDays(dates[0] ?? anchor, -1), 3, -1).at(-1);
  }

  const patientNames = new Map(records.patients.map(patient => [patient.id, patient.name]));
  const conflictWarnings = new Map<string, Set<string>>();
  for (const conflict of conflicts) {
    const label = t(conflict.kind === 'device' ? 'Calendar conflict' : conflict.overlap.kind === 'break' ? 'Break conflict' : 'Scheduling conflict');
    for (const id of conflictAppointmentIds(conflict)) {
      if (!conflictWarnings.has(id)) conflictWarnings.set(id, new Set());
      conflictWarnings.get(id)!.add(label);
    }
  }
  function dayEntries(date: string): CalendarEntry[] {
    const events = calendarEventsOn(date, deviceEvents);
    const breaks = breaksForDate(records, date);
    const entries: CalendarEntry[] = agenda(records, date).map(item => {
      const name = item.patientId ? patientNames.get(item.patientId) : undefined;
      const warnings = item.patientId ? activeAlerts(records, item.patientId) : [];
      const labels = warnings.map(alert => t(alert.severity) + ' · ' + alert.label);
      labels.push(...(conflictWarnings.get(item.id) ?? []));
      const title = name ?? item.title;
      const tone = item.status === 'Cancelled' || item.status === 'Postponed' ? 'inactive'
        : item.kind === 'Block' ? 'blocked' : warnings.some(alert => alert.severity === 'Critical') ? 'alert' : 'visit';
      return { id: item.id, title, shortTitle: title.split(/\s+/).slice(0, 2).map(word => [...word][0]).join(''),
        start: minutes(item.start), end: minutes(item.end), tone, warnings: labels, appointment: item };
    });
    for (const entry of breaks) {
      entries.push({ id: 'break-' + entry.rule.id + entry.source, title: entry.rule.title, shortTitle: t('Break'),
        start: minutes(entry.start), end: minutes(entry.end), tone: 'blocked', href: path(breakSettingsLink(entry.rule, entry.source)) });
    }
    for (const off of records.timeOff) {
      if (off.from <= date && off.through >= date && off.hours) {
        entries.push({ id: 'off-' + off.id, title: off.title, shortTitle: t('Time off'),
          start: minutes(off.hours.start), end: minutes(off.hours.end), tone: 'blocked', href: path('/availability?edit=' + off.id) });
      }
    }
    for (const event of events) {
      if (event.ignored || event.allDay) continue;
      const [start, end] = calendarEventLabel(event, date).split('–').map(minutes);
      if (end <= start) continue;
      const params = new URLSearchParams({ date, event: event.id });
      if (view === 'three' && anchor !== date) params.set('range', anchor);
      entries.push({ id: 'device-' + event.id, title: event.title.trim() || t('Untitled event'), shortTitle: t('Busy'),
        start, end, tone: 'busy', href: path('/calendar?' + params) });
    }
    return entries;
  }

  const timelineDays = view === 'month' ? [] : dates.map(date => ({ date, entries: dayEntries(date),
    busy: calendarEventsOn(date, deviceEvents).some(event => !event.ignored) }));
  const workingHours = timelineDays.flatMap(day => hoursForDate(records, day.date));
  const entries = timelineDays.flatMap(day => day.entries);
  const clockStart = Math.floor(Math.min(8 * 60, ...workingHours.map(window => minutes(window.start)), ...entries.map(entry => entry.start)) / 60) * 60;
  const clockEnd = Math.ceil(Math.max(17 * 60, ...workingHours.map(window => minutes(window.end)), ...entries.map(entry => entry.end)) / 60) * 60;
  const appointment = appointmentId ? entries.find(entry => entry.appointment?.id === appointmentId) : undefined;
  const hoursOverride = records.hoursOverrides.find(item => item.date === activeDate);
  const timeOff = records.timeOff.filter(item => !item.hours && item.from <= activeDate && item.through >= activeDate);
  const previous = adjacentDate(-1);
  const next = adjacentDate(1);
  const rangeTitle = view === 'month' ? monthTitle(selected) : dates.length > 1
    ? formatDate(dates[0]) + ' – ' + formatDate(dates[dates.length - 1]) : titleDate(activeDate);
  const newAppointment = `/appointments/new?date=${activeDate}&from=calendar`;
  function pageByGesture(date: string) {
    openRoute('/calendar?date=' + date, true);
  }

  const closeLabel = t('Close for appointments');

  return <>
    <PageHeader title={t('Calendar')} back={back} action={
      <div className="calendar-header-actions">
        <div className="calendar-layout-control">
          <select aria-label={t('Calendar layout')} value={view}
            onChange={event => changeView(event.currentTarget.value as CalendarView)}>
            {calendarViews.map(option => <option key={option} value={option}>{t(viewLabels[option])}</option>)}
          </select>
          <CaretDown size={14} aria-hidden />
        </div>
        <details className="calendar-view-options" ref={viewOptions}>
          <summary ref={viewOptionsControl} className={workingDaysOnly ? 'icon-button filter-active' : 'icon-button'}
            aria-label={t('Calendar view options')} title={t('Calendar view options')}>
            <FadersHorizontal size={21} aria-hidden />
          </summary>
          <div className="panel calendar-view-panel">
            <label className="check">
              <input type="checkbox" checked={workingDaysOnly} aria-describedby="calendar-working-days-hint"
                onChange={event => changeWorkingDaysOnly(event.target.checked)} />
              {t('Working days only')}
            </label>
            <small id="calendar-working-days-hint">{t('Days with patient appointments stay visible.')}</small>
          </div>
        </details>
      </div>
    } />
    <div className="calendar-actions">
      <p className="calendar-action-date" id="calendar-action-date" aria-live="polite" aria-atomic="true">
        <span>{t('Selected date')}</span>
        <time dateTime={activeDate}>{formatDate(activeDate, { weekday: 'short', day: 'numeric', month: 'short' })}</time>
      </p>
      <div className="row-actions calendar-booking-actions" role="group" aria-label={t('Appointment actions')} aria-describedby="calendar-action-date">
        <NewVisitLink to={newAppointment} iconOnly />
        <a className="button secondary icon-only" href={path(newAppointment + '&kind=block')} aria-label={closeLabel} title={closeLabel}>
          <CalendarSlashIcon aria-hidden />
        </a>
      </div>
    </div>
    <div className="calendar-card panel">
      <div className="calendar-toolbar">
        <button type="button" className="text-button calendar-month-trigger" aria-expanded={!!pickerMonth}
          aria-controls="calendar-date-picker" aria-label={t('Choose date in {month}', { month: monthTitle(activeDate) })}
          onClick={() => setPickerMonth(pickerMonth ? undefined : activeDate)}>
          {monthTitle(activeDate)} <CaretDown aria-hidden />
        </button>
        <div className="calendar-controls">
          {previous ? <a className="icon-button" aria-label={t(arrows[view][0])} href={dayHref(previous)}><CaretLeft aria-hidden /></a>
            : <button type="button" className="icon-button" aria-label={t(arrows[view][0])} disabled><CaretLeft aria-hidden /></button>}
          <a className="text-button" href={dayHref(today)}>{t('Today')}</a>
          {next ? <a className="icon-button" aria-label={t(arrows[view][1])} href={dayHref(next)}><CaretRight aria-hidden /></a>
            : <button type="button" className="icon-button" aria-label={t(arrows[view][1])} disabled><CaretRight aria-hidden /></button>}
        </div>
      </div>
      <section id="calendar-date-picker" className="calendar-date-picker" aria-label={t('Jump to date')} hidden={!pickerMonth}>
        {pickerMonth && <>
          <div className="calendar-toolbar">
            <button type="button" className="icon-button" aria-label={t('Previous month')} onClick={() => setPickerMonth(shiftMonth(pickerMonth, -1))}>
              <CaretLeft aria-hidden />
            </button>
            <strong aria-live="polite">{monthTitle(pickerMonth)}</strong>
            <button type="button" className="icon-button" aria-label={t('Next month')} onClick={() => setPickerMonth(shiftMonth(pickerMonth, 1))}>
              <CaretRight aria-hidden />
            </button>
          </div>
          <CalendarMonth month={pickerMonth} selected={activeDate} dayHref={dayHref} onChoose={date => {
            if (!filter.includes(date)) changeView('day');
            setPickerMonth(undefined);
          }} />
          <Field label={t('Jump to date')}><input type="date" value={activeDate} onChange={event => {
            if (!event.target.value) return;
            if (!filter.includes(event.target.value)) changeView('day');
            setPickerMonth(undefined);
            openRoute('/calendar?date=' + event.target.value);
          }} /></Field>
        </>}
      </section>
    </div>
    <div className="calendar-range calendar-toolbar">
      <strong aria-live="polite">{rangeTitle}</strong><More to={'/availability?date=' + activeDate}>{t('Availability')}</More>
    </div>
    {appointment?.appointment && <section className="panel calendar-appointment-preview" aria-label={t('Appointment details')}>
      <div className="calendar-toolbar"><strong>{appointment.title}</strong>
        <button className="text-button" type="button" onClick={() => {
          setAppointmentId(undefined);
          appointmentControl.current?.focus();
        }}>{t('Close')}</button>
      </div>
      <p className="muted">{titleDate(appointment.appointment.date)} · {appointment.appointment.start}–{appointment.appointment.end} · {appointment.appointment.title} · {t(appointment.appointment.status)}</p>
      <div className="badges">
        {appointment.appointment.patientId && activeAlerts(records, appointment.appointment.patientId).map(alert => <AlertBadge key={alert.id} alert={alert} />)}
        {appointment.warnings?.filter(warning => conflictLabels.some(label => t(label) === warning)).map(warning =>
          <Pill key={warning} tone="amber">{warning}</Pill>)}
      </div>
      <More to={`/appointments/${appointment.appointment.id}?from=calendar`}>{t('Open appointment')}</More>
    </section>}
    <CalendarGestureArea previous={previous} next={next} onPage={pageByGesture} days={timelineDays} clockStart={clockStart} clockEnd={clockEnd}>
      {range => <>
        {view === 'month' ? <div className="panel calendar-month-panel">
          <CalendarMonth month={selected} selected={selected} dayHref={dayHref} includes={filter.includes} onChoose={() => changeView('day')}
            count={date => records.appointments.filter(item => item.date === date && item.kind === 'Visit' && item.status === 'Scheduled').length} />
        </div> : timelineDays.length ? <CalendarTimeline range={range} days={timelineDays} selected={activeDate} start={clockStart} end={clockEnd}
          compact={view === 'week'} daily={view === 'day'} selectedId={appointmentId}
          dayHref={date => view === 'three' && anchor !== date ? dayHref(date) + '&range=' + anchor : dayHref(date)}
          onSelect={(item, control) => {
            appointmentControl.current = control;
            setAppointmentId(item.id === appointmentId ? undefined : item.id);
          }} /> : <div className="panel"><Empty>{t(view === 'week' ? 'No working days or patient appointments this week.' : 'No upcoming working days or patient appointments.')}</Empty></div>}
      </>}
    </CalendarGestureArea>
    {hoursOverride && <a className="small-row panel calendar-day-setting" href={path('/availability?hours=' + activeDate)}>
      <Clock aria-hidden /><span><strong>{t('Working hours for this date')}</strong><small>{hoursOverride.windows.map(window => `${window.start}–${window.end}`).join(', ') || t('Unavailable')}</small></span><CaretRight aria-hidden />
    </a>}
    {timeOff.length > 0 && <div className="panel calendar-day-setting">{timeOff.map(item => <a className="small-row" key={item.id} href={path('/availability?edit=' + item.id)}>
      <Clock aria-hidden /><span><strong>{item.title}</strong><small>{t('All-day time off')}</small></span><CaretRight aria-hidden />
    </a>)}</div>}
    <div className="row-actions calendar-day-setting">
      {!conflicts.length && <More to="/calendar-conflicts">{t('Current conflicts')}</More>}
      <More to="/ignored-calendar-events">{t('Ignored conflicts')}</More>
    </div>
    {calendarAccess.enabled && <Section title={t('Device calendar events')}>
      <CalendarAccessMessage result={deviceCalendar} access={calendarAccess} />
      {ignoreEvent.error && <p className="form-error" role="alert">{ignoreEvent.error}</p>}
      {eventId && deviceCalendar.state === 'ready' && !hasTarget && <p className="slot-feedback" role="status">
        {t('The selected event may have moved or been removed.')}
      </p>}
      {deviceCalendar.state === 'ready' && <div className="panel">
        {selectedEvents.map(event => {
          const title = event.title.trim() || t('Untitled event');
          const target = event.id === eventId;
          return <article className={'small-row device-event-row' + (target ? ' selected-event' : '')} key={event.id}
            ref={target ? eventRow : undefined} tabIndex={target ? -1 : undefined}>
            <CalendarBlank aria-hidden />
            <span><strong>{title}</strong>
              <small>{[calendarEventLabel(event, activeDate), event.calendar].filter(Boolean).join(' · ')}</small></span>
            <Pill tone={event.ignored ? 'neutral' : 'amber'}>{t(event.ignored ? 'Ignored' : 'Busy')}</Pill>
            <div className="device-event-action">
              <button className="text-button" type="button" disabled={ignoreEvent.busy}
                aria-label={t(event.ignored ? 'Restore {event} for all bookings' : 'Ignore {event} for all bookings', { event: title })}
                onClick={() => void ignoreEvent.update(event.eventId, !event.ignored)}>
                {t(event.ignored ? 'Restore event' : 'Ignore event')}
              </button>
            </div>
          </article>;
        })}
        {!selectedEvents.length && <Empty>{t('No device calendar events on this date.')}</Empty>}
      </div>}
    </Section>}
  </>;
}
