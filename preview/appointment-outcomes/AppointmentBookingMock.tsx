import { ArrowLeft, CaretDown, SlidersHorizontal, X } from '@phosphor-icons/react';
import { useMemo, useRef, useState } from 'react';
import { DurationWheel } from '../../src/components/DurationWheel';
import { Field, navigate, newId, Options, path, RecordForm, value } from '../../src/components/ui';
import { formatDuration } from '../../src/domain/availability';
import { findBookingOptions } from '../../src/domain/booking-optimum';
import { addDays, localDate, minutes } from '../../src/domain/dates';
import { type RecordChange, type Records, type Slot, type Visit, visitStatuses } from '../../src/domain/model';
import {
  appointmentSuggestionStart, availableDayRange, saveAppointment, suggestionLookaheadDays,
} from '../../src/domain/workflows';
import { getLocale, t } from '../../src/i18n';
import { AppointmentPatientPicker, AppointmentTimePicker, type BookingTimeLabel } from '../../src/screens/AppointmentBooking';
import type { BookingDurations } from './BookingDurationsMock';
import { bookingMinuteStep, findGridDay, gridSlotsOnDate, isGridSlot, maximumGridDuration } from './BookingTimeGrid';
import { OptimumTimePicker, type OptimumSelectionMode } from './OptimumTimePicker';

const copy = (tr: string, en: string) => getLocale() === 'tr' ? tr : en;
const slotLength = (slot: Slot) => minutes(slot.end) - minutes(slot.start);
const sameSlot = (left: Slot, right?: Slot) => !!right && left.date === right.date && left.start === right.start && left.end === right.end;
type TimeSelection = { slot: Slot; label?: BookingTimeLabel; mode?: OptimumSelectionMode };
const suggestionAnchors = [['First availability', 0], ['Next week', 7], ['Two weeks', 14]] as const;
type BookingSuggestion = { slot: Slot; label: typeof suggestionAnchors[number][0] };
const gridMessage = () => copy('Başlangıç ve bitiş saatlerini 5 dakikalık adımlarla seçin.', 'Choose start and end times in 5-minute increments.');

function CustomDurationForm({ duration, useOptimum, onApply, onClose }: {
  duration: number; useOptimum: boolean; onApply: (minutes: number) => void; onClose: () => void;
}) {
  const initial = Math.min(maximumGridDuration, Math.round(duration / bookingMinuteStep) * bookingMinuteStep);
  const [hours, setHours] = useState(() => Math.floor(initial / 60));
  const [minutes, setMinutes] = useState(() => initial % 60);
  const total = hours * 60 + minutes;

  return <form onSubmit={event => {
    event.preventDefault();
    if (!total) return;
    onApply(total);
    onClose();
  }}>
    <header className="booking-sheet-header">
      <h2 id="mock-duration-heading">{copy('Özel süre', 'Custom duration')}</h2>
      <button type="button" aria-label={t('Close')} autoFocus onClick={onClose}><X aria-hidden /></button>
    </header>
    <div className="booking-sheet-content">
      <div className="mock-duration-wheel-labels" aria-hidden="true">
        <span>{copy('Saat', 'Hours')}</span><span>{copy('Dakika', 'Minutes')}</span>
      </div>
      <div className="mock-duration-wheels">
        <DurationWheel label={copy('Saat', 'Hours')} maximum={23} value={hours} onChange={setHours} />
        <DurationWheel label={copy('Dakika', 'Minutes')} maximum={60 - bookingMinuteStep}
          step={bookingMinuteStep} value={minutes} onChange={setMinutes} />
      </div>
    </div>
    <footer className="booking-sheet-footer">
      <button type="submit" className="button" disabled={!total}>{useOptimum
        ? copy('Uygun saat bul', 'Find a time') : copy('İlk uygun saati bul', 'Find the first available time')}</button>
    </footer>
  </form>;
}

export function AppointmentBookingMock({ records, settings, now, item, selectedPatient, selectedDate, opening, selectedRange, back, originQuery, save }: {
  records: Records; settings: BookingDurations; now: Date; item?: Visit; selectedPatient?: string; selectedDate?: string;
  opening?: Slot; selectedRange?: Slot; back: string; originQuery: string; save: (change: RecordChange) => Promise<void>;
}) {
  const today = localDate(now);
  const search = { now: opening ? now : appointmentSuggestionStart(now), excludeId: item?.id };
  const [patientId, setPatientId] = useState(item?.patientId ?? selectedPatient ?? '');
  const [status, setStatus] = useState<Visit['status']>(item?.status ?? 'Scheduled');
  const existingSlot = item ?? (selectedRange && isGridSlot(selectedRange) ? selectedRange : undefined);
  const useOptimum = !existingSlot && !opening;
  const [duration, setDuration] = useState(() => {
    if (existingSlot) return slotLength(existingSlot);
    if (opening && settings.defaultMinutes > slotLength(opening)) {
      return settings.presets.filter(minutes => minutes <= slotLength(opening)).at(-1) ?? settings.defaultMinutes;
    }
    return settings.defaultMinutes;
  });
  const [selection, setSelection] = useState<TimeSelection | undefined>(() => existingSlot && { slot: existingSlot });
  const custom = useRef<HTMLDialogElement>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [gridError, setGridError] = useState(false);
  const currentIsPreset = settings.presets.includes(duration);
  const range = selectedDate && selectedDate > today
    ? { from: selectedDate, through: addDays(selectedDate, suggestionLookaheadDays) }
    : availableDayRange(addDays(today, -1), 1, today);
  const from = range?.from;
  const through = range?.through;
  const ranked = useMemo(() => useOptimum && from && through ? findBookingOptions(records, duration, {
    from, through, now: appointmentSuggestionStart(now), requestNow: now,
  }) : undefined, [useOptimum, from, through, records, duration, now]);
  const suggestions = ranked ? [] : findTimes(duration);
  const { slot, label, mode = 'manual' } = selection ?? defaultTime();
  const hasTime = !!slot.start && slot.end > slot.start;
  const earlier = hasTime && ranked ? ranked.earlier(slot) : [];
  const later = hasTime && ranked ? ranked.later(slot) : [];
  const reserve = hasTime ? ranked?.reserve(slot) : undefined;
  const available = hasTime ? gridSlotsOnDate(records, slot.date, duration, search, opening) : [];
  const previous = available.filter(candidate => candidate.end <= slot.start).reverse();
  const next = available.filter(candidate => candidate.start >= slot.end);
  const earlierDays = !opening && availableDayRange(slot.date, -1, today);
  const laterDays = !opening && availableDayRange(slot.date, 1, today);

  function findTimes(length: number): BookingSuggestion[] {
    if (opening) {
      const first = gridSlotsOnDate(records, opening.date, length, search, opening)[0];
      return first ? [{ slot: first, label: 'First availability' }] : [];
    }
    const from = selectedDate ?? item?.date;
    if (from && from > today) {
      const first = findGridDay(records, { from, through: addDays(from, suggestionLookaheadDays) }, 1, length, search);
      return first ? [{ slot: first, label: 'First availability' }] : [];
    }
    const suggestions: BookingSuggestion[] = [];
    for (const [label, offset] of suggestionAnchors) {
      const range = availableDayRange(addDays(today, offset - 1), 1, today);
      const slot = range && findGridDay(records, range, 1, length, search);
      if (slot && !suggestions.some(other => other.slot.date === slot.date && other.slot.start === slot.start)) suggestions.push({ label, slot });
    }
    return suggestions;
  }

  function defaultTime(): TimeSelection {
    if (ranked?.optimum) return { slot: ranked.optimum, mode: 'optimum' };
    const first = suggestions[0];
    if (first) return { slot: first.slot, label: opening ? 'Selected opening' : first.label };
    return { slot: { date: opening?.date ?? selectedDate ?? today, start: '', end: '' }, mode: 'optimum' };
  }

  function applyDuration(minutes: number) {
    setDuration(minutes);
    setSelection(undefined);
    setGridError(false);
  }

  function chooseTime(next: TimeSelection) {
    setSelection(next);
    setGridError(false);
  }

  function browseSuggestion(next: Slot | undefined, direction: 'earlier' | 'later') {
    if (!next) return;
    let nextMode: OptimumSelectionMode = direction;
    if (sameSlot(next, ranked?.first)) nextMode = 'first';
    else if (sameSlot(next, ranked?.optimum)) nextMode = 'optimum';
    chooseTime({ slot: next, mode: nextMode });
  }

  function moveDay(direction: -1 | 1) {
    const range = direction === -1 ? earlierDays : laterDays;
    const next = range && findGridDay(records, range, direction, duration, search);
    if (next) chooseTime({ slot: next });
  }

  function openCustomDuration() {
    custom.current?.showModal();
    setCustomOpen(true);
  }

  return <div className="booking-page">
    <header className="booking-header">
      <a className="back" href={path(back)} aria-label={t('Back')}><ArrowLeft aria-hidden /></a>
      <h1>{t(item ? 'Edit appointment' : 'Add appointment')}</h1>
    </header>
    <RecordForm screen submit={t(item ? 'Save changes' : 'Book visit')} disabled={!hasTime} onSave={async data => {
      if (!records.patients.some(patient => patient.id === patientId)) throw new Error('Choose a patient.');
      const originalTime = item && item.date === slot.date && item.start === slot.start && item.end === slot.end;
      if (!originalTime && !isGridSlot(slot)) throw new Error(gridMessage());
      const next: Visit = {
        ...item, ...slot, id: item?.id ?? newId(), kind: 'Visit', patientId, status,
        title: value(data, 'title') || t('Appointment'), procedure: value(data, 'procedure'), notes: value(data, 'notes'),
        exceptions: item?.exceptions ?? [],
      };
      await save(current => saveAppointment(current, next, {}, now));
      navigate(item ? back : '/appointments/' + next.id + originQuery);
    }}>
      <AppointmentPatientPicker records={records} patientId={patientId} onSelect={setPatientId}
        locked={!!item && records.notes.some(note => note.appointmentId === item.id)} />
      <Field label={t('Visit title (optional)')}><input name="title" defaultValue={item?.title} placeholder={t('Appointment')} maxLength={255} /></Field>
      <section className="booking-when" aria-labelledby="mock-booking-when">
        <h2 id="mock-booking-when">{t('When')}</h2>
        <fieldset className="booking-presets mock-booking-duration">
          <legend>{copy('Randevu süresi', 'Appointment duration')}</legend>
          <div className="mock-booking-presets">
            {settings.presets.map(minutes => <button key={minutes} type="button" className="button secondary"
              aria-pressed={duration === minutes} onClick={() => applyDuration(minutes)}>{formatDuration(minutes)}</button>)}
          </div>
          <div className="mock-booking-custom-action">
            <button type="button" className="text-button" aria-haspopup="dialog" onClick={openCustomDuration}>
              <SlidersHorizontal size={17} aria-hidden />{copy('Özel süre', 'Custom duration')}{!currentIsPreset && ` · ${formatDuration(duration)}`}
            </button>
          </div>
        </fieldset>
        {ranked ? <OptimumTimePicker slot={slot} mode={mode} duration={duration} first={ranked.first} optimum={ranked.optimum}
          earlier={earlier} later={later} regularThrough={ranked.regularThrough}
          reserve={reserve && { state: reserve, opening: ranked.reserveOpening(slot) }}
          availableBlocks={date => gridSlotsOnDate(records, date, duration, search)}
          onEarlier={() => browseSuggestion(earlier[0], 'earlier')}
          onLater={() => browseSuggestion(later[0], 'later')}
          onApply={(next, nextMode) => {
            if (!isGridSlot(next)) return false;
            chooseTime({ slot: next, mode: nextMode });
            setDuration(slotLength(next));
            return true;
          }} /> : <AppointmentTimePicker slot={slot} label={label} duration={duration} suggestions={suggestions} now={now}
          loading={false} failed={false} disabled={false} fixedDate={!!opening} firstAvailable={() => findTimes(duration)[0]?.slot}
          availableBlocks={date => gridSlotsOnDate(records, date, duration, search, opening)}
          onApply={choice => {
            if (!isGridSlot(choice.slot)) {
              setGridError(true);
              return;
            }
            chooseTime(choice);
            setDuration(slotLength(choice.slot));
          }} />}
        <div className={opening ? 'booking-jumps same-day' : 'booking-jumps'} role="group" aria-label={t('Available day and slot navigation')}>
          {!opening && <button type="button" aria-label={t('Previous available day')} disabled={!earlierDays}
            onClick={() => moveDay(-1)}>{'<<'}</button>}
          <button type="button" aria-label={t('Previous slot, {count} available', { count: previous.length })} disabled={!previous.length}
            onClick={() => chooseTime({ slot: previous[0] })}>{'<'} {previous.length}</button>
          <button type="button" aria-label={t('Next slot, {count} available', { count: next.length })} disabled={!next.length}
            onClick={() => chooseTime({ slot: next[0] })}>{next.length} {'>'}</button>
          {!opening && <button type="button" aria-label={t('Next available day')} disabled={!laterDays} onClick={() => moveDay(1)}>{'>>'}</button>}
        </div>
        {gridError && <p className="form-error" role="alert">{gridMessage()}</p>}
        {!hasTime && <p className="muted" role="status">{t('No available times found.')}</p>}
      </section>
      <details className="booking-disclosure">
        <summary><span><strong>{t('Optional details')}</strong><small>{t(item ? 'Status, procedure, and preparation notes' : 'Procedure and preparation notes')}</small></span><CaretDown aria-hidden /></summary>
        <div className="booking-optional-fields">
          {item && <Field label={t('Status')}><select value={status} onChange={event => setStatus(event.target.value as Visit['status'])}><Options values={visitStatuses} /></select></Field>}
          <Field label={t('Procedure (optional)')}><input name="procedure" defaultValue={item?.procedure} maxLength={255} /></Field>
          <Field label={t('Preparation notes (optional)')}><textarea name="notes" defaultValue={item?.notes} rows={3} maxLength={20_000} /></Field>
        </div>
      </details>
    </RecordForm>
    <dialog ref={custom} className="booking-sheet mock-duration-sheet" aria-labelledby="mock-duration-heading" onClose={() => setCustomOpen(false)}>
      {customOpen && <CustomDurationForm duration={duration} useOptimum={useOptimum} onApply={applyDuration} onClose={() => custom.current?.close()} />}
    </dialog>
  </div>;
}
