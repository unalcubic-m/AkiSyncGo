import { Plus, X } from '@phosphor-icons/react';
import { useState } from 'react';
import { Field, PageHeader, RecordForm } from '../components/ui';
import { formatDuration } from '../domain/availability';
import { getBookingDurations, isCustomBookingDuration } from '../domain/booking-durations';
import type { RecordChange, Records } from '../domain/model';
import { t } from '../i18n';
import './booking-duration-picker.css';

export default function AppointmentDurations({ records, save }: {
  records: Records; save: (change: RecordChange) => Promise<void>;
}) {
  const [settings, setSettings] = useState(() => getBookingDurations(records));
  const [newMinutes, setNewMinutes] = useState('');
  const [feedback, setFeedback] = useState<'This duration is already on the list.' | 'Enter a duration from 5 to 1,435 minutes in 5-minute increments.'>();
  const [saved, setSaved] = useState(false);

  function addDuration() {
    const minutes = Number(newMinutes);
    if (!isCustomBookingDuration(minutes)) {
      setFeedback('Enter a duration from 5 to 1,435 minutes in 5-minute increments.');
      return;
    }
    if (settings.presets.includes(minutes)) {
      setFeedback('This duration is already on the list.');
      return;
    }
    setSettings({ ...settings, presets: [...settings.presets, minutes].sort((a, b) => a - b) });
    setNewMinutes('');
    setFeedback(undefined);
    setSaved(false);
  }

  function removeDuration(minutes: number) {
    const remaining = settings.presets.filter(preset => preset !== minutes);
    if (!remaining.length) return;
    const defaultMinutes = settings.defaultMinutes === minutes ? remaining[0] : settings.defaultMinutes;
    setSettings({ presets: remaining, defaultMinutes });
    setFeedback(undefined);
    setSaved(false);
  }

  return <>
    <PageHeader title={t('Appointment durations')} back="/data" />
    <RecordForm submit={t('Save durations')} onSave={async () => {
      await save(current => ({ ...current, bookingDurations: settings }));
      setSaved(true);
    }}>
      <fieldset className="duration-settings-options">
        <legend>{t('Default duration')}</legend>
        {settings.presets.map(minutes => <div key={minutes} className="duration-settings-option">
          <label className="check">
            <input type="radio" name="defaultDuration" checked={settings.defaultMinutes === minutes} onChange={() => {
              setSettings({ ...settings, defaultMinutes: minutes });
              setSaved(false);
            }} />{formatDuration(minutes)}
          </label>
          <button type="button" className="icon-button" disabled={settings.presets.length === 1}
            aria-label={t('Remove {duration}', { duration: formatDuration(minutes) })} onClick={() => removeDuration(minutes)}>
            <X size={17} aria-hidden />
          </button>
        </div>)}
      </fieldset>
      <div className="duration-settings-add">
        <Field label={t('New duration (min)')}>
          <input type="text" inputMode="numeric" value={newMinutes} onChange={event => {
            setNewMinutes(event.target.value);
            setFeedback(undefined);
          }} onKeyDown={event => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            addDuration();
          }} />
        </Field>
        <button className="button secondary" type="button" onClick={addDuration}><Plus size={16} aria-hidden />{t('Add')}</button>
      </div>
      {feedback && <p className="form-error" role="alert">{t(feedback)}</p>}
      {saved && <p className="save-status" role="status">{t('Appointment durations saved.')}</p>}
    </RecordForm>
  </>;
}
