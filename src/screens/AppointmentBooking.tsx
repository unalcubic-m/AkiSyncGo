import { getLocale, lastSeen, t } from '../i18n';
import { ArrowLeft, ArrowRight, CalendarBlank, CaretDown, CaretRight, CheckCircle, UserCircle, WarningCircle, X } from '@phosphor-icons/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Field } from '../components/ui';
import { formatDuration, slotForDuration } from '../domain/availability';
import { formatDate, minutes, parseDate } from '../domain/dates';
import type { Records, Slot } from '../domain/model';
import { searchBookingPatients, type planningCandidates, type suggestAppointmentTimes } from '../domain/workflows';
import './appointment-booking.css';

const patientResultPageSize = 8;

export function AppointmentPatientPicker({ records, patientId, suggested, locked = false, onSelect }: {
  records: Records; patientId: string; locked?: boolean; suggested?: ReturnType<typeof planningCandidates>[number]; onSelect: (id: string) => void;
}) {
  const patientChoice = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const results = useRef<HTMLDivElement>(null);
  const focusResult = useRef<number | null>(null);
  const [query, setQuery] = useState('');
  const [resultLimit, setResultLimit] = useState(patientResultPageSize);
  const patient = records.patients.find(entry => entry.id === patientId);
  const matches = useMemo(() => searchBookingPatients(records.patients, query), [records.patients, query]);
  const hasQuery = query.trim().length > 0;

  function updateQuery(value: string) {
    setQuery(value);
    setResultLimit(patientResultPageSize);
  }

  useEffect(() => {
    if (focusResult.current === null) return;
    results.current?.querySelectorAll('button')[focusResult.current]?.focus();
    focusResult.current = null;
  }, [resultLimit]);

  return <>
    <div className="field booking-patient">
      <span id="booking-patient-label">{t('Patient')}</span>
      <button ref={patientChoice} type="button" className="booking-patient-choice" aria-haspopup="dialog"
        aria-labelledby="booking-patient-label booking-patient-value" disabled={locked || !records.patients.length} onClick={() => {
          dialog.current?.showModal();
          search.current?.focus();
        }}>
        <span id="booking-patient-value" className={patient ? undefined : 'muted'}>{patient?.name ?? t('Choose a patient')}</span>
        {!locked && <CaretRight aria-hidden />}
      </button>
      {locked && <p className="form-hint">{t('Patient is linked to an encounter note.')}</p>}
      {suggested && <button className="booking-patient-suggestion" type="button" onClick={() => {
        onSelect(suggested.patient.id);
        patientChoice.current?.focus();
      }}>
        <UserCircle aria-hidden size={22} />
        <span>
          <small>{t('Suggested patient')}</small>
          <strong>{suggested.patient.name}</strong>
          <small>{t(suggested.patient.priority === 'Normal' ? 'Normal priority' : suggested.patient.priority)} · {suggested.seenOn
            ? lastSeen(suggested.elapsedDays)
            : suggested.elapsedDays === 0 ? t('Added today')
              : t(suggested.elapsedDays === 1 ? 'Added {count} day ago' : 'Added {count} days ago', { count: suggested.elapsedDays })}</small>
        </span>
        <CaretRight aria-hidden />
      </button>}
    </div>
    <dialog ref={dialog} className="booking-sheet" aria-labelledby="booking-patient-heading" onClose={() => updateQuery('')}>
      <header className="booking-sheet-header">
        <h2 id="booking-patient-heading">{t('Choose a patient')}</h2>
        <button type="button" aria-label={t('Close patient picker')} onClick={() => dialog.current?.close()}><X aria-hidden /></button>
      </header>
      <div className="booking-sheet-content">
        <Field label={t('Search patients')}><input ref={search} type="search" placeholder={t('Name, phone, or email')}
          value={query} onChange={event => updateQuery(event.target.value)} /></Field>
        {matches.length > 0 ? <>
          <div ref={results} className="booking-patient-list">{matches.slice(0, resultLimit).map(entry => {
            const phone = entry.phone.replace(/\D/g, '').slice(-4);
            return <button type="button" key={entry.id} aria-pressed={entry.id === patientId}
              onClick={() => { onSelect(entry.id); dialog.current?.close(); }}>
              <strong>{entry.name}</strong>
              <span className="booking-patient-result-details">
                {phone.length === 4 && <small>•••• {phone}</small>}
                {entry.status === 'Passive' && <small className="pill neutral">{t('Passive')}</small>}
              </span>
            </button>;
          })}</div>
          {matches.length > resultLimit && <button type="button" className="text-button booking-patient-more" onClick={() => {
            focusResult.current = resultLimit;
            setResultLimit(resultLimit + patientResultPageSize);
          }}>{t('Show more patients')}</button>}
        </> : <p className="muted booking-patient-search-hint" role="status">{t(hasQuery
          ? 'No matching patients. Try a surname or the last four digits of the phone number.'
          : 'Search by name, phone number, or email.')}</p>}
      </div>
    </dialog>
  </>;
}

export function AppointmentTimeFields({ slot, preset, duration, disabled, required, fixedDate, minuteStep, onChange }: {
  slot: Slot; preset?: number; duration: number; disabled?: boolean; required?: boolean; fixedDate?: boolean; minuteStep?: number;
  onChange: (slot: Slot, preset?: number) => void;
}) {
  return <div className={fixedDate ? 'form-grid' : 'form-grid three'}>
    {!fixedDate && <Field label={t('Date')}><input type="date" value={slot.date} onChange={event => onChange({ ...slot, date: event.target.value }, preset)} disabled={disabled} required={required} /></Field>}
    <Field label={t('Start time')}><input type="time" value={slot.start} step={minuteStep && minuteStep * 60} disabled={disabled} onChange={event => {
      const start = event.target.value;
      onChange(preset ? slotForDuration(slot.date, start, duration) : { ...slot, start }, preset);
    }} required={required} /></Field>
    <Field label={t('End time')}><input type="time" value={slot.end} step={minuteStep && minuteStep * 60} disabled={disabled}
      onChange={event => onChange({ ...slot, end: event.target.value })} required={required} /></Field>
  </div>;
}

type SuggestedTime = ReturnType<typeof suggestAppointmentTimes>[number];
const blockLabels = ['First slot', 'Last slot', 'Middle slot'] as const;
export type BookingTimeLabel = SuggestedTime['label'] | typeof blockLabels[number] | 'Selected opening'
  | 'Suggested · Optimum' | 'Earlier suggestion' | 'Later suggestion';
type TimeChoice = { slot: Slot; preset?: number; label?: BookingTimeLabel };
type OptimumChoice = {
  slot?: Slot;
  earlier: Slot[];
  later: Slot[];
  regularThrough?: string;
  reserve?: 'preserved' | 'lost';
  reserveOpening?: Slot;
  onEarlier: () => void;
  onLater: () => void;
  find: () => Slot | undefined;
};
const sameSlot = (left: Slot, right: Slot) => left.date === right.date && left.start === right.start && left.end === right.end;
const hasTime = ({ date, start, end }: Slot) => !!date && !!start && end > start;
const timePageSize = 6;

function orderedBlocks(blocks: Slot[]) {
  const first = blocks[0];
  const last = blocks[blocks.length - 1];
  if (!first) return [];
  if (first === last) return [{ slot: first, label: blockLabels[0] }];
  const midpoint = (minutes(first.start) + minutes(last.end)) / 2;
  const distance = (slot: Slot) => Math.abs((minutes(slot.start) + minutes(slot.end)) / 2 - midpoint);
  return [
    { slot: first, label: blockLabels[0] }, { slot: last, label: blockLabels[1] },
    ...blocks.slice(1, -1).sort((a, b) => distance(a) - distance(b)).map(slot => ({ slot, label: blockLabels[2] })),
  ];
}

export function AppointmentTimePicker({ slot, preset, label, duration, suggestions, optimum, loading, failed, disabled, fixedDate, firstAvailable, availableBlocks, now, manualMinuteStep, validateTime, onApply }: TimeChoice & {
  duration: number; suggestions: SuggestedTime[]; loading: boolean; failed: boolean; disabled: boolean; fixedDate?: boolean;
  optimum?: OptimumChoice;
  availableBlocks: (date: string, now: Date) => Slot[]; now: Date;
  firstAvailable: () => Slot | undefined; onApply: (choice: TimeChoice) => void;
  manualMinuteStep?: number; validateTime?: (slot: Slot, label?: BookingTimeLabel) => string | undefined;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const manual = useRef<HTMLDetailsElement>(null);
  const [choice, setChoice] = useState<TimeChoice>({ slot, preset, label });
  const [isOpen, setIsOpen] = useState(false);
  const [visibleBlocks, setVisibleBlocks] = useState(timePageSize);
  const blocks = isOpen ? orderedBlocks(availableBlocks(choice.slot.date, now)) : [];
  const pickedBlock = blockLabels.some(label => label === choice.label);
  const [message, setMessage] = useState('');
  const selected = hasTime(slot);
  const bookingDate = new Intl.DateTimeFormat(getLocale() === 'tr' ? 'tr' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  const rankedSuggestions: { label: BookingTimeLabel; slot: Slot }[] = [...suggestions];
  if (optimum?.slot) rankedSuggestions.unshift({ slot: optimum.slot, label: 'Suggested · Optimum' });
  for (const earlier of optimum?.earlier ?? []) {
    if (!rankedSuggestions.some(option => sameSlot(option.slot, earlier))) {
      rankedSuggestions.push({ slot: earlier, label: 'Earlier suggestion' });
    }
  }
  const earlierCount = optimum?.earlier.length ?? 0;
  const laterCount = optimum?.later.length ?? 0;
  const regularThrough = optimum?.regularThrough;
  const nextLater = optimum?.later[0];
  const nextUsesExtraDay = !!regularThrough && !!nextLater && nextLater.date > regularThrough && slot.date <= regularThrough;
  const onExtraDay = !!regularThrough && label === 'Later suggestion' && slot.date > regularThrough;
  const opening = optimum?.reserveOpening;
  const earlierHint = earlierCount > 1 ? t('{count} earlier suggestions available.', { count: earlierCount })
    : earlierCount === 1 ? t('Go to first available') : undefined;
  const laterHint = nextUsesExtraDay ? t('Go to the extra working day')
    : laterCount > 1 ? t('{count} later suggestions available.', { count: laterCount }) : undefined;
  function openPicker() {
    setChoice({ slot, preset, label });
    setVisibleBlocks(timePageSize);
    setMessage('');
    if (manual.current) manual.current.open = false;
    dialog.current?.showModal();
    setIsOpen(true);
  }

  function selectTime(next: TimeChoice) {
    if (next.slot.date !== choice.slot.date) setVisibleBlocks(timePageSize);
    setChoice(next);
    setMessage('');
  }

  function freshChoice({ slot: proposed, label }: TimeChoice) {
    if (label === 'First availability') return firstAvailable();
    if (label === 'Suggested · Optimum') return optimum?.find();
    if (label === 'Earlier suggestion' && !sameSlot(slot, proposed)
      && !optimum?.earlier.some(earlier => sameSlot(proposed, earlier))) return;
    if (label === 'Later suggestion' && !sameSlot(slot, proposed)
      && !optimum?.later.some(later => sameSlot(proposed, later))) return;
    return proposed;
  }

  const refreshingChoice = choice.label === 'First availability' || choice.label === 'Suggested · Optimum'
    || choice.label === 'Earlier suggestion' || choice.label === 'Later suggestion';
  const canApply = hasTime(choice.slot) && (!refreshingChoice || (!loading && !failed));
  function applyChoice() {
    if (!canApply) return;
    const next = freshChoice(choice);
    if (!next) return setMessage(t('No available times found.'));
    if (pickedBlock && !availableBlocks(next.date, new Date()).some(block => sameSlot(block, next))) {
      return setMessage(t('This time is no longer suggested. Choose another time.'));
    }
    const validationMessage = validateTime?.(next, choice.label);
    if (validationMessage) return setMessage(validationMessage);
    onApply({ ...choice, slot: next });
    dialog.current?.close();
  }

  const summary = <span id="booking-slot-summary" className="booking-slot-summary" aria-live="polite" aria-atomic="true">
    {selected ? <>
      <small>{t(label ?? 'Selected time')}</small>
      <strong><time dateTime={slot.date}>{bookingDate.format(parseDate(slot.date))}</time></strong>
      <span>{slot.start}–{slot.end}</span>
      {onExtraDay && <span className="booking-optimum-extra-day">{t('Extra working day')}</span>}
      {earlierCount > 1 && <span className="visually-hidden">{earlierHint}</span>}
    </> : <>
      <strong>{t(loading ? 'Finding an available time…' : 'No time selected')}</strong>
      {slot.date && <span><time dateTime={slot.date}>{bookingDate.format(parseDate(slot.date))}</time></span>}
    </>}
  </span>;

  return <>
    {optimum ? <div className="booking-optimum-card">
      {summary}
      <button type="button" className="text-button booking-slot-action booking-optimum-change" aria-describedby="booking-slot-summary"
        aria-haspopup="dialog" disabled={disabled} onClick={openPicker}>
        {t('Change time')}<CaretRight aria-hidden />
      </button>
      <div className="booking-optimum-actions" role="group" aria-label={t('Appointment time suggestions')}>
        <button type="button" className="booking-optimum-shift booking-optimum-earlier"
          data-state={earlierCount > 1 ? 'multiple' : earlierCount === 1 ? 'last' : 'none'}
          disabled={disabled || loading || failed || earlierCount === 0}
          aria-label={earlierCount ? t('Earlier time') : undefined}
          aria-describedby={earlierHint ? 'booking-optimum-earlier-hint' : undefined} onClick={optimum.onEarlier}>
          <ArrowLeft aria-hidden size={17} />
          {earlierCount ? <span>
            {t('Earlier time')}{earlierCount > 1 && <span aria-hidden> · {earlierCount}</span>}
            <small id="booking-optimum-earlier-hint" className={earlierCount > 1 ? 'visually-hidden' : 'booking-optimum-shift-hint'}>{earlierHint}</small>
          </span> : <span>{t('No earlier time')}</span>}
        </button>
        <button type="button" className="booking-optimum-shift booking-optimum-later" data-extra={nextUsesExtraDay || undefined}
          disabled={disabled || loading || failed || laterCount === 0}
          aria-label={laterCount ? t('Later time') : undefined}
          aria-describedby={laterHint ? 'booking-optimum-later-hint' : undefined} onClick={optimum.onLater}>
          {laterCount ? <span>
            {t('Later time')}{laterCount > 1 && <span aria-hidden> · {laterCount}</span>}
            {laterHint && <small id="booking-optimum-later-hint" className={nextUsesExtraDay ? 'booking-optimum-shift-hint' : 'visually-hidden'}>{laterHint}</small>}
          </span> : <span>{t('No later time')}</span>}
          <ArrowRight aria-hidden size={17} />
        </button>
      </div>
      {selected && optimum.reserve && <p className="booking-optimum-reserve" data-state={optimum.reserve} role="status" aria-atomic="true">
        {optimum.reserve === 'preserved' ? <CheckCircle aria-hidden size={17} /> : <WarningCircle aria-hidden size={17} />}
        <span className="booking-optimum-reserve-copy">
          <strong>{t(optimum.reserve === 'preserved' ? 'This time leaves room for a long appointment'
            : 'This choice breaks up the opening for a long appointment')}</strong>
          {opening && <span className="booking-optimum-reserve-time">
            <time dateTime={opening.date}>{bookingDate.format(parseDate(opening.date))}</time>
            {' · '}{opening.start}–{opening.end}{' ('}{formatDuration(minutes(opening.end) - minutes(opening.start))}{')'}
          </span>}
        </span>
      </p>}
    </div> : <button type="button" className="booking-slot" aria-label={t('Change time')} aria-describedby="booking-slot-summary"
      aria-haspopup="dialog" disabled={disabled} onClick={openPicker}>
      <span className="booking-slot-icon"><CalendarBlank aria-hidden /></span>
      {summary}
      <span className="booking-slot-action">{t('Change time')}{' '}<CaretRight aria-hidden /></span>
    </button>}
    <dialog ref={dialog} className="booking-sheet" aria-labelledby="booking-time-heading" onClose={() => setIsOpen(false)}
      onKeyDown={event => {
        if (optimum && event.key === 'Enter' && event.target instanceof HTMLInputElement) {
          event.preventDefault();
          applyChoice();
        }
      }}>
      <header className="booking-sheet-header">
        <h2 id="booking-time-heading">{t('Change time')}</h2>
        <button type="button" aria-label={t('Close time picker')} onClick={() => dialog.current?.close()}><X aria-hidden /></button>
      </header>
      <div className="booking-sheet-content booking-time-content">
        <section className="appointment-suggestions" aria-label={t('Suggested times')}>
          <strong>{t('Suggested times')}</strong>
          {loading && <p className="muted" role="status">{t('Checking calendar availability…')}</p>}
          {failed && <p className="muted">{t('Retry the calendar check to see suggested times.')}</p>}
          {!loading && !failed && !rankedSuggestions.length && <p className="muted">{t('No available times found.')}</p>}
          {rankedSuggestions.map(option => <button type="button" className="booking-quick-time" key={`${option.label}:${option.slot.date}:${option.slot.start}`}
            disabled={loading || failed}
            aria-pressed={!pickedBlock && sameSlot(choice.slot, option.slot) && (!optimum || choice.label === option.label)} onClick={() => {
              const next = freshChoice(option);
              if (next) selectTime({ slot: next, preset, label: option.label });
              else setMessage(t('No available times found.'));
            }}>
            <strong>{option.label === 'Suggested · Optimum' ? 'Optimum' : t(option.label)}</strong><span>{formatDate(option.slot.date)} · {option.slot.start}–{option.slot.end}</span>
          </button>)}
        </section>
        {blocks.length > 0 && <section className="appointment-suggestions" aria-labelledby="booking-block-heading">
          <strong id="booking-block-heading">{t('Available blocks on {date}', { date: formatDate(choice.slot.date) })}</strong>
          {blocks.slice(0, visibleBlocks).map(option => <button type="button" className="booking-quick-time" key={option.slot.start}
            aria-pressed={sameSlot(choice.slot, option.slot)
              && (pickedBlock || !rankedSuggestions.some(suggestion => sameSlot(suggestion.slot, option.slot)))}
            onClick={() => selectTime({ ...option, preset })}>
            <strong>{t(option.label)}</strong><span>{option.slot.start}–{option.slot.end}</span>
          </button>)}
          {visibleBlocks < blocks.length && <button type="button" className="button secondary"
            onClick={() => setVisibleBlocks(visibleBlocks + timePageSize)}>{t('Show more times')}</button>}
        </section>}
        <details ref={manual} className="booking-disclosure">
          <summary><strong>{t(fixedDate ? 'Enter a time' : 'Choose date and time')}</strong><CaretDown aria-hidden /></summary>
          <AppointmentTimeFields slot={choice.slot} preset={choice.preset} duration={duration} fixedDate={fixedDate} minuteStep={manualMinuteStep} onChange={(next, nextPreset) => {
            selectTime({ slot: next, preset: nextPreset });
          }} />
        </details>
        {message && <p className="slot-feedback" role="alert">{message}</p>}
      </div>
      <footer className="booking-sheet-footer">
        <button className="button" type="button" disabled={!canApply}
          onClick={applyChoice}>{t('Use this time')}</button>
      </footer>
    </dialog>
  </>;
}
