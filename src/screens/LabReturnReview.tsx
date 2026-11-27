import { CalendarBlank, Flask, WarningCircle } from '@phosphor-icons/react';
import { useRef, useState, type Ref } from 'react';
import { ButtonLink, Field } from '../components/ui';
import { addDays, formatDate, titleDate } from '../domain/dates';
import type { LabReturnReview as Review } from '../domain/lab-returns';
import type { Patient, Wait } from '../domain/model';
import { t } from '../i18n';

export function LabReturnReview({ review, patient, today, card, busy, onCancel, onAdd, onConfirmPending }: {
  review: Review; patient: Patient; today: string; card: Ref<HTMLElement>; busy: boolean;
  onCancel: () => void; onAdd: (title?: string) => void; onConfirmPending: (job: Wait) => void;
}) {
  const { appointment, jobs, pending, recordedToday, readyToBook } = review;
  const [newTitle, setNewTitle] = useState<string>();
  const titleInput = useRef<HTMLInputElement>(null);
  const yesterday = addDays(today, -1);
  const booking = appointment ? { to: `/appointments/${appointment.id}?from=daily-lab`, label: t('Open appointment') }
    : readyToBook ? { to: `/appointments/new?from=daily-lab&patient=${patient.id}`, label: t('Schedule appointment') }
      : undefined;

  function addAnother() {
    if (!recordedToday && !pending.length) {
      onAdd();
      return;
    }
    setNewTitle('');
    requestAnimationFrame(() => titleInput.current?.focus());
  }

  return <section className="lab-return-review" aria-labelledby="lab-return-review-title" tabIndex={-1} ref={card}>
    <h3 id="lab-return-review-title">
      <WarningCircle size={19} weight="fill" aria-hidden />{t(recordedToday ? 'Already recorded today' : 'Lab return already recorded')}
    </h3>
    <dl>
      <div>
        <dt><Flask size={17} aria-hidden />{t('Recorded return')}</dt>
        {jobs.map(job => <dd key={job.id}><strong>{job.title}</strong>
          {job.endedOn && <small>{job.endedOn === today && <>{t('Today')} · </>}
            {job.endedOn === yesterday && <>{t('Yesterday')} · </>}
            <time dateTime={job.endedOn}>{formatDate(job.endedOn, { day: 'numeric', month: 'long' })}</time>
          </small>}</dd>)}
      </div>
      {(appointment || readyToBook) && <div>
        <dt><CalendarBlank size={17} aria-hidden />{t(appointment ? 'Booked appointment' : 'Ready to book')}</dt>
        {appointment ? <dd><strong>{titleDate(appointment.date)} · {appointment.start}</strong><small>{appointment.title}</small></dd>
          : <dd><strong>{t('No appointment booked')}</strong></dd>}
      </div>}
    </dl>
    {pending.length > 0 && <div className="lab-return-review-pending">
      <h4>{t('Pending LabCheck tasks')}</h4>
      <ul>{pending.map(job => <li key={job.id}><strong>{job.title}</strong>
        <button className="button secondary" type="button" disabled={busy}
          aria-label={t('Mark {patient}, {case} done', { patient: patient.name, case: job.title })}
          onClick={() => onConfirmPending(job)}>{t('Mark done')}</button></li>)}</ul>
    </div>}
    {newTitle !== undefined && <form className="lab-return-review-form" onSubmit={event => {
      event.preventDefault();
      const title = newTitle.trim();
      if (title && !busy) onAdd(title);
    }}>
      <Field label={t('What arrived?')}><input ref={titleInput} required maxLength={255} disabled={busy}
        value={newTitle} onChange={event => setNewTitle(event.target.value)} /></Field>
      <button className="button" type="submit" disabled={busy || !newTitle.trim()}>{t('Save lab return')}</button>
    </form>}
    <div className="lab-return-review-actions">
      {booking && <ButtonLink to={booking.to} secondary={newTitle !== undefined}>{booking.label}</ButtonLink>}
      <div className="lab-return-review-secondary">
        <button className="text-button" type="button" onClick={onCancel} disabled={busy}>{t('Cancel')}</button>
        {newTitle === undefined && <button className={`button${booking ? ' secondary' : ''}`} type="button" disabled={busy} onClick={addAnother}>
          {t('Add another return')}
        </button>}
      </div>
    </div>
  </section>;
}
