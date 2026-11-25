import { CalendarPlus, CaretDown, Phone, WarningCircle } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { newId, path, Pill } from '../components/ui';
import { bookingCallbacksDue, requestBookingCallback, type BookingCallback } from '../domain/booking-callbacks';
import { appointmentsWithBookingHolds } from '../domain/lab-returns';
import type { Patient, RecordChange, Records } from '../domain/model';
import { errorMessage, t } from '../i18n';
import { copyPatientPhone } from '../platform/clipboard';
import './today-follow-up.css';

type Save = (change: RecordChange) => Promise<void>;

export function AppointmentsToReview({ records, today }: { records: Records; today: string }) {
  const visits = appointmentsWithBookingHolds(records, today);
  if (!visits.length) return null;

  return <details className="panel today-follow-up-card appointment-review" aria-labelledby="appointments-to-review" open>
    <summary className="today-follow-up-heading">
      <span className="today-follow-up-icon"><WarningCircle size={21} aria-hidden /></span>
      <strong id="appointments-to-review">{t('Appointments to review')}</strong>
      <Pill tone="amber">{visits.length}</Pill>
      <CaretDown className="opening-caret" size={16} aria-hidden />
    </summary>
    <ul className="compact-list">
      {visits.map(({ visit, patient, holds }) => <li className="today-follow-up-row" key={visit.id}>
        <div className="today-follow-up-copy">
          <strong>{patient.name}</strong>
          <small>{t(visit.date === today ? 'Today' : 'Tomorrow')} · {visit.start}–{visit.end}</small>
          <small>{holds.map(hold => hold.title).join(' · ')}</small>
        </div>
        <a className="planning-book-action" href={path(`/appointments/${visit.id}?from=today&booking-warning=1`)}>{t('Open appointment')}</a>
      </li>)}
    </ul>
  </details>;
}

function CallbackRow({ callback }: { callback: BookingCallback }) {
  const { patient, returns } = callback;
  const [copyFeedback, setCopyFeedback] = useState('');
  useEffect(() => {
    if (!copyFeedback) return;
    const timer = window.setTimeout(() => setCopyFeedback(''), 2500);
    return () => window.clearTimeout(timer);
  }, [copyFeedback]);

  async function copyNumber() {
    setCopyFeedback('');
    try {
      await copyPatientPhone(patient.phone);
      setCopyFeedback(t('Phone number copied.'));
    } catch {
      setCopyFeedback(t('Could not copy'));
    }
  }

  return <li className="today-follow-up-row" key={patient.id}>
    <div className="today-follow-up-copy">
      <a href={path('/patients/' + patient.id)}><strong>{patient.name}</strong></a>
      <small>{returns.length ? `${t('Lab work returned')} · ${returns.map(job => job.title).join(' · ')}` : t('Appointment callback')}</small>
      {!patient.phone && <small>{t('No phone number recorded.')}</small>}
      <small role="status" className={copyFeedback ? undefined : 'visually-hidden'}>{copyFeedback}</small>
    </div>
    <div className="today-callback-actions">
      <button type="button" className="planning-book-action" disabled={!patient.phone} title={t('Copy phone number')}
        onClick={() => void copyNumber()}><Phone size={16} aria-hidden />{t('Call')}</button>
      <a className="planning-book-action" href={path(`/appointments/new?from=today&patient=${patient.id}`)}>
        <CalendarPlus size={17} aria-hidden />{t('Schedule visit')}</a>
    </div>
  </li>;
}

export function PatientsToCall({ records, today, now }: { records: Records; today: string; now: Date }) {
  const callbacks = bookingCallbacksDue(records, today, now);
  if (!callbacks.length) return null;

  return <details className="panel today-follow-up-card" aria-labelledby="patients-to-call" open>
    <summary className="today-follow-up-heading">
      <span className="today-follow-up-icon"><Phone size={20} aria-hidden /></span>
      <strong id="patients-to-call">{t('Patients to call')}</strong>
      <Pill tone="blue">{callbacks.length}</Pill>
      <CaretDown className="opening-caret" size={16} aria-hidden />
    </summary>
    <ul className="compact-list">
      {callbacks.map(callback => <CallbackRow key={callback.patient.id} callback={callback} />)}
    </ul>
  </details>;
}

export function RequestBookingCallback({ records, patient, today, save }: { records: Records; patient: Patient; today: string; save: Save }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  if (patient.status !== 'Active' || records.appointments.some(visit => visit.patientId === patient.id
    && visit.status === 'Scheduled' && visit.date >= today)) return null;

  const requested = records.tasks.some(task => task.patientId === patient.id && task.bookingCallback && !task.completedOn);
  async function request() {
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      await save(current => requestBookingCallback(current, patient.id, newId(), t('Appointment callback')));
    } catch (problem) {
      setError(errorMessage(problem, 'Could not save. Try again.'));
    } finally {
      setSaving(false);
    }
  }

  return <div>
    <button type="button" className="button secondary" disabled={requested || saving} onClick={() => void request()}>
      <Phone size={17} aria-hidden />{t(requested ? 'Callback reminder added' : 'Add a booking callback reminder')}
    </button>
    {error && <p role="alert" className="form-error">{error}</p>}
  </div>;
}
