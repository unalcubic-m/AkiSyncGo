import { CaretRight, Notebook, PencilSimple, Trash, X } from '@phosphor-icons/react';
import { useRef, useState, type FormEvent } from 'react';
import { AlertBadge, ButtonLink, PageHeader, path, Pill, Section } from '../../src/components/ui';
import { formatDate, localDate, titleDate } from '../../src/domain/dates';
import type { Appointment, RecordChange, Records } from '../../src/domain/model';
import { conflictAppointmentIds, pruneScheduleOverlapIgnores, scheduleConflicts } from '../../src/domain/schedule-conflicts';
import { activeAlerts, upcomingVisits } from '../../src/domain/workflows';
import { getLocale, t } from '../../src/i18n';
import { AppointmentOutcome } from '../../src/screens/AppointmentOutcome';
import { ScheduleConflictList } from '../../src/screens/CalendarConflicts';
import { CompactAppointmentOutcome } from './CompactAppointmentOutcome';

type Visit = Extract<Appointment, { kind: 'Visit' }>;
const copy = (tr: string, en: string) => getLocale() === 'tr' ? tr : en;
const deleteLabel = () => copy('Randevuyu sil', 'Delete appointment');

function DeleteAppointment({ item, patientName, hasNotes, save, onDeleted }: {
  item: Visit; patientName?: string; hasNotes: boolean;
  save: (change: RecordChange) => Promise<void>; onDeleted: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  async function remove(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(false);
    try {
      await save(records => pruneScheduleOverlapIgnores({
        ...records,
        appointments: records.appointments.filter(appointment => appointment.id !== item.id),
        notes: records.notes.map(note => note.appointmentId === item.id ? { ...note, appointmentId: null } : note),
      }));
      dialog.current?.close();
      onDeleted();
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  }

  return <>
    <button type="button" className="button secondary danger mock-delete-trigger" aria-label={deleteLabel()}
      aria-haspopup="dialog" onClick={() => dialog.current?.showModal()}>
      <Trash size={17} aria-hidden />{copy('Sil', 'Delete')}
    </button>
    <dialog ref={dialog} className="booking-sheet mock-outcome-sheet" aria-labelledby="mock-delete-heading"
      aria-describedby="mock-delete-description" onClose={() => setError(false)}
      onCancel={event => { if (saving) event.preventDefault(); }}>
      <form onSubmit={event => void remove(event)}>
        <header className="booking-sheet-header">
          <h2 id="mock-delete-heading">{copy('Randevu silinsin mi?', 'Delete this appointment?')}</h2>
          <button type="button" aria-label={t('Close')} disabled={saving} onClick={() => dialog.current?.close()}><X size={20} aria-hidden /></button>
        </header>
        <div className="booking-sheet-content mock-sheet-content">
          <div className="mock-sheet-appointment">
            <div><strong>{patientName ?? item.title}</strong>{patientName && <p>{item.title}</p>}</div>
            <small>{formatDate(item.date)} · {item.start}–{item.end}</small>
          </div>
          <p id="mock-delete-description">
            {copy('Randevu takvimden kalıcı olarak silinecek.', 'This appointment will be permanently removed from the schedule.')}
            {hasNotes && <> {copy('Bağlı görüşme notları hasta kaydında kalacak.', 'Linked encounter notes will stay in the patient record.')}</>}
          </p>
          {error && <p className="form-error" role="alert">{copy('Randevu silinemedi. Tekrar deneyin.', 'Could not delete the appointment. Try again.')}</p>}
        </div>
        <div className="booking-sheet-footer mock-delete-footer">
          <button type="button" className="button secondary" autoFocus disabled={saving} onClick={() => dialog.current?.close()}>{t('Cancel')}</button>
          <button type="submit" className="button danger" disabled={saving}><Trash size={17} aria-hidden />{deleteLabel()}</button>
        </div>
      </form>
    </dialog>
  </>;
}

export default function AppointmentDetailsMock({ item, records, now, back, query, pending, compactOutcome, save, onDeleted }: {
  item: Appointment; records: Records; now: Date; back: string; query: string; pending: boolean; compactOutcome: boolean;
  save: (change: RecordChange) => Promise<void>; onDeleted: () => void;
}) {
  const patient = records.patients.find(entry => entry.id === item.patientId);
  const linkedNotes = records.notes.filter(note => note.appointmentId === item.id);
  const conflicts = scheduleConflicts(records, upcomingVisits(records, localDate(now), now))
    .filter(conflict => conflictAppointmentIds(conflict).includes(item.id));
  const suffix = query ? '?' + query : '';
  const edit = '/appointments/' + item.id + '/edit' + suffix;
  const complete = '/appointments/' + item.id + '/complete' + suffix;
  return <>
    <PageHeader title={item.title} subtitle={titleDate(item.date)} back={back}
      action={<div className="mock-detail-actions">
        <ButtonLink secondary to={edit} icon={PencilSimple}>{t(item.kind === 'Block' ? 'Edit closure' : 'Edit appointment')}</ButtonLink>
        {item.kind === 'Visit' && <DeleteAppointment item={item} patientName={patient?.name}
          hasNotes={linkedNotes.length > 0} save={save} onDeleted={onDeleted} />}
      </div>} />
    <div className="panel padded">
      <div className="row-heading">
        <strong>{item.start}–{item.end}</strong>
        <Pill tone={pending ? 'amber' : item.status === 'Scheduled' ? 'blue' : item.status === 'Completed' ? 'green' : 'neutral'}>
          {pending ? copy('Sonuç bekliyor', 'Outcome pending') : t(item.status)}
        </Pill>
      </div>
      {patient && <a className="profile-link" href={path('/patients/' + patient.id)}>{patient.name}<CaretRight aria-hidden /></a>}
      {patient && <div className="mock-detail-alerts">
        {activeAlerts(records, patient.id).map(alert => <AlertBadge key={alert.id} alert={alert} />)}
      </div>}
      {item.procedure && <p><strong>{t('Procedure')}</strong> {item.procedure}</p>}
      {item.notes && <p className="preserve"><strong>{t(item.kind === 'Block' ? 'Notes' : 'Preparation notes')}</strong> {item.notes}</p>}
    </div>
    {item.kind === 'Visit' && (compactOutcome && item.status === 'Scheduled'
      ? <CompactAppointmentOutcome visit={item} now={now} followUpLink={complete} save={save} />
      : <AppointmentOutcome visit={item} now={now} followUpLink={complete} save={save} />)}
    {conflicts.length > 0 && <Section title={t('Scheduling conflicts')}>
      <ScheduleConflictList records={records} conflicts={conflicts} save={save} />
    </Section>}
    {patient && <Section title={t('Encounter notes')} action={<ButtonLink to={`/patients/${patient.id}/notes/new?appointment=${item.id}`} icon={Notebook} secondary>{t('Add note')}</ButtonLink>}>
      <div className="panel padded">
        {linkedNotes.length ? linkedNotes.map(note => <p key={note.id}><a href={path(`/patients/${patient.id}/notes/${note.id}`)}>{formatDate(note.date)} · {note.title || t('Encounter note')}</a></p>)
          : <p className="muted">{t('No notes linked to this visit.')}</p>}
      </div>
    </Section>}
    {item.exceptions.length > 0 && <Section title={t('Scheduling exceptions')}>
      <div className="panel">{item.exceptions.map((exception, index) => <article className="record-row" key={index}>
        <strong>{t(exception.kind)}</strong>
        <p>{exception.reason === 'Confirmed before saving.' ? t('Confirmed before saving.') : exception.reason}</p>
        <small className="muted">{new Date(exception.recordedAt).toLocaleString(getLocale())}</small>
      </article>)}</div>
    </Section>}
  </>;
}
