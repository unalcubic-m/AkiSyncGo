import { ArrowLeft, ArrowUUpLeft, CalendarBlank, CaretDown, CaretRight, Check, Clock, WarningCircle } from '@phosphor-icons/react';
import { useState } from 'react';
import { Field, newId, path, Pill, RecordForm, value } from '../../src/components/ui';
import { formatDuration, slotForDuration } from '../../src/domain/availability';
import { findBookingOptions } from '../../src/domain/booking-optimum';
import { formatDate } from '../../src/domain/dates';
import { calendarConflicts, calendarEventLabel, localTimestamp, type DeviceCalendarEvent } from '../../src/domain/device-calendar';
import type { Records, Slot } from '../../src/domain/model';
import { isSlotAvailable, saveAppointment } from '../../src/domain/workflows';
import { LocalizedError, t } from '../../src/i18n';
import { AppointmentPatientPicker } from '../../src/screens/AppointmentBooking';
import { bookingDate, bufferRoute, copy, saveRecords, type BufferSettings } from './state';

const sameSlot = (a: Slot | undefined, b: Slot | undefined) => !!a && !!b && a.date === b.date && a.start === b.start && a.end === b.end;
const slotTime = (slot: Slot) => `${slot.start}–${slot.end}`;
const eventTime = (timestamp: number) => new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(timestamp);
const eventTitle = () => copy('Clinic team meeting', 'Klinik ekip toplantısı');
const bufferIgnored = () => copy('Buffer ignored for this appointment', 'Tampon bu randevu için yok sayıldı');

export function SlotPicker({ records, today, buffer, selectedPatient, back, onSave }: {
  records: Records; today: string; buffer: BufferSettings; selectedPatient?: string; back: string; onSave: () => void;
}) {
  const date = bookingDate(today);
  const [patient, setPatient] = useState(selectedPatient ?? '');
  const [duration, setDuration] = useState(45);
  const [selected, setSelected] = useState<Slot>();
  const [ignored, setIgnored] = useState<Slot>();
  const [manualStart, setManualStart] = useState('');
  const [editingTime, setEditingTime] = useState(false);
  const working = { date, windows: [{ start: '14:30', end: '17:30' }] };
  const demoRecords = { ...records, hoursOverrides: [...records.hoursOverrides.filter(item => item.date !== date), working] };
  const now = new Date(localTimestamp(date, '09:00'));
  const event: DeviceCalendarEvent = { id: 'lab-meeting', eventId: 'lab-meeting', ignored: false, allDay: false,
    title: eventTitle(), calendar: copy('Clinic calendar', 'Klinik takvimi'), begin: localTimestamp(date, '15:30'), end: localTimestamp(date, '16:15') };
  const reservation = { ...event, begin: event.begin - buffer.minutes * 60_000, end: event.begin };
  const actual = { now, events: [event] };
  const reserved = { now, events: buffer.enabled ? [event, reservation] : [event] };
  const base = findBookingOptions(demoRecords, duration, { from: date, through: date, ...actual });
  const preferred = buffer.enabled ? findBookingOptions(demoRecords, duration, { from: date, through: date, ...reserved }) : base;
  const recommended = preferred.optimum ?? preferred.first;
  const active = selected ?? recommended;
  const hitsEvent = (slot: Slot) => calendarConflicts(slot, actual.events).length > 0;
  const hitsBuffer = (slot: Slot) => buffer.enabled && calendarConflicts(slot, [reservation]).length > 0;
  const fits = (slot: Slot) => isSlotAvailable(demoRecords, slot, actual);
  const activeOverlap = active && hitsEvent(active);
  const activeBuffered = active && hitsBuffer(active) && !sameSlot(active, ignored);
  const canSave = !!active && fits(active) && !activeBuffered;
  const activeIgnored = !!active && hitsBuffer(active) && sameSlot(active, ignored);
  const rawAffected = [base.optimum, base.first].find(candidate => candidate && hitsBuffer(candidate));
  const affected = activeOverlap ? undefined : activeBuffered && active && fits(active) ? active : rawAffected;

  function select(slot: Slot | undefined) {
    setSelected(slot);
    if (!sameSlot(slot, ignored)) setIgnored(undefined);
  }

  function findTime() {
    if (!manualStart) return;
    select(slotForDuration(date, manualStart, duration));
  }

  return <div className="booking-page lab-booking">
    <header className="booking-header">
      <a className="back" href={path(back)} aria-label={t('Back')}><ArrowLeft size={22} aria-hidden /></a>
      <h1>{t('New appointment')}</h1>
    </header>
    <RecordForm screen disabled={!patient || !canSave} submit={copy('Save appointment', 'Randevuyu kaydet')}
      onSave={async form => {
        if (!active || !canSave || !patient) return;
        const title = value(form, 'title') || copy('Consultation', 'Muayene');
        saveRecords(current => {
          const currentWithHours = { ...current, hoursOverrides: [...current.hoursOverrides.filter(item => item.date !== date), working] };
          if (!isSlotAvailable(currentWithHours, active, actual) || (hitsBuffer(active) && !activeIgnored)) {
            throw new LocalizedError('This time is no longer available.', () => copy('This time is no longer available.', 'Bu saat artık uygun değil.'));
          }
          const saved = saveAppointment(currentWithHours, { ...active, id: newId(), patientId: patient, kind: 'Visit', title,
            notes: '', procedure: '', status: 'Scheduled', exceptions: [] }, {}, now);
          return { ...saved, hoursOverrides: current.hoursOverrides };
        });
        onSave();
      }}>
      <AppointmentPatientPicker records={records} patientId={patient} onSelect={setPatient} />
      <section className="lab-picker" aria-labelledby="lab-picker-heading">
        <div className="lab-picker-heading">
          <h2 id="lab-picker-heading">{copy('Optimal Slot Picker', 'En Uygun Saat Seçici')}</h2>
          <span><CalendarBlank size={15} aria-hidden /><time dateTime={date}>{formatDate(date, { weekday: 'short', day: 'numeric', month: 'short' })}</time></span>
        </div>
        <fieldset className="booking-presets lab-duration-choices">
          <legend>{copy('Duration', 'Süre')}</legend>
          <div>{[30, 45, 60].map(minutes => <button key={minutes} type="button" className="button secondary"
            aria-pressed={minutes === duration} onClick={() => {
              if (minutes === duration) return;
              setDuration(minutes); setSelected(undefined); setIgnored(undefined); setManualStart('');
            }}>{formatDuration(minutes)}</button>)}</div>
        </fieldset>
        {active ? <div className={`panel lab-slot${activeOverlap || activeBuffered || !fits(active) ? ' lab-slot-conflict' : ''}`}>
          <span className="lab-icon lab-icon-blue"><Clock size={22} aria-hidden /></span>
          <div className="lab-slot-time" aria-live="polite"><small>{activeIgnored ? copy('Selected time', 'Seçilen saat') : sameSlot(active, recommended)
            ? copy('Recommended time', 'Önerilen saat') : copy('Selected time', 'Seçilen saat')}</small>
            <strong>{slotTime(active)}</strong>
            {activeIgnored && <Pill tone="amber">{copy('Buffer ignored', 'Tampon yok sayıldı')}</Pill>}
            {activeOverlap && <small>{copy('Overlaps the calendar event.', 'Takvim etkinliğiyle çakışıyor.')}</small>}
          </div>
          {canSave && <Check size={20} weight="bold" aria-hidden />}
        </div> : <p className="panel empty">{t('No available times found.')}</p>}
        {activeOverlap && <p className="form-error" role="alert">{copy(`${event.title} occupies ${calendarEventLabel(event)}. Choose a time outside the event.`,
          `${event.title} ${calendarEventLabel(event)} aralığını kullanıyor. Etkinlik dışında bir saat seç.`)}</p>}
        {active && !fits(active) && !activeOverlap && <p className="form-error" role="alert">{copy('That time is outside the available appointment windows.', 'Bu saat uygun randevu aralıklarının dışında.')}</p>}
        {activeIgnored && <div className="lab-buffer-note lab-buffer-applied" role="status">
          <Check size={20} aria-hidden /><div><strong>{bufferIgnored()}</strong>
            <small>{event.title} · {calendarEventLabel(event)}</small>
            <button type="button" className="text-button" onClick={() => { setIgnored(undefined); setSelected(undefined); }}>
              <ArrowUUpLeft size={15} aria-hidden />{copy('Restore buffer', 'Tamponu geri getir')}</button></div>
        </div>}
        {!activeIgnored && affected && <div className="lab-buffer-note">
          <WarningCircle size={21} aria-hidden /><div>
            <strong>{copy(`${slotTime(affected)} overlaps the event buffer`, `${slotTime(affected)} etkinlik tamponuna denk geliyor`)}</strong>
            <dl>
              <div><dt>{event.title}</dt><dd>{calendarEventLabel(event)}</dd></div>
              <div><dt>{copy(`${buffer.minutes}-minute buffer`, `${buffer.minutes} dakikalık tampon`)}</dt>
                <dd>{eventTime(reservation.begin)}–{eventTime(reservation.end)}</dd></div>
            </dl>
            <button type="button" className="button secondary" onClick={() => { setSelected(affected); setIgnored(affected); }}>
              {copy('Ignore buffer for this appointment', 'Bu randevu için tamponu yok say')}</button>
          </div>
        </div>}
        {!affected && !activeIgnored && !activeOverlap && <div className="panel lab-event-summary"><CalendarBlank size={20} aria-hidden />
          <span><strong>{event.title}</strong><small>{event.calendar} · {calendarEventLabel(event)}</small></span>
          {buffer.enabled && <Pill tone="amber">{copy(`${buffer.minutes} min before`, `${buffer.minutes} dk önce`)}</Pill>}
        </div>}
        <details className="panel lab-manual" open={editingTime} onToggle={event => setEditingTime(event.currentTarget.open)}>
          <summary><strong>{copy('Choose a different time', 'Başka bir saat seç')}</strong><CaretDown size={17} aria-hidden /></summary>
          <div className="lab-manual-fields">
            <Field label={t('Start time')}><input type="time" value={manualStart} onChange={event => setManualStart(event.target.value)} /></Field>
            <button type="button" className="button secondary" disabled={!manualStart} onClick={findTime}>{copy('Check time', 'Saati kontrol et')}</button>
            {selected && recommended && !sameSlot(selected, recommended) && <button type="button" className="text-button" onClick={() => select(undefined)}>
              {copy('Use recommended time', 'Önerilen saati kullan')}</button>}
          </div>
        </details>
        <a className="more lab-buffer-link" href={path(bufferRoute)}>{copy('Calendar buffer settings', 'Takvim tamponu ayarları')}<CaretRight size={15} aria-hidden /></a>
      </section>
      <Field label={t('Title (optional)')}><input maxLength={255} name="title" /></Field>
    </RecordForm>
  </div>;
}
