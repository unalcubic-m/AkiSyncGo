import { CaretDown, CaretRight, Check, ClipboardText, Plus, X } from '@phosphor-icons/react';
import { useRef, useState } from 'react';
import { navigate } from '../../src/components/ui';
import { localDate, titleDate } from '../../src/domain/dates';
import { localTimestamp } from '../../src/domain/device-calendar';
import type { Appointment, RecordChange } from '../../src/domain/model';
import { saveVisitOutcome } from '../../src/domain/workflows';
import { errorMessage, getLocale, t } from '../../src/i18n';

type Visit = Extract<Appointment, { kind: 'Visit' }>;
type Sheet = 'other' | 'complete' | 'follow-up';

const otherOutcomes = ['No-show', 'Postponed', 'Cancelled'] as const;

export function CompactAppointmentOutcome({ visit, now, followUpLink, save }: {
  visit: Visit; now: Date; followUpLink: string; save: (change: RecordChange) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [sheet, setSheet] = useState<Sheet>('other');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(() => localTimestamp(visit.date, visit.start) <= now.getTime());
  const onAnotherDay = visit.date > localDate(now);
  const isTurkish = getLocale() === 'tr';

  async function record(status: Visit['status']) {
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      await save(records => saveVisitOutcome(records, visit, status));
      dialog.current?.close();
    } catch (failure) {
      setError(errorMessage(failure, 'Could not update the status.'));
    } finally {
      setSaving(false);
    }
  }

  function showSheet(next: Sheet) {
    setError('');
    setSheet(next);
    dialog.current?.showModal();
  }

  function complete(action: 'complete' | 'follow-up') {
    if (onAnotherDay) showSheet(action);
    else if (action === 'follow-up') navigate(followUpLink);
    else void record('Completed');
  }

  return <div className="visit-outcome">
    <details className="panel mock-compact-outcome" open={expanded}
      onToggle={event => setExpanded(event.currentTarget.open)}>
      <summary>
        <span className="compact-row-icon"><ClipboardText size={18} aria-hidden /></span>
        <strong>{t('Appointment outcome')}</strong>
        <CaretDown className="mock-compact-caret" size={16} aria-hidden />
      </summary>
      <div className="visit-outcome-actions">
        <button type="button" className="button" disabled={saving} aria-haspopup={onAnotherDay ? 'dialog' : undefined}
          onClick={() => complete('complete')}><Check aria-hidden />{t('Completed')}</button>
        <button type="button" className="button secondary" disabled={saving} aria-haspopup={onAnotherDay ? 'dialog' : undefined}
          onClick={() => complete('follow-up')}><Plus aria-hidden />{t('Complete and add follow-up')}</button>
        <button type="button" className="text-button" disabled={saving} aria-haspopup="dialog"
          onClick={() => showSheet('other')}>{t('Other outcomes')}<CaretRight aria-hidden /></button>
        {error && !dialog.current?.open && <p className="form-error" role="alert">{error}</p>}
      </div>
    </details>
    <dialog ref={dialog} className="booking-sheet visit-outcome-sheet" aria-labelledby="mock-compact-sheet-title"
      onCancel={event => { if (saving) event.preventDefault(); }} onClose={() => setError('')}>
      <header className="booking-sheet-header">
        <h2 id="mock-compact-sheet-title">{sheet === 'other' ? t('Other outcomes')
          : isTurkish ? 'Randevu bugün mü yapıldı?' : 'Did the visit take place today?'}</h2>
        <button type="button" aria-label={t('Close')} disabled={saving} onClick={() => dialog.current?.close()}><X aria-hidden /></button>
      </header>
      <div className="booking-sheet-content visit-outcome-options">
        {sheet === 'other' ? otherOutcomes.map(status => <button key={status} type="button" className="button secondary"
          disabled={saving} onClick={() => void record(status)}>{t(status)}</button>) : <>
          <p>{isTurkish ? 'Planlanan randevu' : 'Scheduled appointment'} · {titleDate(visit.date)} · {visit.start}–{visit.end}</p>
          <button type="button" className="button" disabled={saving} onClick={() => {
            if (sheet === 'follow-up') navigate(followUpLink);
            else void record('Completed');
          }}>{isTurkish ? 'Evet, bugün yapıldı' : 'Yes, it took place today'}</button>
          <button type="button" className="button secondary" disabled={saving}
            onClick={() => dialog.current?.close()}>{t('Cancel')}</button>
        </>}
        {error && dialog.current?.open && <p className="form-error" role="alert">{error}</p>}
      </div>
    </dialog>
  </div>;
}
