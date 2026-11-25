import { SlidersHorizontal, X } from '@phosphor-icons/react';
import { useRef, useState } from 'react';
import { DurationWheel } from '../components/DurationWheel';
import { formatDuration } from '../domain/availability';
import { bookingMinuteStep, maximumCustomBookingDuration, type BookingDurations } from '../domain/booking-durations';
import { t } from '../i18n';
import './booking-duration-picker.css';

function CustomDurationControls({ initial, onApply, onClose }: {
  initial: number; onApply: (minutes: number) => void; onClose: () => void;
}) {
  const rounded = Math.min(maximumCustomBookingDuration, Math.round(initial / bookingMinuteStep) * bookingMinuteStep);
  const [hours, setHours] = useState(() => Math.floor(rounded / 60));
  const [minutes, setMinutes] = useState(() => rounded % 60);
  const total = hours * 60 + minutes;

  return <>
    <header className="booking-sheet-header">
      <h2 id="booking-custom-duration-heading">{t('Custom duration')}</h2>
      <button type="button" aria-label={t('Close')} autoFocus onClick={onClose}><X aria-hidden /></button>
    </header>
    <div className="booking-sheet-content">
      <div className="booking-duration-wheel-labels" aria-hidden="true">
        <span>{t('Hours')}</span><span>{t('Minutes')}</span>
      </div>
      <div className="booking-duration-wheels">
        <DurationWheel label={t('Hours')} maximum={Math.floor(maximumCustomBookingDuration / 60)} value={hours} onChange={setHours} />
        <DurationWheel label={t('Minutes')} maximum={60 - bookingMinuteStep} step={bookingMinuteStep} value={minutes} onChange={setMinutes} />
      </div>
    </div>
    <footer className="booking-sheet-footer">
      <button type="button" className="button" disabled={!total} onClick={() => {
        onApply(total);
        onClose();
      }}>{t('Find a time')}</button>
    </footer>
  </>;
}

export function BookingDurationPicker({ settings, duration, disabled, onChange }: {
  settings: BookingDurations; duration: number; disabled?: boolean; onChange: (minutes: number) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const custom = duration > 0 && !settings.presets.includes(duration);

  return <fieldset className="booking-presets booking-duration-picker">
    <legend>{t('Appointment duration')}</legend>
    <div className="booking-duration-presets">
      {settings.presets.map(minutes => <button key={minutes} type="button" className="button secondary"
        aria-pressed={minutes === duration} disabled={disabled} onClick={() => onChange(minutes)}>{formatDuration(minutes)}</button>)}
    </div>
    <div className="booking-duration-custom">
      <button type="button" className="text-button" aria-haspopup="dialog" disabled={disabled} onClick={() => {
        dialog.current?.showModal();
        setOpen(true);
      }}>
        <SlidersHorizontal size={17} aria-hidden />{t('Custom duration')}{custom && ` · ${formatDuration(duration)}`}
      </button>
    </div>
    <dialog ref={dialog} className="booking-sheet" aria-labelledby="booking-custom-duration-heading" onClose={() => setOpen(false)}>
      {open && <CustomDurationControls initial={duration || settings.defaultMinutes} onApply={onChange} onClose={() => dialog.current?.close()} />}
    </dialog>
  </fieldset>;
}
