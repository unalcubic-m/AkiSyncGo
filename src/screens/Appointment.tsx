import { errorMessage, getLocale, t } from '../i18n';
import { ArrowLeft, CalendarPlus, CaretDown, CaretLeft, CaretRight, Check, CopySimple, Notebook, PencilSimple, WarningCircle } from '@phosphor-icons/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DeviceCalendarAccess } from '../components/DeviceCalendarAccess';
import { AlertBadge, ButtonLink, Field, FormWarning, navigate, newId, Options, PageHeader, path, Pill, RecordForm, Section, value } from '../components/ui';
import { formatDuration, slotForDuration } from '../domain/availability';
import { bookingMinuteStep, getBookingDurations, isOnBookingMinuteGrid } from '../domain/booking-durations';
import { findBookingOptions } from '../domain/booking-optimum';
import { gridBookingSlotsOnDate } from '../domain/booking-time-grid';
import { calendarBufferConflicts, calendarEventsWithBuffer, eventBufferFor } from '../domain/calendar-event-buffer';
import { addDays, formatDate, localDate, minutes, titleDate } from '../domain/dates';
import { calendarConflicts, calendarEventLabel, localTimestamp, type DeviceCalendarEvent } from '../domain/device-calendar';
import { labReturnsRoute, labReturnsView } from '../domain/lab-returns';
import { type Appointment, type RecordChange, type Records, type Slot, visitStatuses } from '../domain/model';
import type { ScheduleConflict } from '../domain/schedule-conflicts';
import {
  activeAlerts, adjacentAppointmentSlots, alternativeSlots, appointmentSlotsOnDate, appointmentSuggestionStart, assessSlot, availableDayRange, findAvailableDay, isSlotAvailable, planningCandidates, preferredSlotOnDate, requiresSlotCheck, saveAppointment, type SlotSearch,
  freeAppointmentWindows, suggestAppointmentTimes, suggestionLookaheadDays, VisitOverlapConfirmationRequired,
} from '../domain/workflows';
import { AppointmentCalendarCheck, useAppointmentCalendar } from './AppointmentCalendarCheck';
import { AppointmentPatientPicker, AppointmentTimeFields, AppointmentTimePicker, type BookingTimeLabel } from './AppointmentBooking';
import { AppointmentSlotActions } from './AppointmentSlotActions';
import { BookingDurationPicker } from './BookingDurationPicker';
import { copyPatientPhone } from '../platform/clipboard';
import { ScheduleConflictList } from './CalendarConflicts';
import { AppointmentOutcome } from './AppointmentOutcome';
import AppointmentDelete from './AppointmentDelete';

function BookingPhoneButton({ phone }: { phone: string }) {
  const [result, setResult] = useState<{ ok: boolean }>();
  const message = result ? t(result.ok ? 'Copied' : 'Could not copy') : '';

  useEffect(() => {
    if (!result) return;
    const timer = window.setTimeout(() => setResult(undefined), 2200);
    return () => window.clearTimeout(timer);
  }, [result]);

  async function copyNumber() {
    try {
      await copyPatientPhone(phone);
      setResult({ ok: true });
    } catch {
      setResult({ ok: false });
    }
  }

  return <>
    <button type="button" className="button secondary booking-phone-button"
      aria-label={t('Copy patient phone {number}', { number: phone })} onClick={() => void copyNumber()}>
      {result?.ok ? <Check size={18} aria-hidden /> : <CopySimple size={18} aria-hidden />}
      <span dir="ltr">{phone}</span>
      {message && <span className="booking-phone-feedback">{message}</span>}
    </button>
    <span className="visually-hidden" role="status">{message}</span>
  </>;
}

type FormProps = {
  records: Records; item?: Appointment; selectedPatient?: string; selectedDate?: string; opening?: Slot; selectedRange?: Slot;
  today: string; now: Date; block?: boolean; calendarAccess: DeviceCalendarAccess; back: string; save: (change: RecordChange) => Promise<void>;
  fromCalendar?: boolean;
};

function sameSlot(left: Slot, right?: Slot) {
  return !!right && left.date === right.date && left.start === right.start && left.end === right.end;
}

function BufferConflictDetails({ events, minutes: length }: { events: DeviceCalendarEvent[]; minutes: number }) {
  const time = new Intl.DateTimeFormat(getLocale(), { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return <ul className="booking-buffer-events">{events.map(event => {
    const start = new Date(event.begin - length * 60_000);
    const crossDay = localDate(start) !== localDate(new Date(event.begin));
    const begin = (crossDay ? formatDate(localDate(start)) + ' ' : '') + time.format(start);
    return <li key={event.id}><strong>{event.title.trim() || t('Untitled event')}</strong>
      <span>{[event.calendar, calendarEventLabel(event)].filter(Boolean).join(' · ')}</span>
      <small>{t('{count}-minute buffer · {start}–{end}', { count: length, start: begin, end: time.format(event.begin) })}</small>
    </li>;
  })}</ul>;
}

export function AppointmentForm({ records, item, selectedPatient, selectedDate, opening, selectedRange, today, now, block, calendarAccess, back, save,
  fromCalendar }: FormProps) {
  const isBlock = item ? item.kind === 'Block' : block;
  const booking = !isBlock;
  const newBooking = booking && !item;
  const startOnSelectedDate = newBooking && !opening && !!selectedDate && !!fromCalendar;
  const useOptimum = newBooking && !opening && (startOnSelectedDate || (!selectedRange && !selectedDate));
  const eventBuffer = eventBufferFor(records);
  const bufferMinutes = useOptimum && eventBuffer.enabled ? eventBuffer.minutes : 0;
  const durationSettings = getBookingDurations(records);
  const [patientId, setPatientId] = useState(item?.patientId ?? selectedPatient ?? '');
  const patient = records.patients.find(entry => entry.id === patientId);
  const phone = patient?.phone.trim();
  const [preset, setPreset] = useState<number | undefined>(() => {
    if (item || !booking || selectedRange) return undefined;
    if (!opening) return durationSettings.defaultMinutes;
    const length = minutes(opening.end) - minutes(opening.start);
    return durationSettings.defaultMinutes <= length ? durationSettings.defaultMinutes
      : durationSettings.presets.filter(minutes => minutes <= length).at(-1) ?? durationSettings.defaultMinutes;
  });
  const prefill = useRef(!item && !isBlock && !selectedRange);
  const [slot, setSlot] = useState<Slot>(() => {
    if (item) return { date: item.date, start: item.start, end: item.end };
    if (selectedRange) return selectedRange;
    if (!isBlock) return { date: opening?.date ?? selectedDate ?? today, start: '', end: '' };
    const initial = { date: selectedDate ?? today, start: '09:00', end: '09:30' };
    if (selectedDate || !assessSlot(records, initial, null, undefined, now).length) return initial;
    return alternativeSlots(records, initial, patient, undefined, now)[0] ?? initial;
  });
  const statusOptions = isBlock ? ['Blocked time', 'Cancelled'] as const : visitStatuses;
  const [status, setStatus] = useState<Appointment['status']>(item?.status ?? (isBlock ? 'Blocked time' : 'Scheduled'));
  const [slotLabel, setSlotLabel] = useState<BookingTimeLabel>();
  const [ignored, setIgnored] = useState<string[]>([]);
  const [ignoredBuffers, setIgnoredBuffers] = useState<string[]>([]);
  const [skipCalendarCheck, setSkipCalendarCheck] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchResult, setSearchResult] = useState<{ message: string; offer?: Slot }>();
  const titleField = useRef<HTMLInputElement>(null);
  function changeSlot(next: Slot) {
    prefill.current = false;
    setSlot(next);
    setSlotLabel(undefined);
    setIgnored([]);
    setIgnoredBuffers([]);
    setSkipCalendarCheck(false);
    setSearchResult(undefined);
  }
  const hasLinkedNote = !!item && records.notes.some(note => note.appointmentId === item.id);
  const draft = {
    ...slot, id: item?.id ?? '', title: item?.title ?? '', notes: item?.notes ?? '', exceptions: item?.exceptions ?? [],
    ignoredCalendarEventIds: item?.ignoredCalendarEventIds,
    ...(isBlock
      ? { kind: 'Block', patientId: null, status, procedure: '' }
      : { kind: 'Visit', patientId, status, procedure: item?.procedure ?? '' }),
  } as Appointment;
  const checkSlot = requiresSlotCheck(draft, item);
  const suggestTimes = !isBlock && (status === 'Scheduled' || status === 'Completed');
  const openingDate = opening?.date;
  const calendarFrom = openingDate ?? today;
  const calendarThrough = openingDate ?? addDays(today, suggestionLookaheadDays);
  const calendar = useAppointmentCalendar(calendarAccess, suggestTimes, slot, calendarFrom, calendarThrough, bufferMinutes);
  const rawCalendarEvents = calendar.range.state === 'ready' ? calendar.range.events : undefined;
  const calendarEvents = useMemo(() => calendarEventsWithBuffer(rawCalendarEvents, bufferMinutes), [rawCalendarEvents, bufferMinutes]);
  const initialCalendar = selectedDate && !opening ? calendar.current : calendar.range;
  const issues = checkSlot && (!booking || slot.start) ? assessSlot(records, slot, draft.patientId, item?.id, now) : [];
  const overlaps = issues.filter(issue => issue.confirmationKey);
  const otherIssues = issues.filter(issue => !issue.confirmationKey);
  const kinds = [...new Set(issues.flatMap(issue => issue.kind ? [issue.kind] : []))];
  const duration = preset ?? (slot.start && slot.end ? minutes(slot.end) - minutes(slot.start) : 0);
  function validateBookingTime(next: Slot) {
    if (!newBooking || isOnBookingMinuteGrid(next)
      || (selectedRange && next.date === selectedRange.date && next.start === selectedRange.start && next.end === selectedRange.end)) return;
    const length = minutes(next.end) - minutes(next.start);
    if (length % bookingMinuteStep !== 0 && durationSettings.presets.includes(length)) return;
    return t('Choose start and end times in 5-minute increments.');
  }
  const awaitCalendar = calendar.range.state === 'loading';
  const failedCalendar = calendar.range.state === 'error';
  const findSuggestions = useCallback((when: Date) => {
    if (!openingDate) {
      const choices = suggestAppointmentTimes(records, duration, item?.id, when, calendarEvents);
      if (!newBooking) return choices;
      const search = { now: appointmentSuggestionStart(when), events: calendarEvents };
      return choices.flatMap(choice => {
        if (useOptimum && choice.label === 'First availability') return [];
        const first = gridBookingSlotsOnDate(records, choice.slot.date, duration, search)[0];
        return first ? [{ ...choice, slot: first }] : [];
      });
    }
    const sameDay = gridBookingSlotsOnDate(records, openingDate, duration, { now: when, events: calendarEvents }, opening)[0];
    return sameDay ? [{ label: 'First availability' as const, slot: sameDay }] : [];
  }, [opening, openingDate, records, duration, item?.id, calendarEvents, newBooking, useOptimum]);
  const suggestions = useMemo(() => suggestTimes && !awaitCalendar && !failedCalendar ? findSuggestions(new Date()) : [],
    [suggestTimes, awaitCalendar, failedCalendar, findSuggestions, now]);
  const findRanked = useCallback((length: number, when: Date, events = rawCalendarEvents, buffer = bufferMinutes) => findBookingOptions(records, length, {
    from: calendarFrom, through: calendarThrough, now: appointmentSuggestionStart(when), requestNow: when,
    events: calendarEventsWithBuffer(events, buffer),
  }), [records, calendarFrom, calendarThrough, rawCalendarEvents, bufferMinutes]);
  const ranking = useMemo(() => useOptimum && !awaitCalendar && !failedCalendar ? findRanked(duration, now) : undefined,
    [useOptimum, awaitCalendar, failedCalendar, findRanked, duration, now]);
  const earlier = ranking?.earlier(slot) ?? [];
  const laterAnchor = slot.start && slot.end > slot.start ? slot : startOnSelectedDate ? { ...slot, start: '00:00' } : undefined;
  const later = laterAnchor ? ranking?.later(laterAnchor) ?? [] : [];
  const reserve = ranking?.reserve(slot);
  const reserveOpening = reserve ? ranking?.reserveOpening(slot) : undefined;
  const unbufferedRanking = useMemo(() => ranking && bufferMinutes && rawCalendarEvents?.length
    ? findRanked(duration, now, rawCalendarEvents, 0) : undefined, [ranking, bufferMinutes, rawCalendarEvents, findRanked, duration, now]);

  const adjustedSuggestions = useMemo(() => {
    if (!unbufferedRanking || !rawCalendarEvents) return [];
    const affected: { slot: Slot; events: DeviceCalendarEvent[]; excluded: boolean }[] = [];
    for (const name of ['optimum', 'first'] as const) {
      const original = unbufferedRanking[name];
      if (!original || sameSlot(original, ranking?.[name]) || affected.some(entry => sameSlot(original, entry.slot))) continue;
      const conflicts = calendarBufferConflicts(original, rawCalendarEvents, bufferMinutes);
      const windows = conflicts.length ? [] : freeAppointmentWindows(records, original.date, { now, events: rawCalendarEvents });
      const window = windows.find(entry => entry.start <= original.start && entry.end >= original.end);
      const events = conflicts.length ? conflicts : window ? calendarBufferConflicts(window, rawCalendarEvents, bufferMinutes) : [];
      if (events.length) affected.push({ slot: original, events, excluded: conflicts.length > 0 });
    }
    return affected;
  }, [unbufferedRanking, rawCalendarEvents, ranking, bufferMinutes, records, now]);
  const currentEvents = calendar.current.state === 'ready' ? calendar.current.events : [];
  const overlapsEvent = useOptimum && calendarConflicts(slot, currentEvents).length > 0;
  const selectedBuffers = checkSlot && !overlapsEvent ? calendarBufferConflicts(slot, currentEvents, bufferMinutes) : [];
  const outstandingBuffers = selectedBuffers.filter(event => !ignoredBuffers.includes(event.id));

  function ignoreCalendarBuffer(next: Slot, events: DeviceCalendarEvent[]) {
    if (!sameSlot(next, slot)) changeSlot(next);
    setIgnoredBuffers(events.map(event => event.id));
  }

  function browseSuggestion(next: Slot | undefined, label: 'Earlier suggestion' | 'Later suggestion') {
    if (!next) return;
    changeSlot(next);
    if (sameSlot(next, ranking?.first)) setSlotLabel('First availability');
    else if (sameSlot(next, ranking?.optimum)) setSlotLabel('Suggested · Optimum');
    else setSlotLabel(label);
  }

  useEffect(() => {
    if (!prefill.current || initialCalendar.state === 'loading' || initialCalendar.state === 'error') return;
    prefill.current = false;
    if (opening) {
      const selected = gridBookingSlotsOnDate(records, opening.date, duration, { now: new Date(), events: calendarEvents }, opening)[0];
      if (selected) {
        setSlot(selected);
        setSlotLabel('Selected opening');
      } else {
        setSearchResult({ message: t('This opening is no longer available. Use Change time to find another time on this date.') });
      }
      return;
    }
    if (selectedDate) {
      const selected = gridBookingSlotsOnDate(records, selectedDate, duration, {
        now: appointmentSuggestionStart(new Date()),
        events: calendarEventsWithBuffer(initialCalendar.state === 'ready' ? initialCalendar.events : [], bufferMinutes),
      })[0];
      if (selected) setSlot(selected);
      else setSearchResult({ message: t('No opening on this date for a {duration} visit.', { duration: formatDuration(duration) }) });
      return;
    }
    if (useOptimum) {
      if (ranking?.optimum) {
        setSlot(ranking.optimum);
        setSlotLabel('Suggested · Optimum');
      }
      return;
    }
    const first = suggestions.find(option => option.label === 'First availability');
    if (first) {
      setSlot(first.slot);
      setSlotLabel(first.label);
    }
  }, [initialCalendar, suggestions, opening, selectedDate, duration, records, calendarEvents, bufferMinutes, useOptimum, ranking]);

  function findDay(range: { from: string; through: string }, direction: -1 | 1, length: number, options: SlotSearch) {
    if (!newBooking) return findAvailableDay(records, range, direction, length, options);
    for (let date = direction === 1 ? range.from : range.through; date >= range.from && date <= range.through; date = addDays(date, direction)) {
      const next = gridBookingSlotsOnDate(records, date, length, options)[0];
      if (next) return next;
    }
  }

  const slotNeighbors = useCallback((options: SlotSearch) => {
    if (!newBooking) return adjacentAppointmentSlots(records, slot, options);
    const blocks = gridBookingSlotsOnDate(records, slot.date, duration, options, opening);
    return {
      previous: blocks.filter(choice => choice.end <= slot.start).reverse(),
      next: blocks.filter(choice => choice.start >= slot.end),
    };
  }, [records, slot, duration, opening, newBooking]);

  async function search(action: () => Promise<void>) {
    prefill.current = false;
    setSearching(true);
    setSearchResult(undefined);
    try { await action(); }
    catch (failure) {
      setSearchResult({ message: errorMessage(failure, 'Could not search for an appointment.') });
    } finally { setSearching(false); }
  }

  async function changePreset(length: number) {
    await search(async () => {
      if (useOptimum && !startOnSelectedDate) {
        const events = await calendar.searchEvents({ from: calendarFrom, through: calendarThrough });
        const recommended = findRanked(length, new Date(), events).optimum;
        setPreset(length);
        changeSlot(recommended ?? { date: calendarFrom, start: '', end: '' });
        if (recommended) setSlotLabel('Suggested · Optimum');
        return;
      }
      if (opening) {
        const events = await calendar.searchEvents({ from: opening.date, through: opening.date });
        const options = { now: new Date(), events };
        const atCurrentTime = slot.start ? slotForDuration(opening.date, slot.start, length) : undefined;
        const sameDay = atCurrentTime && atCurrentTime.start >= opening.start && atCurrentTime.end <= opening.end
          && (length % bookingMinuteStep !== 0 || isOnBookingMinuteGrid(atCurrentTime)) && isSlotAvailable(records, atCurrentTime, options)
          ? atCurrentTime : gridBookingSlotsOnDate(records, opening.date, length, options, opening)[0];
        if (!sameDay) {
          setSearchResult({ message: t('No opening on this date for a {duration} visit.', { duration: formatDuration(length) }) });
          return;
        }
        setPreset(length);
        changeSlot(sameDay);
        if (sameDay.start === opening.start && sameDay.end <= opening.end) setSlotLabel('Selected opening');
        return;
      }
      const range = availableDayRange(slot.date, 1, today);
      const dates = range && { from: slot.date < today ? today : slot.date, through: range.through };
      const events = dates ? await calendar.searchEvents(dates) : [];
      const options = { now: appointmentSuggestionStart(new Date()), excludeId: item?.id, events: calendarEventsWithBuffer(events, bufferMinutes) };
      const sameDay = newBooking ? gridBookingSlotsOnDate(records, slot.date, length, options)[0] : preferredSlotOnDate(records, slot.date, length, options);
      setPreset(length);
      changeSlot(sameDay ?? slotForDuration(slot.date, startOnSelectedDate ? '' : slot.start, length));
      if (!sameDay) {
        const offer = range && findDay(range, 1, length, options);
        const message = slot.date ? t('No opening on this date for a {duration} visit.', { duration: formatDuration(length) }) : t('Choose a date to search for this visit.');
        setSearchResult({ message: range && !offer ? message + ' ' + t('No later opening found.') : message, offer });
      }
    });
  }

  async function moveDay(direction: -1 | 1) {
    await search(async () => {
      const range = availableDayRange(slot.date, direction, today);
      const next = range && findDay(range, direction, duration, {
        now: appointmentSuggestionStart(new Date()), excludeId: item?.id,
        events: calendarEventsWithBuffer(await calendar.searchEvents(range), bufferMinutes),
      });
      if (next) changeSlot(next);
      else setSearchResult({ message: t(direction === 1 ? 'No later available day found.' : 'No earlier available day found.') });
    });
  }

  async function moveSlot(direction: -1 | 1) {
    await search(async () => {
      const events = calendarEventsWithBuffer(await calendar.searchEvents({ from: slot.date, through: slot.date }), bufferMinutes);
      const when = new Date();
      const slots = slotNeighbors({ now: opening ? when : appointmentSuggestionStart(when), excludeId: item?.id, events });
      const next = (direction === -1 ? slots.previous : slots.next)[0];
      if (next) changeSlot(next);
      else setSearchResult({ message: t(direction === 1 ? 'No later available slot on this date.' : 'No earlier available slot on this date.') });
    });
  }

  const canMoveSlot = !!slot.date && !!slot.start && slot.end > slot.start && slot.date >= today;

  const navigationEvents = calendar.current.state === 'ready' ? calendar.current.events : undefined;
  const navigationReady = calendar.current.state !== 'loading' && calendar.current.state !== 'error';
  const slotCounts = useMemo(() => {
    if (!booking || !canMoveSlot || !navigationReady) return undefined;
    const options = { now: opening ? now : appointmentSuggestionStart(now), excludeId: item?.id,
      events: calendarEventsWithBuffer(navigationEvents, bufferMinutes) };
    const { previous, next } = slotNeighbors(options);
    return [previous.length, next.length];
  }, [booking, canMoveSlot, navigationReady, navigationEvents, slotNeighbors, now, opening, item?.id, bufferMinutes]);
  const firstAvailable = () => useOptimum ? findRanked(duration, new Date()).first : findSuggestions(new Date())
    .find(suggestion => suggestion.label === 'First availability')?.slot;
  function availableBlocks(date: string, when: Date) {
    if (!suggestTimes || (openingDate && date !== openingDate)) return [];
    const result = date === slot.date ? calendar.current : date >= calendarFrom && date <= calendarThrough ? calendar.range : undefined;
    if (!result || result.state === 'loading' || result.state === 'error') return [];
    const options = {
      now: openingDate ? when : appointmentSuggestionStart(when), excludeId: item?.id,
      events: calendarEventsWithBuffer(result.state === 'ready' ? result.events : [], bufferMinutes),
    };
    return newBooking ? gridBookingSlotsOnDate(records, date, duration, options, opening)
      : appointmentSlotsOnDate(records, date, duration, options);
  }
  const suggestedPatient = opening && !patient ? planningCandidates(records, today)[0] : undefined;

  const blockOptions = isBlock && issues.length > 0 ? alternativeSlots(records, slot, patient, item?.id, now) : [];
  const title = t(item ? (isBlock ? 'Edit closure' : 'Edit appointment') : (isBlock ? 'Close for appointments' : 'Add appointment'));

  const durationPicker = booking && <BookingDurationPicker settings={durationSettings} duration={duration}
    disabled={searching || (suggestTimes && awaitCalendar)} onChange={changePreset} />;
  const procedure = !isBlock && <Field label={t('Procedure (optional)')}><input name="procedure" defaultValue={item?.procedure} maxLength={255} /></Field>;
  const notes = <Field label={t(isBlock ? 'Notes (optional)' : 'Preparation notes (optional)')}>
    <textarea name="notes" rows={booking ? 3 : 4} defaultValue={item?.notes} maxLength={20_000} />
  </Field>;
  const statusField = item && <Field label={t('Status')}><select value={status} onChange={event => setStatus(event.target.value as Appointment['status'])}><Options values={statusOptions} /></select></Field>;
  const actionableSlot = newBooking && !searching && canMoveSlot && navigationReady && !outstandingBuffers.length
    && !validateBookingTime(slot) && isSlotAvailable(records, slot, { now, events: currentEvents }) ? slot : undefined;
  const extraActions = newBooking && <AppointmentSlotActions slot={actionableSlot}
    getTitle={() => titleField.current?.value.trim() ?? ''}
    onBlock={async (selected, blockTitle) => {
      await calendar.verify(selected, [], false, true, ignoredBuffers);
      await save(current => saveAppointment(current, {
        ...selected, id: newId(), kind: 'Block', patientId: null, status: 'Blocked time',
        title: blockTitle, notes: '', procedure: '', exceptions: [],
      }, {}, new Date()));
      navigate(back);
    }} />;
  const form = <RecordForm screen={booking}
      beforeSubmit={<>{booking && phone && <BookingPhoneButton key={phone} phone={phone} />}{extraActions}</>}
      cancel={booking ? undefined : back} submit={t(item ? 'Save changes' : isBlock ? 'Save closure' : 'Book visit')}
      disabled={searching || overlapsEvent || outstandingBuffers.length > 0 || (booking && !slot.start) || (!!opening && !canMoveSlot)
        || (!isBlock && (!records.patients.length || (prefill.current && awaitCalendar)))}
      onSave={async data => {
        if (draft.kind === 'Visit' && !patient) throw new Error('Choose a patient.');
        const timeError = validateBookingTime(slot);
        if (timeError) throw new Error(timeError);
        const next = { ...draft, id: item?.id ?? newId(), title: value(data, 'title') || (isBlock ? '' : t('Appointment')),
          procedure: isBlock ? '' : value(data, 'procedure'), notes: value(data, 'notes'),
        } as Appointment;
        const reasons = Object.fromEntries(kinds.map(kind => [kind, value(data, kind)]));
        if (checkSlot && !isBlock) {
          const acknowledged = await calendar.verify(next, ignored, skipCalendarCheck, useOptimum, ignoredBuffers);
          next.ignoredCalendarEventIds = acknowledged.length ? acknowledged : undefined;
        }
        const confirmedOverlaps = data.getAll('confirmedOverlap').map(String);
        try {
          await save(current => saveAppointment(current, next, reasons, new Date(), confirmedOverlaps));
        } catch (failure) {
          if (failure instanceof VisitOverlapConfirmationRequired) throw new FormWarning(failure.message);
          throw failure;
        }
        if (item) { navigate(back); return; }
        const params = new URLSearchParams();
        if (back === '/calendar-conflicts' || back === '/ignored-calendar-events') params.set('from', back.slice(1));
        else if (back.startsWith('/calendar')) params.set('from', 'calendar');
        else if (back.startsWith('/availability')) params.set('from', 'availability');
        else if (back === '/today') params.set('from', 'today');
        else if (back === '/planning') params.set('from', 'planning');
        else if (back === labReturnsRoute) params.set('from', labReturnsView);
        else if (back === '/attention') params.set('from', 'attention');
        navigate('/appointments/' + next.id + (params.size ? '?' + params : ''));
      }}>
      {!isBlock && <>
        <AppointmentPatientPicker records={records} patientId={patientId} suggested={suggestedPatient}
          locked={hasLinkedNote} onSelect={setPatientId} />
        {!records.patients.length && <p className="form-hint"><a href={path('/patients/new')}>{t('Add a patient to book their first appointment.')}</a></p>}
        {patient?.status === 'Passive' && <p className="form-hint">{t('{patient} is Passive.', { patient: patient.name })}</p>}
      </>}
      {isBlock && <div className="form-intro">
        <p>{t('Appointments cannot be added during this time range.')}</p>
        <small>{t('You can confirm an overlap when booking manually.')}</small>
      </div>}
      <Field label={t(isBlock ? 'Title' : 'Visit title (optional)')}><input ref={titleField} name="title" defaultValue={item?.title}
        placeholder={isBlock ? undefined : t('Appointment')} required={isBlock} maxLength={255} /></Field>
      {booking ? <section className="booking-when" aria-labelledby="booking-when">
        <h2 id="booking-when">{t(useOptimum ? 'Optimal Slot Picker' : 'When')}</h2>
        {durationPicker}
        <AppointmentTimePicker slot={slot} preset={preset} label={slotLabel} duration={duration}
          suggestions={useOptimum ? [
            ...(ranking?.first ? [{ label: 'First availability' as const, slot: ranking.first }] : []),
            ...suggestions.filter(choice => choice.label !== 'First availability'),
          ] : suggestions}
          loading={awaitCalendar} failed={failedCalendar} disabled={searching} fixedDate={!!opening} firstAvailable={firstAvailable}
          manualMinuteStep={newBooking && duration % bookingMinuteStep === 0 ? bookingMinuteStep * 60 : undefined}
          validateTime={validateBookingTime}
          optimum={useOptimum ? { slot: ranking?.optimum, earlier, later, reserve, reserveOpening,
            regularThrough: ranking?.regularThrough,
            find: () => findRanked(duration, new Date()).optimum,
            onEarlier: () => browseSuggestion(earlier[0], 'Earlier suggestion'),
            onLater: () => browseSuggestion(later[0], 'Later suggestion'),
          } : undefined}
          availableBlocks={availableBlocks} now={now}
          onApply={choice => {
            if (!sameSlot(choice.slot, slot)) changeSlot(choice.slot);
            setPreset(choice.preset);
            setSlotLabel(choice.label);
          }} />
        {outstandingBuffers.length > 0 && <div className="slot-feedback booking-buffer-feedback">
          <strong><WarningCircle size={19} aria-hidden /> {t('This time overlaps a calendar event buffer.')}</strong>
          <BufferConflictDetails events={selectedBuffers} minutes={bufferMinutes} />
          <button className="button secondary" type="button" onClick={() => ignoreCalendarBuffer(slot, selectedBuffers)}>
            {t('Ignore buffer for this appointment')}
          </button>
        </div>}
        {selectedBuffers.length > 0 && !outstandingBuffers.length && <div className="booking-buffer-applied" role="status">
          <strong><Check size={18} aria-hidden /> {t('Buffer ignored for this appointment')}</strong>
          <button className="text-button" type="button" onClick={() => {
            changeSlot(ranking?.optimum ?? { date: slot.date, start: '', end: '' });
            if (ranking?.optimum) setSlotLabel('Suggested · Optimum');
          }}>{t('Restore buffer')}</button>
        </div>}
        {!overlapsEvent && !selectedBuffers.length && adjustedSuggestions.map(affected => <div className="slot-feedback booking-buffer-feedback" key={affected.slot.date + affected.slot.start}>
          <strong><WarningCircle size={19} aria-hidden /> {t(affected.excluded ? '{date} · {time} overlaps a calendar event buffer.'
            : 'A calendar event buffer changed the suggestion for {date} · {time}.', {
            date: formatDate(affected.slot.date), time: affected.slot.start + '–' + affected.slot.end,
          })}</strong>
          <BufferConflictDetails events={affected.events} minutes={bufferMinutes} />
          {affected.excluded && <button className="button secondary" type="button" onClick={() => ignoreCalendarBuffer(affected.slot, affected.events)}>
            {t('Ignore buffer for this appointment')}
          </button>}
        </div>)}
        <div className={opening ? 'booking-jumps same-day' : 'booking-jumps'} role="group" aria-label={t(opening ? 'Available slot navigation' : 'Available day and slot navigation')}>
          {!opening && <button type="button" aria-label={t('Previous available day')} title={t('Previous available day')}
            disabled={searching || awaitCalendar || !slot.date || slot.date <= today || duration <= 0}
            onClick={() => void moveDay(-1)}><span aria-hidden>{'<<'}</span></button>}
          <button type="button" aria-label={slotCounts ? t('Previous slot, {count} available', { count: slotCounts[0] }) : t('Previous slot')}
            title={t('Previous slot')} disabled={searching || !slotCounts?.[0]}
            onClick={() => void moveSlot(-1)}>
            <span aria-hidden>{'<'}</span><strong>{slotCounts?.[0] ?? (navigationReady ? 0 : '–')}</strong>
          </button>
          <button type="button" aria-label={slotCounts ? t('Next slot, {count} available', { count: slotCounts[1] }) : t('Next slot')}
            title={t('Next slot')} disabled={searching || !slotCounts?.[1]}
            onClick={() => void moveSlot(1)}>
            <strong>{slotCounts?.[1] ?? (navigationReady ? 0 : '–')}</strong><span aria-hidden>{'>'}</span>
          </button>
          {!opening && <button type="button" aria-label={t('Next available day')} title={t('Next available day')}
            disabled={searching || awaitCalendar || !slot.date || duration <= 0}
            onClick={() => void moveDay(1)}><span aria-hidden>{'>>'}</span></button>}
        </div>
      </section> : <>
        {procedure}
        <AppointmentTimeFields slot={slot} preset={preset} duration={duration} disabled={searching} required
          onChange={(next, nextPreset) => { setPreset(nextPreset); changeSlot(next); }} />
      </>}
      {searching && <p className="muted" role="status">{t('Finding an available time…')}</p>}
      {searchResult && <div className="slot-feedback" role="status">
        <p>{searchResult.message}</p>
        {searchResult.offer && <button type="button" className="button secondary" onClick={() => changeSlot(searchResult.offer!)}>
          {t('Use {date} · {time}', { date: formatDate(searchResult.offer.date), time: `${searchResult.offer.start}–${searchResult.offer.end}` })}
        </button>}
      </div>}
      {isBlock && statusField}
      {!!otherIssues.length && <div className="slot-feedback" aria-live="polite">
        <strong>{t('Slot check')}</strong>
        <ul>{otherIssues.map(issue => <li key={issue.code}>{t(issue.messageKey, issue.values)}</li>)}</ul>
        {!!blockOptions.length && <div className="slot-suggestions">{blockOptions.map(suggestion =>
          <button type="button" className="button secondary" key={suggestion.date + suggestion.start} onClick={() => changeSlot(suggestion)}>
            {formatDate(suggestion.date)} · {suggestion.start}–{suggestion.end}
          </button>)}</div>}
      </div>}
      {!!overlaps.length && <fieldset className="slot-feedback slot-confirmations">
        <legend>{t('Scheduling overlaps')}</legend>
        <p>{t('Confirm each overlap to book this time.')}</p>
        {overlaps.map(issue => <label key={issue.confirmationKey} className="check slot-confirmation">
          <input type="checkbox" name="confirmedOverlap" value={issue.confirmationKey} />
          <span>{t('Ignore overlap for this booking')}<small>{t(issue.messageKey, issue.values)}</small></span>
        </label>)}
      </fieldset>}
      {(checkSlot || suggestTimes) && <AppointmentCalendarCheck calendar={calendar} slot={slot} ignored={ignored} skipCheck={skipCalendarCheck}
        onIgnore={(id, ignore) => setIgnored(previous => ignore ? [...previous, id] : previous.filter(entry => entry !== id))}
        onSkipCheck={setSkipCalendarCheck} showClear={!booking} preventOverlap={useOptimum} />}
      {!booking && suggestTimes && duration > 0 && <section aria-label={t('Suggested times')} className="appointment-suggestions">
        <strong>{t('Suggested times')}</strong>
        {awaitCalendar && <p className="muted">{t('Checking calendar availability…')}</p>}
        {failedCalendar && <p className="muted">{t('Retry the calendar check to see suggested times.')}</p>}
        {!awaitCalendar && !failedCalendar && !suggestions.length && <p className="muted">{t('No available times found.')}</p>}
        <div className="slot-suggestions">{suggestions.map(({ label, slot: option }) =>
          <button type="button" className="button secondary suggested-time" key={label} disabled={searching} onClick={() => {
            if (label !== 'First availability') return changeSlot(option);
            const current = firstAvailable();
            if (current) changeSlot(current);
            else setSearchResult({ message: t('No available times found.') });
          }}>
            <strong>{t(label)}</strong><span>{formatDate(option.date)} · {option.start}–{option.end}</span>
          </button>)}</div>
        <div className="slot-suggestions" aria-label={t('Available day navigation')} role="group">
          <button type="button" className="button secondary" disabled={searching || awaitCalendar || !slot.date || slot.date <= today}
            onClick={() => void moveDay(-1)}><CaretLeft aria-hidden />{' '}{t('Previous available day')}</button>
          <button type="button" className="button secondary" disabled={searching || awaitCalendar || !slot.date}
            onClick={() => void moveDay(1)}>{t('Next available day')}{' '}<CaretRight aria-hidden /></button>
        </div>
        <div className="slot-suggestions" aria-label={t('Available slot navigation')} role="group">
          <button type="button" className="button secondary" disabled={searching || awaitCalendar || !canMoveSlot}
            onClick={() => void moveSlot(-1)}><CaretLeft aria-hidden />{' '}{t('Previous slot')}</button>
          <button type="button" className="button secondary" disabled={searching || awaitCalendar || !canMoveSlot}
            onClick={() => void moveSlot(1)}>{t('Next slot')}{' '}<CaretRight aria-hidden /></button>
        </div>
      </section>}
      {kinds.map(kind => <Field key={kind} label={t('{kind} exception reason', { kind: t(kind) })}>
        <input name={kind} maxLength={255} placeholder={t('Required to book this slot')} />
      </Field>)}
      {booking ? <details className="booking-disclosure">
        <summary><span><strong>{t('Optional details')}</strong><small>{t(item ? 'Status, procedure, and preparation notes' : 'Procedure and preparation notes')}</small></span><CaretDown aria-hidden /></summary>
        <div className="booking-optional-fields">{statusField}{procedure}{notes}</div>
      </details> : notes}
    </RecordForm>;

  if (booking) return <div className="booking-page">
    <header className="booking-header">
      <a className="back" href={path(back)} aria-label={t('Back')}><ArrowLeft aria-hidden /></a>
      <h1>{title}</h1>
    </header>
    {form}
  </div>;
  return <><PageHeader title={title} back={back} />{form}</>;
}

export function AppointmentDetail({ item, records, now, back, editLink, followUpLink, conflicts, save, outcomePending, fromBookingWarning, remove, onDeleted }: {
  item: Appointment; records: Records; now: Date; back: string; editLink: string; followUpLink: string; conflicts: ScheduleConflict[]; save: (change: RecordChange) => Promise<void>;
  outcomePending: boolean; fromBookingWarning?: boolean; remove: () => Promise<void>; onDeleted: () => void;
}) {
  const patient = records.patients.find(entry => entry.id === item.patientId);
  const linked = records.notes.filter(note => note.appointmentId === item.id);
  const alerts = patient ? activeAlerts(records, patient.id) : [];
  const replacement = fromBookingWarning && item.kind === 'Visit' && (item.status === 'Cancelled' || item.status === 'Postponed')
    && localTimestamp(item.date, item.start) > now.getTime()
    ? '/appointments/new?' + new URLSearchParams({ from: 'today', date: item.date, start: item.start, end: item.end })
    : undefined;
  return <>
    <PageHeader title={item.title} subtitle={titleDate(item.date)} back={back}
      action={<div className="appointment-detail-actions">
        <ButtonLink secondary to={editLink} icon={PencilSimple}>{t(item.kind === 'Block' ? 'Edit closure' : 'Edit appointment')}</ButtonLink>
        <AppointmentDelete item={item} patientName={patient?.name} hasNotes={linked.length > 0}
          remove={remove} onDeleted={onDeleted} />
      </div>} />
    <div className="panel padded">
      <div className="row-heading"><strong>{item.start}–{item.end}</strong>
        <Pill tone={outcomePending ? 'amber' : item.status === 'Scheduled' ? 'blue' : item.status === 'Completed' ? 'green' : 'neutral'}>
          {t(outcomePending ? 'Outcome pending' : item.status)}
        </Pill>
      </div>
      {patient && <a className="profile-link" href={path('/patients/' + patient.id)}>{patient.name}<CaretRight aria-hidden /></a>}
      {alerts.length > 0 && <div className="appointment-detail-alerts">{alerts.map(alert => <AlertBadge alert={alert} key={alert.id} />)}</div>}
      {item.procedure && <p><strong>{t('Procedure')}</strong> {item.procedure}</p>}
      {item.notes && <p className="preserve"><strong>{t(item.kind === 'Block' ? 'Notes' : 'Preparation notes')}</strong> {item.notes}</p>}
    </div>
    {item.kind === 'Visit' && <AppointmentOutcome visit={item} now={now} followUpLink={followUpLink} save={save} />}
    {replacement && <div className="lab-appointment-replacement"><ButtonLink to={replacement} icon={CalendarPlus} secondary>
      {t('Book a patient at this time')}
    </ButtonLink></div>}
    {!!conflicts.length && <Section title={t('Scheduling conflicts')}>
      <ScheduleConflictList records={records} conflicts={conflicts} save={save} />
    </Section>}
    {patient && <Section title={t('Encounter notes')} action={<ButtonLink to={`/patients/${patient.id}/notes/new?appointment=${item.id}`} icon={Notebook} secondary>{t('Add note')}</ButtonLink>}>
      <div className="panel padded">
        {linked.length ? linked.map(note => <p key={note.id}><a href={path(`/patients/${patient.id}/notes/${note.id}`)}>{formatDate(note.date)} · {note.title || t('Encounter note')}</a></p>)
          : <p className="muted">{t('No notes linked to this visit.')}</p>}
      </div>
    </Section>}
    {!!item.exceptions.length && <Section title={t('Scheduling exceptions')}>
      <div className="panel">{item.exceptions.map((exception, index) => <article className="record-row" key={index}>
        <strong>{t(exception.kind)}</strong>
        <p>{exception.reason === 'Confirmed before saving.'
          ? t('Confirmed before saving.') : exception.reason}</p><small className="muted">{new Date(exception.recordedAt).toLocaleString(getLocale())}</small>
      </article>)}</div>
    </Section>}
  </>;
}
