import { lastSeen, t } from '../i18n';
import { CalendarPlus, Flask, Plus } from '@phosphor-icons/react';
import { useState } from 'react';
import { Empty, Field, More, navigate, PageHeader, path, RecordForm, Section, value, newId } from '../components/ui';
import { formatDate } from '../domain/dates';
import { labReturnsRoute } from '../domain/lab-returns';
import { upsert, type RecordChange, type Records, type Visit } from '../domain/model';
import type { ScheduleConflict } from '../domain/schedule-conflicts';
import { openTasks, planningCandidates, responseReviews } from '../domain/workflows';
import { openRoute } from '../navigation';
import { OutcomeShortcut } from './AppointmentOutcomes';
import { BreakSettings, DateHours, HoursFields, WeekdayPicker, weekdays } from './ScheduleSettings';
import { TaskList } from './Tasks';
import { FollowUpList } from '../components/FollowUpList';
import { LabReturnList } from './LabReturns';

type Save = (change: RecordChange) => Promise<void>;

export function Planning({ records, today, now, labOnly }: { records: Records; today: string; now: Date; labOnly: boolean }) {
  const candidates = labOnly ? [] : planningCandidates(records, today);
  const filterLabel = t('Patients with work returned from lab');
  return <>
    <header className="page-header planning-header">
      <div>
        <h1>{t('Planning')}</h1>
        <p role="status">{labOnly ? filterLabel : t('{count} ready to book', { count: candidates.length })}</p>
      </div>
      <button className="icon-button planning-lab-filter" type="button" aria-label={filterLabel} title={filterLabel}
        aria-pressed={labOnly} onClick={() => openRoute(labOnly ? '/planning' : labReturnsRoute)}>
        <Flask size={22} weight={labOnly ? 'fill' : 'regular'} aria-hidden />
      </button>
    </header>
    {labOnly ? <LabReturnList records={records} today={today} now={now} /> : candidates.length > 0 ? <ul className="panel compact-list planning-list">
      {candidates.map(({ patient, seenOn, elapsedDays }) => <li key={patient.id} className="compact-list-row planning-patient-row">
        <a className="compact-row-link" href={path('/patients/' + patient.id)}>
          <span className="compact-row-content">
            <strong>{patient.name}</strong>
            {patient.priority !== 'Normal' && <small className="planning-priority">{t(patient.priority)}</small>}
            {seenOn && <small>{lastSeen(elapsedDays)}</small>}
            {patient.nextAction && <small>{patient.nextAction}</small>}
          </span>
        </a>
        <a className="planning-book-action" href={path(`/appointments/new?patient=${patient.id}&from=planning`)}
          aria-label={t('Schedule an appointment for {name}', { name: patient.name })}>
          <CalendarPlus size={17} aria-hidden /> <span>{t('Schedule visit')}</span>
        </a>
      </li>)}
    </ul> : <div className="panel"><Empty>{t('No patients ready to book.')}</Empty></div>}
  </>;
}

export function Attention({ records, today, outstanding, save }: { records: Records; today: string; outstanding: Visit[]; save: Save }) {
  return <>
    <PageHeader title={t('Needs attention')} back="/today" />
    <OutcomeShortcut visits={outstanding} today={today} fromAttention />
    <Section title={t('Open tasks')} action={<More to="/work?view=tasks">{t('All tasks')}</More>}>
      <TaskList tasks={openTasks(records.tasks)} patients={records.patients} today={today} save={save} from="attention" />
    </Section>
    <Section title={t('Follow-ups')} action={<More to="/work?view=responses">{t('All follow-ups')}</More>}>
      <FollowUpList patients={records.patients} today={today} waits={responseReviews(records, today)} save={save} from="attention" />
    </Section>
  </>;
}

export function Availability({ records, today, save, editId, selected, hoursDate, breakId, occurrence, conflicts }: {
  records: Records; today: string; save: Save; editId?: string; selected?: string; hoursDate?: string; breakId?: string; occurrence?: string;
  conflicts: ScheduleConflict[];
}) {
  const [showTimeOff, setShowTimeOff] = useState(false);
  const [message, setMessage] = useState('');
  const edit = records.timeOff.find(item => item.id === editId);
  const [partial, setPartial] = useState(!!edit?.hours);
  const [hours, setHours] = useState(records.workingHours);
  const [bulkDays, setBulkDays] = useState([1, 2, 3, 4, 5]);
  const [bulkHours, setBulkHours] = useState({ start: '09:00', end: '17:00' });
  const [bulkOpen, setBulkOpen] = useState(false);
  const addWindow = (day: number) => setHours([...hours, { day, start: '09:00', end: '17:00' }]);
  const dateHours = <DateHours records={records} today={today} initialDate={selected} editDate={hoursDate} save={save} />;
  return <>
    <PageHeader title={t('Availability')} back={selected ? '/calendar?date=' + selected : '/calendar'}
      subtitle={selected ? formatDate(selected, { weekday: 'long', day: 'numeric', month: 'long' }) : undefined} />
    {hoursDate && dateHours}
    <BreakSettings records={records} today={today} selected={selected} save={save} editId={breakId} occurrence={occurrence} conflicts={conflicts} />
    <Section title={t('Weekly working hours')}>
      <details className="panel availability-bulk" open={bulkOpen} onToggle={event => setBulkOpen(event.currentTarget.open)}>
        <summary>{t('Set the same hours for several weekdays')}</summary>
        {bulkOpen && <RecordForm submit={t('Save hours for selected days')} disabled={!bulkDays.length} onSave={async () => {
          const newWindows = bulkDays.map(day => ({ day, ...bulkHours }));
          await save(current => ({ ...current, workingHours: [...current.workingHours.filter(item => !bulkDays.includes(item.day)), ...newWindows] }));
          setHours([...hours.filter(item => !bulkDays.includes(item.day)), ...newWindows]);
          setBulkOpen(false);
          setMessage(t('Working hours saved.'));
        }}>
          <div className="form-grid"><HoursFields hours={bulkHours} onChange={setBulkHours} /></div>
          <WeekdayPicker selected={bulkDays} onChange={setBulkDays} />
        </RecordForm>}
      </details>
      {message && <p className="save-status" role="status">{message}</p>}
      <RecordForm submit={t('Save working hours')} onSave={async () => {
        await save(current => ({ ...current, workingHours: hours }));
        setMessage(t('Working hours saved.'));
      }}>
        {weekdays.map(({ day, label }) => <fieldset className="hours-day" key={day}>
          <legend>{t(label)}</legend>
          {hours.map((item, index) => item.day === day && <div className="hours-entry" key={index}>
            <HoursFields hours={item} onChange={next => setHours(hours.map((entry, i) => i === index ? { ...entry, ...next } : entry))} />
            <button className="button secondary" type="button" onClick={() => setHours(hours.filter((_, i) => i !== index))}>{t('Remove')}</button>
          </div>)}
          {!hours.some(item => item.day === day) && <p className="muted">{t('Unavailable')}</p>}
          <button className="text-button" type="button" onClick={() => addWindow(day)}><Plus aria-hidden />{' '}{t('Add hours')}</button>
        </fieldset>)}
      </RecordForm>
    </Section>
    {!hoursDate && dateHours}
    <Section title={t('Time off')} action={!edit && !showTimeOff && <button className="button secondary" onClick={() => { setPartial(false); setShowTimeOff(true); }}><Plus aria-hidden />{' '}{t('Add time off')}</button>}>
      {(showTimeOff || edit) && <RecordForm submit={t('Save time off')} cancel={edit ? '/availability' : undefined} onSave={async data => {
        const fields = {
          id: edit?.id ?? newId(), title: value(data, 'title'), from: value(data, 'from'), through: value(data, 'through'),
          hours: partial ? { start: value(data, 'start'), end: value(data, 'end') } : null,
        };
        await save(current => ({ ...current, timeOff: upsert(current.timeOff, fields) }));
        setShowTimeOff(false);
        if (edit) navigate('/availability');
      }}>
        <Field label={t('Title')}><input name="title" required maxLength={255} defaultValue={edit?.title} /></Field>
        <div className="form-grid">
          <Field label={t('From date')}><input type="date" name="from" defaultValue={edit?.from ?? today} required /></Field>
          <Field label={t('Through date')}><input type="date" name="through" defaultValue={edit?.through ?? today} required /></Field>
        </div>
        <label className="check"><input type="checkbox" checked={partial} onChange={event => setPartial(event.target.checked)} />{t('Set a time range for each day')}</label>
        {partial && <div className="form-grid">
          <Field label={t('Time off starts')}><input type="time" name="start" defaultValue={edit?.hours?.start} required /></Field>
          <Field label={t('Time off ends')}><input type="time" name="end" defaultValue={edit?.hours?.end} required /></Field>
        </div>}
        {!edit && <button type="button" className="text-button" onClick={() => setShowTimeOff(false)}>{t('Cancel')}</button>}
      </RecordForm>}
      <div className="panel">
        {[...records.timeOff].sort((a, b) => a.from.localeCompare(b.from)).map(item => <article className="record-row" key={item.id}>
          <div className="row-heading"><strong>{item.title}</strong><More to={'/availability?edit=' + item.id}>{t('Edit')}</More></div>
          <p>{formatDate(item.from)}{item.through !== item.from && ' – ' + formatDate(item.through)} · {item.hours ? item.hours.start + '–' + item.hours.end : t('All day')}</p>
          {edit?.id === item.id && <RecordForm submit={t('Remove this time off')} onSave={async () => {
            await save(current => ({ ...current, timeOff: current.timeOff.filter(entry => entry.id !== item.id) }));
            navigate('/availability');
          }}><p className="muted">{t('Remove this entry from the schedule.')}</p></RecordForm>}
        </article>)}
        {!records.timeOff.length && <Empty>{t('No time off recorded.')}</Empty>}
      </div>
    </Section>
  </>;
}
