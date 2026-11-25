import { ArrowLeft, ArrowRight, CaretDown, CaretRight, CheckCircle, WarningCircle, X } from '@phosphor-icons/react';
import { useRef, useState } from 'react';
import { formatDuration } from '../../src/domain/availability';
import type { BookingReserve } from '../../src/domain/booking-optimum';
import { formatDate, minutes } from '../../src/domain/dates';
import type { Slot } from '../../src/domain/model';
import { getLocale, t } from '../../src/i18n';
import { AppointmentTimeFields } from '../../src/screens/AppointmentBooking';
import { isGridSlot } from './BookingTimeGrid';
import './optimum-time-picker.css';

export type OptimumSelectionMode = 'optimum' | 'first' | 'earlier' | 'later' | 'manual';
type Choice = { slot: Slot; mode: OptimumSelectionMode };
type Props = Choice & {
  duration: number;
  optimum?: Slot;
  first?: Slot;
  earlier: Slot[];
  later: Slot[];
  regularThrough?: string;
  reserve?: { state: BookingReserve; opening?: Slot };
  onEarlier: () => void;
  onLater: () => void;
  onApply: (slot: Slot, mode: OptimumSelectionMode) => boolean;
  availableBlocks: (date: string) => Slot[];
};

const copy = (tr: string, en: string) => getLocale() === 'tr' ? tr : en;
const sameSlot = (a: Slot, b?: Slot) => !!b && a.date === b.date && a.start === b.start && a.end === b.end;
const hasTime = ({ date, start, end }: Slot) => Boolean(date && start && end > start);
const pageSize = 6;

function modeLabel(mode: OptimumSelectionMode) {
  if (mode === 'first') return t('First availability');
  if (mode === 'manual') return t('Selected time');
  if (mode === 'later') return copy('Daha geç öneri', 'Later suggestion');
  return mode === 'optimum' ? copy('Önerilen · Optimum', 'Suggested · Optimum') : copy('Daha erken öneri', 'Earlier suggestion');
}

export function OptimumTimePicker({ slot, mode, duration, optimum, first, earlier, later, regularThrough, reserve, onEarlier, onLater, onApply, availableBlocks }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const manual = useRef<HTMLDetailsElement>(null);
  const [draft, setDraft] = useState<Choice>({ slot, mode });
  const [open, setOpen] = useState(false);
  const [visibleBlocks, setVisibleBlocks] = useState(pageSize);
  const [message, setMessage] = useState('');
  const earlierCount = earlier.length;
  const laterCount = later.length;
  const nextUsesExtraDay = !!regularThrough && laterCount > 0 && later[0].date > regularThrough && slot.date <= regularThrough;
  const onExtraDay = !!regularThrough && mode === 'later' && slot.date > regularThrough;
  const primaryChoices: Choice[] = [];
  if (optimum) primaryChoices.push({ slot: optimum, mode: 'optimum' });
  if (first) primaryChoices.push({ slot: first, mode: 'first' });
  const earlierChoices = earlier.filter(candidate => !sameSlot(candidate, optimum) && !sameSlot(candidate, first));
  const blocks = open && draft.slot.date ? availableBlocks(draft.slot.date) : [];

  function select(next: Choice) {
    if (next.slot.date !== draft.slot.date) setVisibleBlocks(pageSize);
    setMessage('');
    setDraft(next);
  }

  function openPicker() {
    setDraft({ slot, mode });
    setVisibleBlocks(pageSize);
    setMessage('');
    if (manual.current) manual.current.open = false;
    dialog.current?.showModal();
    setOpen(true);
  }

  function apply() {
    if (!hasTime(draft.slot)) return;
    if (!isGridSlot(draft.slot)) {
      setMessage(copy('Başlangıç ve bitiş saatlerini 5 dakikalık adımlarla seçin.', 'Choose start and end times in 5-minute increments.'));
    } else if (!onApply(draft.slot, draft.mode)) {
      setMessage(t('This time is no longer suggested. Choose another time.'));
    } else {
      dialog.current?.close();
    }
  }

  function timeOption(choice: Choice, label: string) {
    return <button key={`${choice.mode}:${choice.slot.date}:${choice.slot.start}`} type="button" className="booking-quick-time"
      aria-pressed={draft.mode === choice.mode && sameSlot(draft.slot, choice.slot)} onClick={() => select(choice)}>
      <strong>{label}</strong><span>{formatDate(choice.slot.date)} · {choice.slot.start}–{choice.slot.end}</span>
    </button>;
  }

  return <>
    <div className="mock-optimum-card">
      <div id="booking-slot-summary" className="booking-slot-summary mock-optimum-summary" aria-live="polite" aria-atomic="true">
        {hasTime(slot) ? <>
          <small>{modeLabel(mode)}</small>
          <strong><time dateTime={slot.date}>{formatDate(slot.date, { weekday: 'short', day: 'numeric', month: 'short' })}</time></strong>
          <span>{slot.start}–{slot.end}</span>
          {onExtraDay && <span className="mock-optimum-extra-day">{copy('Ek çalışma günü', 'Extra working day')}</span>}
        </> : <strong>{t('No time selected')}</strong>}
        {earlierCount > 1 && <span className="visually-hidden">{copy(`${earlierCount} daha erken öneri var.`, `${earlierCount} earlier suggestions available.`)}</span>}
      </div>
      <button type="button" className="text-button booking-slot-action mock-optimum-change" aria-haspopup="dialog" onClick={openPicker}>
        {t('Change time')}<CaretRight aria-hidden />
      </button>
      <div className="mock-optimum-actions" role="group" aria-label={copy('Randevu saati önerileri', 'Appointment time suggestions')}>
        <button type="button" className="mock-optimum-shift mock-optimum-earlier" data-state={earlierCount > 1 ? 'multiple' : 'last'} disabled={earlierCount === 0}
          aria-label={earlierCount ? copy('Daha erken', 'Earlier') : undefined}
          aria-describedby={earlierCount ? 'mock-optimum-earlier-hint' : undefined} onClick={onEarlier}>
          <ArrowLeft aria-hidden size={17} />
          {earlierCount ? <span>
            {copy('Daha erken', 'Earlier')}{earlierCount > 1 && <span aria-hidden> · {earlierCount}</span>}
            {earlierCount === 1 && <small id="mock-optimum-earlier-hint" className="mock-optimum-shift-hint">
              {copy('İlk uygun saate geç', 'Go to first available')}
            </small>}
            {earlierCount > 1 && <span id="mock-optimum-earlier-hint" className="visually-hidden">{copy(`${earlierCount} daha erken öneri var.`, `${earlierCount} earlier suggestions available.`)}</span>}
          </span> : <span>{copy('Daha erken saat yok', 'No earlier time')}</span>}
        </button>
        <button type="button" className="mock-optimum-shift mock-optimum-later" data-extra={nextUsesExtraDay || undefined} disabled={laterCount === 0}
          aria-label={laterCount ? copy('Daha geç', 'Later') : undefined}
          aria-describedby={nextUsesExtraDay || laterCount > 1 ? 'mock-optimum-later-hint' : undefined} onClick={onLater}>
          {laterCount ? <span>
            {copy('Daha geç', 'Later')}{laterCount > 1 && <span aria-hidden> · {laterCount}</span>}
            {nextUsesExtraDay ? <small id="mock-optimum-later-hint" className="mock-optimum-shift-hint">
              {copy('Ek çalışma gününe geç', 'Go to the extra working day')}
            </small> : laterCount > 1 && <span id="mock-optimum-later-hint" className="visually-hidden">
              {copy(`${laterCount} daha geç öneri var.`, `${laterCount} later suggestions available.`)}
            </span>}
          </span> : <span>{copy('Daha geç saat yok', 'No later time')}</span>}
          <ArrowRight aria-hidden size={17} />
        </button>
      </div>
      {reserve && hasTime(slot) && <p className="mock-optimum-reserve" data-state={reserve.state} role="status" aria-atomic="true">
        {reserve.state === 'preserved' ? <CheckCircle aria-hidden size={17} /> : <WarningCircle aria-hidden size={17} />}
        <span className="mock-optimum-reserve-copy">
          <strong>{reserve.state === 'preserved'
            ? copy('Bu saat, uzun bir randevu için yer bırakır', 'This time leaves room for a long appointment')
            : copy('Bu seçim uzun randevuya uygun boşluğu böler', 'This choice breaks up the opening for a long appointment')}</strong>
          {reserve.opening && <span className="mock-optimum-reserve-time">
            <time dateTime={reserve.opening.date}>{formatDate(reserve.opening.date, { weekday: 'short', day: 'numeric', month: 'short' })}</time>
            {' · '}{reserve.opening.start}–{reserve.opening.end}
            {' ('}{formatDuration(minutes(reserve.opening.end) - minutes(reserve.opening.start))}{')'}
          </span>}
        </span>
      </p>}
    </div>
    <dialog ref={dialog} className="booking-sheet" aria-labelledby="mock-optimum-picker-heading" onClose={() => setOpen(false)}
      onKeyDown={event => {
        if (event.key === 'Enter' && event.target instanceof HTMLInputElement) {
          event.preventDefault();
          apply();
        }
      }}>
      <header className="booking-sheet-header">
        <h2 id="mock-optimum-picker-heading">{t('Change time')}</h2>
        <button type="button" aria-label={t('Close time picker')} onClick={() => dialog.current?.close()}><X aria-hidden /></button>
      </header>
      <div className="booking-sheet-content booking-time-content">
        <section className="appointment-suggestions" aria-label={t('Suggested times')}>
          <strong>{t('Suggested times')}</strong>
          {primaryChoices.length ? primaryChoices.map(choice => timeOption(choice, choice.mode === 'optimum' ? 'Optimum' : t('First availability')))
            : <p className="muted">{t('No available times found.')}</p>}
          {earlierChoices.map(candidate => timeOption({ slot: candidate, mode: 'earlier' }, copy('Daha erken öneri', 'Earlier suggestion')))}
        </section>
        {blocks.length > 0 && <section className="appointment-suggestions" aria-labelledby="mock-optimum-block-heading">
          <strong id="mock-optimum-block-heading">{t('Available blocks on {date}', { date: formatDate(draft.slot.date) })}</strong>
          {blocks.slice(0, visibleBlocks).map(candidate => timeOption({ slot: candidate, mode: 'manual' }, copy('Uygun saat', 'Available time')))}
          {visibleBlocks < blocks.length && <button type="button" className="button secondary"
            onClick={() => setVisibleBlocks(limit => limit + pageSize)}>{t('Show more times')}</button>}
        </section>}
        <details ref={manual} className="booking-disclosure">
          <summary><strong>{t('Choose date and time')}</strong><CaretDown aria-hidden /></summary>
          <AppointmentTimeFields slot={draft.slot} duration={duration} onChange={slot => select({ slot, mode: 'manual' })} />
        </details>
        {message && <p className="slot-feedback" role="alert">{message}</p>}
      </div>
      <footer className="booking-sheet-footer">
        <button type="button" className="button" disabled={!hasTime(draft.slot)} onClick={apply}>{t('Use this time')}</button>
      </footer>
    </dialog>
  </>;
}
