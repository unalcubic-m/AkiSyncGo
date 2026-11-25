import { CalendarPlus, CaretDown, CaretRight } from '@phosphor-icons/react';
import { useState } from 'react';
import { ButtonLink, Field, More, PageHeader, path, Pill, RecordForm, value } from '../../src/components/ui';
import { formatDuration } from '../../src/domain/availability';
import { availabilityAlertDates, availabilityFallbackDays } from '../../src/domain/availability-settings';
import { addDays, formatDate } from '../../src/domain/dates';
import type { Records } from '../../src/domain/model';
import { appointmentOpeningsOn } from '../../src/domain/workflows';
import { getLocale, t } from '../../src/i18n';
import { bookingDurationsRoute } from './BookingDurationsMock';

export type AvailabilitySettings = {
  workingDays: number;
  calendarDays: number;
  remindersEnabled: boolean;
  minimumMinutes: number;
  reminderTimes: string[];
};

const exampleTimes = ['10:30', '12:30', '16:00', '17:00', '19:00'];
export const defaultAvailabilitySettings: AvailabilitySettings = {
  workingDays: 2, calendarDays: 3, remindersEnabled: true, minimumMinutes: 30, reminderTimes: exampleTimes.slice(0, 3),
};

const copy = (tr: string, en: string) => getLocale() === 'tr' ? tr : en;

function alertOpenings(records: Records, today: string, settings: AvailabilitySettings) {
  return availabilityAlertDates(records, today, settings).flatMap(date => appointmentOpeningsOn(records, date));
}

function openingTitle(opening: ReturnType<typeof alertOpenings>[number], tomorrow: string) {
  const duration = formatDuration(opening.duration);
  return opening.date === tomorrow ? t('{duration} open tomorrow', { duration })
    : t('{duration} open · {date}', { duration, date: formatDate(opening.date, { weekday: 'short', month: 'short', day: 'numeric' }) });
}

export function AvailabilityAlertMock({ records, today, readyCount, settings, durations }: {
  records: Records; today: string; readyCount: number; settings: AvailabilitySettings; durations: number[];
}) {
  const openings = alertOpenings(records, today, settings);
  const first = openings[0];
  if (!first) return null;
  const tomorrow = addDays(today, 1);
  return <details className="panel today-openings">
    <summary>
      <span className="opening-icon"><CalendarPlus size={20} aria-hidden /></span>
      <span><strong>{openingTitle(first, tomorrow)}</strong>
        <small>{first.start}–{first.end}{readyCount > 0 && <> · {t(readyCount === 1
          ? '{count} patient ready to book' : '{count} patients ready to book', { count: readyCount })}</>}</small></span>
      <CaretDown className="opening-caret" size={16} aria-hidden />
    </summary>
    <ul aria-label={t('Upcoming appointment openings')}>
      {openings.map(({ date, start, end, duration }) => {
        const fits = durations.filter(length => length <= duration).map(formatDuration).join(' / ');
        return <li key={`${date}-${start}`}>
          <a className="small-row" href={path(`/appointments/new?from=today&date=${date}&start=${start}&end=${end}`)}>
            <span><strong>{date === tomorrow ? t('Tomorrow') : formatDate(date)} · {start}–{end}</strong>
              {fits && <small>{t('Fits {duration}', { duration: fits })}</small>}</span>
            <Pill tone="green">{formatDuration(duration)}</Pill><CaretRight aria-hidden />
          </a>
        </li>;
      })}
    </ul>
    <div className="opening-actions"><More to="/data?from=today">{t('Settings')}</More></div>
  </details>;
}

export function AvailabilitySettingsMock({ settings, onSave, fromToday }: {
  settings: AvailabilitySettings; onSave: (settings: AvailabilitySettings) => void; fromToday: boolean;
}) {
  const [enabled, setEnabled] = useState(settings.remindersEnabled);
  const [times, setTimes] = useState(settings.reminderTimes);
  const [saved, setSaved] = useState(false);
  return <>
    <PageHeader title={t('Settings')} back={fromToday ? '/today' : '/work'} />
    <div className="setup-panel mock-availability-settings">
      <div><ButtonLink to={bookingDurationsRoute} secondary>{t('Appointment durations')}</ButtonLink></div>
      <RecordForm onSave={async data => {
        if (enabled && new Set(times).size !== times.length) {
          throw new Error(copy('Her bildirim için farklı bir saat seçin.', 'Choose a different time for each notification.'));
        }
        onSave({
          workingDays: Number(value(data, 'workingDays')),
          calendarDays: Number(value(data, 'calendarDays')),
          remindersEnabled: enabled,
          minimumMinutes: enabled ? Number(value(data, 'minimumMinutes')) : settings.minimumMinutes,
          reminderTimes: enabled ? [...times].sort() : settings.reminderTimes,
        });
        setSaved(true);
      }}>
        <h2>{copy('Müsaitlik uyarıları', 'Availability alerts')}</h2>
        <div className="mock-availability-fields">
          <Field label={copy('Çalışma günü sınırı', 'Working days to check')}>
            <input name="workingDays" type="number" min={1} max={365} defaultValue={settings.workingDays} required onChange={() => setSaved(false)} />
          </Field>
          <Field label={copy('Takvim günü sınırı', 'Calendar day limit')}>
            <input name="calendarDays" type="number" min={1} max={365} defaultValue={settings.calendarDays} required onChange={() => setSaved(false)} />
          </Field>
        </div>
        <p className="form-hint">{t('If there are no working days within the calendar limit, Today checks the next working day up to {count} calendar days away.', { count: availabilityFallbackDays })}</p>
        <h2>{copy('Sonraki çalışma günü bildirimleri', 'Reminders for the next working day')}</h2>
        <label className="check"><input type="checkbox" checked={enabled} onChange={event => {
          setEnabled(event.target.checked);
          setSaved(false);
        }} />{copy('Bildirimleri aç', 'Enable reminders')}</label>
        <div className="mock-availability-fields" hidden={!enabled}>
          <Field label={copy('En kısa boşluk (dk)', 'Minimum opening (min)')}>
            <input name="minimumMinutes" type="number" min={1} max={1439} defaultValue={settings.minimumMinutes}
              disabled={!enabled} required onChange={() => setSaved(false)} />
          </Field>
          <Field label={copy('Bildirim sayısı', 'Number of reminders')}>
            <select value={times.length} onChange={event => {
              const count = Number(event.target.value);
              setTimes(current => Array.from({ length: count }, (_, index) => current[index] ?? exampleTimes[index]));
              setSaved(false);
            }}>
              {exampleTimes.map((_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}
            </select>
          </Field>
          {times.map((time, index) => <Field key={index} label={copy(`Bildirim saati ${index + 1}`, `Reminder time ${index + 1}`)}>
            <input type="time" value={time} required={enabled} onChange={event => {
              const next = event.target.value;
              setTimes(current => current.map((entry, entryIndex) => entryIndex === index ? next : entry));
              setSaved(false);
            }} />
          </Field>)}
        </div>
        {saved && <p className="save-status" role="status">{copy('Ayarlar kaydedildi.', 'Settings saved.')}</p>}
      </RecordForm>
    </div>
  </>;
}
