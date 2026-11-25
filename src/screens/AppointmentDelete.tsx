import { Trash, X } from '@phosphor-icons/react';
import { useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { formatDate } from '../domain/dates';
import type { Appointment } from '../domain/model';
import { errorMessage, t } from '../i18n';

export default function AppointmentDelete({ item, patientName, hasNotes, remove, onDeleted }: {
  item: Appointment; patientName?: string; hasNotes: boolean;
  remove: () => Promise<void>; onDeleted: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState('');
  const isBlock = item.kind === 'Block';
  const deleteLabel = t(isBlock ? 'Delete blocked time' : 'Delete appointment');

  useLayoutEffect(() => {
    if (open) {
      dialog.current?.showModal();
      cancel.current?.focus();
    }
  }, [open]);

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setFeedback('');
    try {
      await remove();
      dialog.current?.close();
      onDeleted();
    } catch (failure) {
      setFeedback(errorMessage(failure, isBlock ? 'Could not delete the blocked time.' : 'Could not delete the appointment.'));
      setSaving(false);
    }
  }

  return <>
    <button type="button" className="button secondary danger appointment-delete" aria-label={deleteLabel}
      aria-haspopup="dialog" onClick={() => {
        setFeedback('');
        setOpen(true);
      }}>
      <Trash size={17} aria-hidden />{isBlock ? deleteLabel : t('Delete')}
    </button>
    {open && <dialog ref={dialog} className="booking-sheet appointment-action-sheet" aria-labelledby="appointment-delete-heading"
      aria-describedby="appointment-delete-description" onClose={() => setOpen(false)}
      onCancel={event => { if (saving) event.preventDefault(); }}>
      <form onSubmit={event => void confirm(event)}>
        <header className="booking-sheet-header">
          <h2 id="appointment-delete-heading">{t(isBlock ? 'Delete this blocked time?' : 'Delete this appointment?')}</h2>
          <button type="button" aria-label={t('Close')} disabled={saving} onClick={() => dialog.current?.close()}><X size={20} aria-hidden /></button>
        </header>
        <div className="booking-sheet-content appointment-action-content">
          <div className="appointment-action-summary">
            <div><strong>{patientName ?? item.title}</strong>{patientName && <p>{item.title}</p>}</div>
            <small>{formatDate(item.date, { day: 'numeric', month: 'short' })} · {item.start}–{item.end}</small>
          </div>
          <p id="appointment-delete-description">
            {t(isBlock ? 'This will remove the block from the calendar.' : 'This appointment will be permanently removed from the schedule.')}
            {hasNotes && <> {t('Linked encounter notes will stay in the patient record.')}</>}
          </p>
          {feedback && <p className="form-error" role="alert">{feedback}</p>}
        </div>
        <div className="booking-sheet-footer appointment-delete-footer">
          <button type="button" className="button secondary" ref={cancel} disabled={saving} onClick={() => dialog.current?.close()}>{t('Cancel')}</button>
          <button type="submit" className="button danger" disabled={saving}><Trash size={17} aria-hidden />{saving ? t('Saving…') : deleteLabel}</button>
        </div>
      </form>
    </dialog>}
  </>;
}
