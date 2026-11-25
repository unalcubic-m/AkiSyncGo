import { Bell, CalendarBlank, CaretRight, Clock, WarningCircle, type Icon } from '@phosphor-icons/react';
import { useState } from 'react';
import LanguageSelect from '../../src/components/LanguageSelect';
import { Field, PageHeader, path, RecordForm, value } from '../../src/components/ui';
import { availabilityFallbackDays, availabilitySettingsFor, maxAlertDays, reminderTimeChoices } from '../../src/domain/availability-settings';
import type { Records } from '../../src/domain/model';
import { t } from '../../src/i18n';
import { WeekdayPicker, weekdays } from '../../src/screens/ScheduleSettings';
import { labTitle } from './Laboratory';
import { bufferRoute, copy, notificationsRoute, reset, update, type BufferSettings, type LabNotificationSettings } from './state';

const durationChoices = [15, 30, 60];
const durationLabel = (minutes: number) => copy(`${minutes} minutes`, `${minutes} dakika`);
function labDaysLabel(days: number[]) {
  if (days.length === weekdays.length) return copy('Every day', 'Her gün');
  if (!days.length) return copy('Choose reminder days', 'Hatırlatma günlerini seç');
  return weekdays.filter(({ day }) => days.includes(day)).map(({ short }) => t(short)).join(', ');
}

function SettingLink({ to, title, summary, icon: Icon }: { to: string; title: string; summary: string; icon: Icon }) {
  return <a className="small-row lab-setting-link" href={path(to)}>
    <span className="lab-icon lab-icon-blue"><Icon size={21} aria-hidden /></span>
    <span><strong>{title}</strong><small>{summary}</small></span><CaretRight size={16} aria-hidden />
  </a>;
}

function Toggle({ checked, onChange, title, summary }: {
  checked: boolean; onChange: (checked: boolean) => void; title: string; summary: string;
}) {
  return <label className="lab-toggle">
    <span><strong>{title}</strong><small>{summary}</small></span>
    <input type="checkbox" role="switch" aria-label={title} checked={checked} onChange={event => onChange(event.target.checked)} />
  </label>;
}

export function Settings({ buffer, notification }: { buffer: BufferSettings; notification: LabNotificationSettings }) {
  const [resetPending, setResetPending] = useState(false);
  const [didReset, setDidReset] = useState(false);
  return <>
    <PageHeader title={t('Settings')} back="/work" />
    <div className="panel lab-setting-links">
      <SettingLink to={notificationsRoute} title={copy('Notifications', 'Bildirimler')} icon={Bell}
        summary={notification.enabled ? copy(`Daily lab check · ${notification.time} · ${labDaysLabel(notification.days)}`,
          `Günlük laboratuvar kontrolü · ${notification.time} · ${labDaysLabel(notification.days)}`)
          : copy('Daily lab check is off', 'Günlük laboratuvar bildirimi kapalı')} />
      <SettingLink to={bufferRoute} title={copy('Calendar event buffer', 'Takvim etkinliği tamponu')} icon={CalendarBlank}
        summary={buffer.enabled ? copy(`${durationLabel(buffer.minutes)} before events`, `Etkinliklerden önce ${durationLabel(buffer.minutes)}`)
          : copy('Off', 'Kapalı')} />
      <SettingLink to="/data/durations" title={t('Appointment durations')} summary={copy('Slot length presets', 'Hazır randevu süreleri')} icon={Clock} />
      <SettingLink to="/data/availability" title={t('Availability alerts')} summary={copy('Days to check for openings', 'Boşluk aranacak günler')} icon={WarningCircle} />
    </div>
    <div className="panel padded lab-language"><LanguageSelect /></div>
    <div className="lab-preview-reset">
      {resetPending ? <><p>{copy('Reset patients, lab checks, and settings in this preview?', 'Bu önizlemedeki hasta kayıtları, laboratuvar kontrolleri ve ayarlar sıfırlansın mı?')}</p>
        <div className="row-actions"><button type="button" className="button secondary" onClick={() => { reset(); setResetPending(false); setDidReset(true); }}>
          {copy('Reset preview', 'Önizlemeyi sıfırla')}</button>
          <button type="button" className="text-button" onClick={() => setResetPending(false)}>{t('Cancel')}</button></div></>
        : <button type="button" className="text-button" onClick={() => { setResetPending(true); setDidReset(false); }}>{t('Reset fictional records')}</button>}
      {didReset && <p className="lab-status" role="status">{copy('Fictional records reset.', 'Örnek kayıtlar sıfırlandı.')}</p>}
    </div>
  </>;
}

export function Notifications({ notification, records }: { notification: LabNotificationSettings; records: Records }) {
  const availability = availabilitySettingsFor(records);
  const [lab, setLab] = useState(notification);
  const [openings, setOpenings] = useState(availability.remindersEnabled);
  const [times, setTimes] = useState(availability.reminderTimes);
  const [minimum, setMinimum] = useState(String(availability.minimumMinutes));
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  return <>
    <PageHeader title={copy('Notifications', 'Bildirimler')} back="/data" />
    <div className="lab-settings-form">
      <RecordForm submit={copy('Save preferences', 'Tercihleri kaydet')} onSave={async () => {
        if (lab.enabled && !lab.days.length) {
          setError(t('Choose at least one weekday.'));
          return;
        }
        if (openings && new Set(times).size !== times.length) {
          setError(t('Choose a different time for each reminder.'));
          return;
        }
        update(current => {
          const previous = availabilitySettingsFor(current.records);
          return { ...current,
            notification: { ...lab, time: lab.time || current.notification.time, days: lab.days.length ? lab.days : current.notification.days },
            records: { ...current.records, availabilitySettings: { ...previous, remindersEnabled: openings,
              minimumMinutes: openings ? Number(minimum) : previous.minimumMinutes,
              reminderTimes: openings ? [...times].sort() : previous.reminderTimes,
            } },
          };
        });
        setSaved(true);
      }}>
        <div className="lab-settings-card" onChange={() => { setSaved(false); setError(''); }}>
          <Toggle title={labTitle()} summary={labDaysLabel(lab.days)}
            checked={lab.enabled} onChange={enabled => setLab({ ...lab, enabled })} />
          {lab.enabled && <>
            <Field label={copy('Daily reminder time', 'Günlük hatırlatma saati')}>
              <input type="time" value={lab.time} required onChange={event => setLab({ ...lab, time: event.target.value })} />
            </Field>
            <div className="lab-reminder-days"><WeekdayPicker selected={lab.days} onChange={days => setLab({ ...lab, days })} /></div>
          </>}
        </div>
        <div className="lab-settings-card" onChange={() => { setSaved(false); setError(''); }}>
          <Toggle title={t('Availability alerts')} summary={copy('Reminders for the next working day', 'Sonraki çalışma günü için hatırlatmalar')}
            checked={openings} onChange={setOpenings} />
          {openings && <div className="form-grid">
            <Field label={t('Minimum opening (min)')}>
              <input type="number" min={1} max={1439} value={minimum} required onChange={event => setMinimum(event.target.value)} />
            </Field>
            <Field label={t('Number of reminders')}><select value={times.length} onChange={event => {
              const count = Number(event.target.value);
              setTimes(current => [...current, ...reminderTimeChoices.filter(time => !current.includes(time))].slice(0, count));
            }}>
              {reminderTimeChoices.map((time, index) => <option key={time} value={index + 1}>{index + 1}</option>)}
            </select></Field>
            {times.map((time, index) => <Field key={index} label={t('Reminder time {count}', { count: index + 1 })}>
              <input type="time" value={time} required onChange={event => setTimes(current => current.map((entry, position) =>
                index === position ? event.target.value : entry))} />
            </Field>)}
          </div>}
          <a className="more" href={path('/data/availability?from=notifications')}>
            {copy('Availability search settings', 'Müsaitlik arama ayarları')}<CaretRight aria-hidden />
          </a>
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        {saved && <p className="lab-status" role="status">{copy('Notification preferences saved.', 'Bildirim tercihleri kaydedildi.')}</p>}
      </RecordForm>
    </div>
  </>;
}

export function CalendarBuffer({ buffer }: { buffer: BufferSettings }) {
  const [draft, setDraft] = useState(buffer);
  const [saved, setSaved] = useState(false);
  return <>
    <PageHeader title={copy('Calendar event buffer', 'Takvim etkinliği tamponu')} back="/data" />
    <RecordForm submit={copy('Save buffer settings', 'Tampon ayarlarını kaydet')} onSave={async () => {
      update(current => ({ ...current, buffer: draft }));
      setSaved(true);
    }}>
      <Toggle title={copy('Enable calendar event buffer', 'Takvim etkinliği tamponunu etkinleştir')}
        summary={copy('Reserve time before calendar events in the Optimal Slot Picker.', 'En Uygun Saat Seçici’de takvim etkinliklerinden önce zaman ayır.')}
        checked={draft.enabled} onChange={enabled => { setDraft({ ...draft, enabled }); setSaved(false); }} />
      <Field label={copy('Pre-event buffer duration', 'Etkinlik öncesi tampon süresi')}>
        <select value={draft.minutes} disabled={!draft.enabled} onChange={event => { setDraft({ ...draft, minutes: Number(event.target.value) }); setSaved(false); }}>
          {durationChoices.map(minutes => <option key={minutes} value={minutes}>{durationLabel(minutes)}</option>)}
        </select>
      </Field>
      <p className="muted lab-setting-hint">{copy('You can ignore a buffer for a single appointment. The calendar event stays unavailable.',
        'Tamponu tek bir randevu için yok sayabilirsin. Etkinliğin kendi saatleri kapalı kalır.')}</p>
      {saved && <p className="lab-status" role="status">{copy('Calendar buffer settings saved.', 'Takvim tamponu ayarları kaydedildi.')}</p>}
    </RecordForm>
  </>;
}

export function AvailabilityOptions({ records, fromNotifications }: { records: Records; fromNotifications: boolean }) {
  const settings = availabilitySettingsFor(records);
  const [saved, setSaved] = useState(false);
  return <>
    <PageHeader title={t('Availability alerts')} back={fromNotifications ? notificationsRoute : '/data'} />
    <RecordForm onSave={async data => {
      update(current => ({ ...current, records: { ...current.records, availabilitySettings: {
        ...availabilitySettingsFor(current.records), workingDays: Number(value(data, 'workingDays')),
        calendarDays: Number(value(data, 'calendarDays')),
      } } }));
      setSaved(true);
    }}>
      <div className="form-grid" onChange={() => setSaved(false)}>
        <Field label={t('Working days to check')}><input type="number" name="workingDays" min={1} max={maxAlertDays} defaultValue={settings.workingDays} required /></Field>
        <Field label={t('Calendar day limit')}><input type="number" name="calendarDays" min={1} max={maxAlertDays} defaultValue={settings.calendarDays} required /></Field>
      </div>
      <p className="form-hint">{t('If there are no working days within the calendar limit, Today checks the next working day up to {count} calendar days away.',
        { count: availabilityFallbackDays })}</p>
      {!fromNotifications && <a className="more" href={path(notificationsRoute)}>{copy('Manage notifications', 'Bildirimleri yönet')}<CaretRight aria-hidden /></a>}
      {saved && <p className="lab-status" role="status">{t('Availability settings saved.')}</p>}
    </RecordForm>
  </>;
}
