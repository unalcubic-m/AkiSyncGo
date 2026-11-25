import { errorMessage, getLocale, t } from '../i18n';
import { ArrowCounterClockwise, CaretDown, Check, ClipboardText, LockSimple, UserCircle } from '@phosphor-icons/react';
import { useState } from 'react';
import { Empty, Field, More, navigate, newId, PageHeader, path, RecordForm, Section, value } from '../components/ui';
import { BookingBlockSwitch, PatientSearch } from '../components/WorkFormControls';
import { formatDate } from '../domain/dates';
import { upsert, type Patient, type RecordChange, type Task } from '../domain/model';
import { openTasks } from '../domain/workflows';

type Save = (change: RecordChange) => Promise<void>;

export function TaskForm({ task, patient, patients, back, save }: {
  task?: Task; patient?: Patient; patients: Patient[]; back: string; save: Save;
}) {
  const [patientId, setPatientId] = useState(patient?.id ?? task?.patientId ?? '');
  const [scope, setScope] = useState<'clinic' | 'patient'>(patientId ? 'patient' : 'clinic');
  const [choosingPatient, setChoosingPatient] = useState(false);
  const [blocks, setBlocks] = useState(task?.blocks ?? true);
  const selected = scope === 'patient' ? patient ?? patients.find(item => item.id === patientId) : undefined;
  const showPicker = scope === 'patient' && (!selected || choosingPatient);

  return <div className="mobile-record-form task-form">
    <PageHeader title={t(task ? 'Edit task' : 'Add task')} back={back} />
    <RecordForm submit={t('Save task')} disabled={showPicker} onSave={async data => {
      const fields = {
        patientId: selected?.id ?? null,
        blocks: !!selected && blocks,
        title: value(data, 'title'),
        notes: value(data, 'notes'),
      };
      const id = task?.id ?? newId();
      await save(current => {
        const previous = current.tasks.find(item => item.id === id);
        if (task && !previous) throw new Error('This task is no longer available.');
        const next: Task = { ...previous, id, completedOn: previous?.completedOn ?? null, ...fields };
        return { ...current, tasks: upsert(current.tasks, next) };
      });
      navigate(back);
    }}>
      {!patient && <fieldset className="mobile-form-choices">
        <legend>{t('Task type')}</legend>
        <div>
          <label className="mobile-form-choice" data-selected={scope === 'clinic'}>
            <input type="radio" name="scope" checked={scope === 'clinic'} onChange={() => { setScope('clinic'); setChoosingPatient(false); }} />
            <ClipboardText size={18} aria-hidden /><span>{t('General clinic')}</span>
          </label>
          <label className="mobile-form-choice" data-selected={scope === 'patient'}>
            <input type="radio" name="scope" checked={scope === 'patient'} onChange={() => setScope('patient')} />
            <UserCircle size={18} aria-hidden /><span>{t('Patient task')}</span>
          </label>
        </div>
      </fieldset>}
      {showPicker && <div>
        <PatientSearch patients={patients} onSelect={item => { setPatientId(item.id); setChoosingPatient(false); }} />
        {selected && <button type="button" className="text-button" onClick={() => setChoosingPatient(false)}>{t('Cancel')}</button>}
      </div>}
      {selected && !showPicker && <div className="mobile-form-patient">
        <span className="compact-row-icon"><UserCircle size={19} aria-hidden /></span>
        <strong>{selected.name}</strong>
        {!patient && <button type="button" className="text-button" onClick={() => setChoosingPatient(true)}>{t('Change patient')}</button>}
      </div>}
      <Field label={t('Title')}><input name="title" required maxLength={255} defaultValue={task?.title} /></Field>
      {selected && !showPicker && <BookingBlockSwitch checked={blocks} onChange={setBlocks} when="While the task is open" />}
      <details className="mobile-form-details">
        <summary><strong>{t('Notes (optional)')}</strong><CaretDown size={17} aria-hidden /></summary>
        <div className="mobile-form-details-fields">
          <textarea name="notes" aria-label={t('Notes (optional)')} defaultValue={task?.notes} maxLength={20_000} />
        </div>
      </details>
    </RecordForm>
  </div>;
}

export function TaskList({ tasks, patients, today, save, from, history = false }: {
  tasks: Task[]; patients?: Patient[]; today: string; save: Save;
  from: 'today' | 'work' | 'tasks' | 'patient' | 'attention'; history?: boolean;
}) {
  const [pending, setPending] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const open = openTasks(tasks).sort((a, b) => a.title.localeCompare(b.title, getLocale()));
  const completed = tasks.filter(task => task.completedOn && !task.bookingCallback)
    .sort((a, b) => b.completedOn!.localeCompare(a.completedOn!) || a.title.localeCompare(b.title, getLocale()));
  const onToday = from === 'today';

  async function toggle(task: Task) {
    if (pending) return;
    setPending(task.id);
    setMessage('');
    setError('');
    const completedOn = task.completedOn ? null : today;
    try {
      await save(current => {
        const previous = current.tasks.find(item => item.id === task.id);
        if (!previous) throw new Error('This task is no longer available.');
        return { ...current, tasks: upsert(current.tasks, { ...previous, completedOn }) };
      });
      setMessage(t(completedOn ? 'Task completed.' : 'Task reopened.'));
    } catch (problem) {
      setError(errorMessage(problem, 'Could not update the task.'));
    } finally {
      setPending('');
    }
  }

  function row(task: Task) {
    const patient = patients?.find(item => item.id === task.patientId);
    const detail = '/tasks/' + task.id + '?from=' + from;
    const label = t(task.completedOn ? 'Reopen {title}' : 'Complete {title}', { title: task.title });
    return <li className={onToday ? 'compact-list-row' : 'compact-list-row task-list-row'} key={task.id}>
      {onToday ? <a className="compact-row-link today-task-link" href={path(patient ? '/patients/' + patient.id : detail)}>
        <span className="compact-row-content">
          {patient && <><strong>{patient.name}</strong><span className="today-task-separator"> · </span></>}
          <span>{task.title}</span>
        </span>
      </a> : <div className="task-list-content">
        <a className="task-list-title" href={path(detail)}>{task.title}</a>
        <div className="task-list-meta">
          {patient && <a href={path('/patients/' + patient.id)}>{patient.name}</a>}
          {patients && !task.patientId && <span>{t('General clinic')}</span>}
          {task.blocks && !task.completedOn && <span className="task-lock" role="img" aria-label={t('Blocks booking')}>
            <LockSimple size={14} aria-hidden />
          </span>}
          {task.completedOn && <span>{t('Completed {date}', { date: formatDate(task.completedOn) })}</span>}
        </div>
      </div>}
      <button type="button" className="icon-button compact-row-action" onClick={() => void toggle(task)} disabled={!!pending}
        aria-label={label} title={label}>
        {task.completedOn ? <ArrowCounterClockwise size={18} aria-hidden /> : <Check size={18} aria-hidden />}
      </button>
    </li>;
  }

  return <>
    {onToday ? open.length > 0 && <Section title={t('Tasks')} className="today-tasks"
      action={open.length > 3 ? <More to="/work?view=tasks">{t('All tasks')}</More> : undefined}>
      <ul className="panel compact-list">{open.slice(0, 3).map(row)}</ul>
    </Section> : <>
      {open.length > 0 ? <ul className="panel compact-list">{open.map(row)}</ul>
        : <div className="panel"><Empty>{t('No open tasks.')}</Empty></div>}
      {open.some(task => task.blocks) && <p className="task-lock-key">
        <LockSimple size={14} aria-hidden />{t('Blocks booking')}
      </p>}
      {history && completed.length > 0 && <details className="panel task-history">
        <summary>{t('Completed tasks ({count})', { count: completed.length })}</summary>
        <ul className="compact-list task-history-list">{completed.map(row)}</ul>
      </details>}
    </>}
    <div className={onToday ? 'visually-hidden' : 'task-feedback'} role="status">{message}</div>
    {error && <p className="form-error" role="alert">{error}</p>}
  </>;
}
