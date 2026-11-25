import { Plus, X } from '@phosphor-icons/react';
import { useState } from 'react';
import { Field, PageHeader, RecordForm } from '../../src/components/ui';
import { formatDuration } from '../../src/domain/availability';
import { getLocale, t } from '../../src/i18n';
import { isGridDuration } from './BookingTimeGrid';

export type BookingDurations = { presets: number[]; defaultMinutes: number };
export const defaultBookingDurations: BookingDurations = { presets: [60, 90, 180], defaultMinutes: 90 };
export const bookingDurationsRoute = '/data/booking-durations';

const copy = (tr: string, en: string) => getLocale() === 'tr' ? tr : en;

export function BookingDurationSettings({ settings, onSave }: {
  settings: BookingDurations; onSave: (settings: BookingDurations) => void;
}) {
  const [presets, setPresets] = useState(settings.presets);
  const [defaultMinutes, setDefaultMinutes] = useState(settings.defaultMinutes);
  const [newMinutes, setNewMinutes] = useState('');
  const [feedback, setFeedback] = useState('');
  const [saved, setSaved] = useState(false);

  function addDuration() {
    const minutes = Number(newMinutes);
    if (!isGridDuration(minutes)) {
      setFeedback(copy('5 ile 1435 arasında 5’in katı bir süre girin.', 'Enter a duration from 5 to 1,435 minutes in 5-minute increments.'));
      return;
    }
    if (presets.includes(minutes)) {
      setFeedback(copy('Bu süre zaten listede.', 'This duration is already on the list.'));
      return;
    }
    setPresets([...presets, minutes].sort((a, b) => a - b));
    setNewMinutes('');
    setFeedback('');
    setSaved(false);
  }

  function removeDuration(minutes: number) {
    const remaining = presets.filter(item => item !== minutes);
    if (!remaining.length) return;
    if (defaultMinutes === minutes) setDefaultMinutes(remaining[0]);
    setPresets(remaining);
    setSaved(false);
  }

  return <>
    <PageHeader title={t('Appointment durations')} back="/data" />
    <RecordForm submit={t('Save durations')} onSave={async () => {
      onSave({ presets, defaultMinutes });
      setSaved(true);
    }}>
      <fieldset className="mock-duration-options">
        <legend>{copy('Varsayılan süre', 'Default duration')}</legend>
        {presets.map(minutes => <div className="mock-duration-option" key={minutes}>
          <label className="check">
            <input type="radio" name="defaultDuration" checked={minutes === defaultMinutes} onChange={() => {
              setDefaultMinutes(minutes);
              setSaved(false);
            }} />{formatDuration(minutes)}
          </label>
          <button type="button" className="icon-button" disabled={presets.length === 1} onClick={() => removeDuration(minutes)}
            aria-label={copy(`${formatDuration(minutes)} süresini kaldır`, `Remove ${formatDuration(minutes)}`)}><X size={17} aria-hidden /></button>
        </div>)}
      </fieldset>
      <div className="mock-add-duration">
        <Field label={copy('Yeni süre (dk)', 'New duration (min)')}>
          <input type="text" inputMode="numeric" value={newMinutes} onChange={event => {
            setNewMinutes(event.target.value);
            setFeedback('');
          }} onKeyDown={event => {
            if (event.key === 'Enter') {
              event.preventDefault();
              addDuration();
            }
          }} />
        </Field>
        <button className="button secondary" type="button" onClick={addDuration}><Plus size={16} aria-hidden />{copy('Ekle', 'Add')}</button>
      </div>
      {feedback && <p className="form-error" role="alert">{feedback}</p>}
      {saved && <p className="save-status" role="status">{t('Appointment durations saved.')}</p>}
    </RecordForm>
  </>;
}
