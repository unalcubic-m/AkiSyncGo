import { CaretDown, CaretRight, Check, ClipboardText, Plus, X } from '@phosphor-icons/react';
import { useRef, useState } from 'react';
import { navigate, path } from '../components/ui';
import { localDate, titleDate } from '../domain/dates';
import { localTimestamp } from '../domain/device-calendar';
import { visitStatuses, type Appointment, type RecordChange } from '../domain/model';
import { saveVisitOutcome } from '../domain/workflows';
import { errorMessage, t } from '../i18n';

type Visit = Extract<Appointment, { kind: 'Visit' }>;
type OutcomeSheet = 'status' | 'complete' | 'follow-up';
const otherOutcomes = ['No-show', 'Postponed', 'Cancelled'] as const;

export function AppointmentOutcome({ visit, now, followUpLink, save }: {
  visit: Visit; now: Date; followUpLink: string; save: (change: RecordChange) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; inSheet: boolean }>();
  const [notice, setNotice] = useState('');
  const [sheet, setSheet] = useState<OutcomeSheet>('status');
  const [expanded, setExpanded] = useState(() => localTimestamp(visit.date, visit.start) <= now.getTime());
  const scheduled = visit.status === 'Scheduled';
  const onAnotherDay = visit.date > localDate(now);
  const options = scheduled ? otherOutcomes : visitStatuses;

  async function record(status: Visit['status'], inSheet = false) {
    if (saving) return;
    setSaving(true);
    setFeedback(undefined);
    setNotice('');
    try {
      await save(records => saveVisitOutcome(records, visit, status));
      if (inSheet) dialog.current?.close();
      setNotice(t('Status updated.'));
    } catch (failure) {
      setFeedback({ text: errorMessage(failure, 'Could not update the status.'), inSheet });
    } finally {
      setSaving(false);
    }
  }

  function showSheet(next: OutcomeSheet) {
    setFeedback(undefined);
    setSheet(next);
    dialog.current?.showModal();
  }

  function complete(action: 'complete' | 'follow-up') {
    if (onAnotherDay) showSheet(action);
    else if (action === 'follow-up') navigate(followUpLink);
    else void record('Completed');
  }

  const statusTitle = t(scheduled ? 'Other outcomes' : 'Change status');
  const statusButton = <button type="button" className={scheduled ? 'text-button' : 'button secondary'}
    aria-haspopup="dialog" disabled={saving} onClick={() => showSheet('status')}>{statusTitle}<CaretRight aria-hidden /></button>;

  return <div className="visit-outcome">
    {scheduled ? <details className="panel visit-outcome-panel" open={expanded}
      onToggle={event => setExpanded(event.currentTarget.open)}>
      <summary>
        <span className="compact-row-icon"><ClipboardText size={18} aria-hidden /></span>
        <strong>{t('Appointment outcome')}</strong>
        <CaretDown className="visit-outcome-caret" size={16} aria-hidden />
      </summary>
      <div className="visit-outcome-actions">
        <button type="button" className="button" disabled={saving} aria-haspopup={onAnotherDay ? 'dialog' : undefined}
          onClick={() => complete('complete')}>
          <Check aria-hidden />{t('Completed')}
        </button>
        {onAnotherDay ? <button type="button" className="button secondary" disabled={saving} aria-haspopup="dialog"
          onClick={() => complete('follow-up')}><Plus aria-hidden />{t('Complete and add follow-up')}</button>
          : <a className="button secondary" href={path(followUpLink)} aria-disabled={saving || undefined} onClick={event => {
            if (saving) event.preventDefault();
          }}><Plus aria-hidden />{t('Complete and add follow-up')}</a>}
        {statusButton}
      </div>
    </details> : statusButton}
    {feedback && !feedback.inSheet && <p className="form-error" role="alert">{feedback.text}</p>}
    <span className="visually-hidden" role="status">{notice}</span>
    <dialog ref={dialog} className="booking-sheet visit-outcome-sheet" aria-labelledby="visit-outcome-sheet-heading"
      onCancel={event => { if (saving) event.preventDefault(); }}
      onClose={() => setFeedback(current => current?.inSheet ? undefined : current)}>
      <header className="booking-sheet-header">
        <h2 id="visit-outcome-sheet-heading">{sheet === 'status' ? statusTitle : t('Did the visit take place today?')}</h2>
        <button type="button" aria-label={t('Close')} disabled={saving} onClick={() => dialog.current?.close()}>
          <X aria-hidden />
        </button>
      </header>
      <div className="booking-sheet-content visit-outcome-options">
        {sheet === 'status' ? options.map(status => <button key={status} type="button" className="button secondary"
          disabled={saving || visit.status === status} onClick={() => void record(status, true)}>
          {t(status)}{visit.status === status && <Check aria-hidden />}
        </button>) : <>
          <p>{t('Scheduled appointment')} · {titleDate(visit.date)} · {visit.start}–{visit.end}</p>
          <button type="button" className="button" disabled={saving} onClick={() => {
            if (sheet === 'follow-up') navigate(followUpLink);
            else void record('Completed', true);
          }}>{t('Yes, it took place today')}</button>
          <button type="button" className="button secondary" disabled={saving}
            onClick={() => dialog.current?.close()}>{t('Cancel')}</button>
        </>}
        {feedback?.inSheet && <p className="form-error" role="alert">{feedback.text}</p>}
      </div>
    </dialog>
  </div>;
}
