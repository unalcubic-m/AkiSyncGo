import { CaretRight, CheckCircle, ClipboardText, Clock, LockSimple, PencilSimple, UserCircle, XCircle, type Icon } from '@phosphor-icons/react';
import { useState, type ReactNode } from 'react';
import { ButtonLink, Field, PageHeader, path, RecordForm, value } from '../components/ui';
import { formatDate } from '../domain/dates';
import { upsert, type Patient, type RecordChange, type Task, type Wait } from '../domain/model';
import { errorMessage, t, type Message } from '../i18n';

type Save = (change: RecordChange) => Promise<void>;
type StatusOption<S> = { value: S; label: Message; icon: Icon; tone: 'open' | 'done' | 'cancelled' };

const followUpOptions: StatusOption<Wait['status']>[] = [
  { value: 'Waiting', label: 'Waiting', icon: Clock, tone: 'open' },
  { value: 'Resolved', label: 'Completed', icon: CheckCircle, tone: 'done' },
  { value: 'Cancelled', label: 'Cancelled', icon: XCircle, tone: 'cancelled' },
];
const taskOptions: StatusOption<'Open' | 'Completed'>[] = [
  { value: 'Open', label: 'Open', icon: Clock, tone: 'open' },
  { value: 'Completed', label: 'Completed', icon: CheckCircle, tone: 'done' },
];

function dateLabel(date: string) {
  return formatDate(date, { year: 'numeric', month: 'short', day: 'numeric' });
}

function StatusPanel<S extends string>({ status, options, onChange }: {
  status: S; options: StatusOption<S>[]; onChange: (status: S) => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');

  async function choose(next: S) {
    if (next === status || saving) return;
    setSaving(true);
    setFeedback('');
    setError('');
    try {
      await onChange(next);
      setFeedback(t('Status updated.'));
    } catch (problem) {
      setError(errorMessage(problem, 'Could not update the status.'));
    } finally {
      setSaving(false);
    }
  }

  return <section className="panel detail-status" aria-labelledby="item-status-heading">
    <h2 id="item-status-heading">{t('Status')}</h2>
    <div className="detail-status-options" data-count={options.length} role="group" aria-labelledby="item-status-heading">
      {options.map(({ value: next, label, tone, icon: StatusIcon }) => <button type="button" key={next}
        aria-pressed={status === next} data-tone={tone} disabled={saving} onClick={() => void choose(next)}>
        <StatusIcon size={21} aria-hidden /><span>{t(label)}</span>
      </button>)}
    </div>
    <span className="visually-hidden" role="status">{feedback}</span>
    {error && <p className="form-error" role="alert">{error}</p>}
  </section>;
}

function ItemDetail({ title, category, patient, back, edit, children }: {
  title: string; category: string; patient?: Patient; back: string; edit: string; children: ReactNode;
}) {
  return <div className="work-item-detail">
    <PageHeader title={title} subtitle={category} back={back}
      action={<ButtonLink secondary icon={PencilSimple} to={edit}>{t('Edit')}</ButtonLink>} />
    {patient ? <a className="panel small-row detail-patient" href={path('/patients/' + patient.id)}>
      <span className="detail-identity-icon"><UserCircle size={20} aria-hidden /></span>
      <span className="detail-identity"><small>{t('Patient')}</small><strong>{patient.name}</strong></span>
      <CaretRight size={16} aria-hidden />
    </a> : <div className="panel small-row detail-patient">
      <span className="detail-identity-icon"><ClipboardText size={20} aria-hidden /></span>
      <span className="detail-identity"><strong>{t('General clinic')}</strong></span>
    </div>}
    {children}
  </div>;
}

function InlineField({ label, text, display, type, min, onSave }: {
  label: string; text: string; display: string; type: 'date' | 'notes'; min?: string; onSave: (value: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const editLabel = t('Edit field {field}', { field: label });
  return <div className={type === 'notes' ? 'detail-field detail-note' : 'detail-field'}>
    {!editing && <div className="detail-field-line">
      <div>
        <strong>{label}</strong>
        <p className={text ? 'preserve' : 'muted'}>{display}</p>
      </div>
      <button className="icon-button detail-pencil" type="button" aria-label={editLabel} title={editLabel}
        onClick={() => setEditing(true)}><PencilSimple size={18} aria-hidden /></button>
    </div>}
    {editing && <RecordForm cancel={() => setEditing(false)} onSave={async data => {
      await onSave(value(data, 'field'));
      setEditing(false);
    }}>
      <Field label={label}>{type === 'date'
        ? <input name="field" type="date" defaultValue={text} min={min} autoFocus />
        : <textarea name="field" defaultValue={text} maxLength={20_000} rows={3} autoFocus />}
      </Field>
    </RecordForm>}
  </div>;
}

type Common = { today: string; save: Save; back: string; edit: string };

export function FollowUpDetail({ wait, patient, today, save, back, edit }: Common & { wait: Wait; patient: Patient }) {
  function update(fields: (current: Wait) => Partial<Wait>) {
    return save(records => {
      const current = records.waits.find(item => item.id === wait.id);
      if (!current) throw new Error('This follow-up is no longer available.');
      return { ...records, waits: upsert(records.waits, { ...current, ...fields(current) }) };
    });
  }

  return <ItemDetail title={wait.title} category={t(wait.type)} patient={patient} back={back} edit={edit}>
    <StatusPanel status={wait.status} options={followUpOptions} onChange={status => update(current => ({
      status,
      endedOn: status === 'Waiting' ? null : current.endedOn ?? (today < current.startedOn ? current.startedOn : today),
    }))} />
    <section className="panel detail-facts" aria-label={t('Details')}>
      {wait.status === 'Waiting' && wait.blocks && <p className="detail-hold"><LockSimple size={16} aria-hidden />{t('Blocks booking')}</p>}
      <dl className="detail-dates">
        <div><dt>{t('Start date')}</dt><dd>{dateLabel(wait.startedOn)}</dd></div>
        {wait.endedOn && <div><dt>{t('End date')}</dt><dd>{dateLabel(wait.endedOn)}</dd></div>}
      </dl>
      <InlineField label={t('Review date')} text={wait.reviewOn ?? ''}
        display={wait.reviewOn ? dateLabel(wait.reviewOn) : t('No date set')} type="date" min={wait.startedOn}
        onSave={date => update(() => ({ reviewOn: date || null }))} />
    </section>
    <section className="panel detail-facts" aria-label={t('Notes')}>
      <InlineField label={t('Notes')} text={wait.notes} display={wait.notes || t('No notes yet.')} type="notes"
        onSave={notes => update(() => ({ notes }))} />
    </section>
  </ItemDetail>;
}

export function TaskDetail({ task, patient, today, save, back, edit }: Common & { task: Task; patient?: Patient }) {
  function update(fields: (current: Task) => Partial<Task>) {
    return save(records => {
      const current = records.tasks.find(item => item.id === task.id);
      if (!current) throw new Error('This task is no longer available.');
      return { ...records, tasks: upsert(records.tasks, { ...current, ...fields(current) }) };
    });
  }

  return <ItemDetail title={task.title} category={t('Task')} patient={patient} back={back} edit={edit}>
    <StatusPanel status={task.completedOn ? 'Completed' : 'Open'} options={taskOptions}
      onChange={status => update(current => ({ completedOn: status === 'Open' ? null : current.completedOn ?? today }))} />
    <section className="panel detail-facts" aria-label={t('Details')}>
      {!task.completedOn && task.blocks && <p className="detail-hold"><LockSimple size={16} aria-hidden />{t('Blocks booking')}</p>}
      {task.completedOn && <dl className="detail-dates"><div><dt>{t('Completed on')}</dt><dd>{dateLabel(task.completedOn)}</dd></div></dl>}
      <InlineField label={t('Notes')} text={task.notes} display={task.notes || t('No notes yet.')} type="notes"
        onSave={notes => update(() => ({ notes }))} />
    </section>
  </ItemDetail>;
}
