import { t } from '../i18n';
import { CaretDown, ChatCircleText, DotsThree, Flask, Heartbeat, UserCircle, UsersThree, type Icon } from '@phosphor-icons/react';
import { useRef, useState } from 'react';
import { Field, navigate, newId, Options, PageHeader, path, RecordForm, value } from '../components/ui';
import { BookingBlockSwitch } from '../components/WorkFormControls';
import { formatDate } from '../domain/dates';
import {
  alertTypes, contactTypes, patientStatuses, priorities, severities, upsert, waitStatuses, waitTypes,
  type Alert, type Encounter, type Patient, type RecordChange, type Records, type Treatment, type Wait,
} from '../domain/model';
import { closeTreatment } from '../domain/workflows';

type Save = (change: RecordChange) => Promise<void>;
type PatientFormProps = { patient?: Patient; today: string; save: Save };
type DetailFormProps = { patient: Patient; today: string; save: Save };

export function PatientForm({ patient, today, save }: PatientFormProps) {
  const back = patient ? '/patients/' + patient.id : '/patients';
  return <>
    <PageHeader title={t(patient ? 'Edit patient' : 'Add patient')} back={back} />
    <RecordForm cancel={back} submit={t('Save patient')} onSave={async data => {
      const id = patient?.id ?? newId();
      const fields = {
        id, name: value(data, 'name'), phone: value(data, 'phone'), email: value(data, 'email'),
        status: value(data, 'status') as Patient['status'], priority: value(data, 'priority') as Patient['priority'],
        priorityNote: value(data, 'priorityNote'),
      };
      await save(records => {
        const original = records.patients.find(item => item.id === id);
        const updated = { createdOn: today, summary: '', nextAction: '', ...original, ...fields };
        return { ...records, patients: upsert(records.patients, updated) };
      });
      navigate('/patients/' + id);
    }}>
      <Field label={t('Full name')}><input name="name" autoComplete="off" defaultValue={patient?.name} required maxLength={255} /></Field>
      <div className="form-grid">
        <Field label={t('Phone')}><input type="tel" name="phone" defaultValue={patient?.phone} maxLength={255} /></Field>
        <Field label={t('Email')}><input type="email" name="email" defaultValue={patient?.email} maxLength={255} /></Field>
        <Field label={t('Status')}><select name="status" defaultValue={patient?.status ?? 'Active'}><Options values={patientStatuses} /></select></Field>
        <Field label={t('Priority')}><select name="priority" defaultValue={patient?.priority ?? 'Normal'}><Options values={priorities} /></select></Field>
      </div>
      <Field label={t('Priority note')}><textarea name="priorityNote" defaultValue={patient?.priorityNote} maxLength={20_000} /></Field>
    </RecordForm>
    {patient && <a className="button secondary danger settings-action" href={path(back + '/delete')}>{t('Delete patient')}</a>}
  </>;
}

export function MemoryForm({ patient, save }: DetailFormProps) {
  const back = '/patients/' + patient.id;
  return <>
    <PageHeader title={t('Edit patient memory')} subtitle={patient.name} back={back} />
    <RecordForm cancel={back} onSave={async data => {
      await save(records => ({
        ...records, patients: records.patients.map(item => item.id === patient.id
          ? { ...item, summary: value(data, 'summary'), nextAction: value(data, 'nextAction') } : item),
      }));
      navigate(back);
    }}>
      <Field label={t('Clinical summary')}><textarea name="summary" rows={5} defaultValue={patient.summary} maxLength={20_000} /></Field>
      <Field label={t('Next action')}><textarea name="nextAction" rows={3} defaultValue={patient.nextAction} maxLength={20_000} /></Field>
    </RecordForm>
  </>;
}

export function TreatmentForm({ patient, today, save, treatment, close }: DetailFormProps & { treatment?: Treatment; close?: boolean }) {
  const back = '/patients/' + patient.id;
  return <>
    <PageHeader title={t(close ? 'Close treatment' : treatment ? 'Edit treatment' : 'Add treatment')} subtitle={patient.name} back={back} />
    <RecordForm cancel={back} submit={t(close ? 'Close treatment' : 'Save treatment')} onSave={async data => {
      if (close && treatment) {
        await save(records => closeTreatment(records, treatment.id, value(data, 'closedOn'), value(data, 'closureNote')));
      } else {
        const fields = { id: treatment?.id ?? newId(), patientId: patient.id, title: value(data, 'title'), startedOn: value(data, 'startedOn') };
        const next: Treatment = treatment?.status === 'Closed'
          ? { ...fields, status: 'Closed', closedOn: value(data, 'closedOn'), closureNote: value(data, 'closureNote') }
          : { ...fields, status: 'Active', closedOn: null, closureNote: '' };
        await save(records => ({ ...records, treatments: upsert(records.treatments, next) }));
      }
      navigate(back);
    }}>
      {close ? <p className="form-intro"><strong>{treatment?.title}</strong> · {t('Started {date}', { date: formatDate(treatment!.startedOn) })}</p> : <>
        <Field label={t('Title')}><input name="title" required maxLength={255} defaultValue={treatment?.title} /></Field>
        <Field label={t('Start date')}><input type="date" name="startedOn" required max={today} defaultValue={treatment?.startedOn ?? today} /></Field>
      </>}
      {(close || treatment?.status === 'Closed') && <>
        <Field label={t('Closure date')}><input type="date" name="closedOn" required min={close ? treatment?.startedOn : undefined} max={today} defaultValue={treatment?.closedOn ?? today} /></Field>
        <Field label={t('Closure note (optional)')}><textarea name="closureNote" defaultValue={treatment?.closureNote} maxLength={20_000} /></Field>
      </>}
    </RecordForm>
  </>;
}

type NoteProps = DetailFormProps & { records: Records; note?: Encounter; linkedId?: string };

export function NoteEditor({ patient, today, save, records, note, linkedId, inline, cancel, onSaved }: NoteProps & {
  inline?: boolean; cancel: string | (() => void); onSaved: (note: Encounter) => void;
}) {
  const details = useRef<HTMLDetailsElement>(null);
  const visits = records.appointments.filter(item => item.patientId === patient.id)
    .sort((a, b) => b.date.localeCompare(a.date) || b.start.localeCompare(a.start));
  const linked = visits.find(item => item.id === linkedId);
  const [appointmentId, setAppointmentId] = useState(note ? note.appointmentId ?? '' : linked?.id ?? '');
  const appointment = visits.find(item => item.id === appointmentId);
  const date = note?.date ?? (linked && linked.date < today ? linked.date : today);
  return <div className="note-editor">
    <RecordForm cancel={cancel} submit={t('Save note')} onSave={async data => {
      const body = value(data, 'body');
      if (!body) throw new Error('Write a note before saving.');
      const next: Encounter = {
        id: note?.id ?? newId(), patientId: patient.id, appointmentId: value(data, 'appointment') || null,
        date: value(data, 'date'), type: value(data, 'type') as Encounter['type'],
        title: value(data, 'title'), body, nextPlan: value(data, 'nextPlan'),
      };
      await save(records => ({ ...records, notes: upsert(records.notes, next) }));
      onSaved(next);
    }}>
      <Field label={t('Note')}><textarea name="body" defaultValue={note?.body} rows={inline ? 3 : 4} maxLength={20_000}
        placeholder={t('Write a note…')} autoFocus={inline} required /></Field>
      <details ref={details} className="note-details">
        <summary>
          <span><strong>{t('Note details')}</strong>
            {appointment && <small>{appointment.title} · {t('{date} at {time}', { date: formatDate(appointment.date), time: appointment.start })}</small>}
          </span>
          <CaretDown aria-hidden />
        </summary>
        <div className="note-details-fields">
          <div className="form-grid">
            <Field label={t('Date')}><input type="date" name="date" max={today} defaultValue={date} required onInvalid={() => {
              if (details.current) details.current.open = true;
            }} /></Field>
            <Field label={t('Contact type')}><select name="type" defaultValue={note?.type ?? (linked ? 'Clinical visit' : 'Other')}>
              <Options values={contactTypes} />
            </select></Field>
          </div>
          <Field label={t('Appointment (optional)')}><select name="appointment" value={appointmentId} onChange={event => setAppointmentId(event.target.value)}>
            <option value="">{t('No linked appointment')}</option>{visits.map(item => <option key={item.id} value={item.id}>{formatDate(item.date)} · {item.start} · {item.title}</option>)}
          </select></Field>
          <Field label={t('Title (optional)')}><input name="title" defaultValue={note?.title} maxLength={255} /></Field>
          <Field label={t('Next plan (optional)')}><textarea name="nextPlan" defaultValue={note?.nextPlan} rows={2} maxLength={20_000} /></Field>
        </div>
      </details>
    </RecordForm>
  </div>;
}

export function NoteForm(props: NoteProps) {
  const back = '/patients/' + props.patient.id;
  return <>
    <PageHeader title={t(props.note ? 'Edit note' : 'Add note')} subtitle={props.patient.name} back={back} />
    <NoteEditor {...props} cancel={back} onSaved={() => navigate(back)} />
  </>;
}

export function AlertForm({ patient, save, alert }: DetailFormProps & { alert?: Alert }) {
  const back = '/patients/' + patient.id;
  return <>
    <PageHeader title={t(alert ? 'Edit clinical alert' : 'Add clinical alert')} subtitle={patient.name} back={back} />
    <RecordForm cancel={back} submit={t('Save alert')} onSave={async data => {
      const next: Alert = {
        id: alert?.id ?? newId(), patientId: patient.id, label: value(data, 'label'), type: value(data, 'type') as Alert['type'],
        severity: value(data, 'severity') as Alert['severity'], notes: value(data, 'notes'), active: data.has('active'),
      };
      await save(records => ({ ...records, alerts: upsert(records.alerts, next) }));
      navigate(back);
    }}>
      <Field label={t('Alert label')}><input name="label" defaultValue={alert?.label} maxLength={255} required /></Field>
      <div className="form-grid">
        <Field label={t('Alert type')}><select name="type" defaultValue={alert?.type ?? 'Allergy'}><Options values={alertTypes} /></select></Field>
        <Field label={t('Severity')}><select name="severity" defaultValue={alert?.severity ?? 'Caution'}><Options values={severities} /></select></Field>
      </div>
      <Field label={t('Notes')}><textarea name="notes" defaultValue={alert?.notes} maxLength={20_000} /></Field>
      <label className="check"><input type="checkbox" name="active" defaultChecked={alert?.active ?? true} />{t('Show this alert on the profile and agenda')}</label>
    </RecordForm>
  </>;
}

const followUpIcons = {
  'Patient reply': ChatCircleText,
  Consultation: UsersThree,
  Healing: Heartbeat,
  'Laboratory return': Flask,
  Other: DotsThree,
} satisfies Record<Wait['type'], Icon>;

export function WaitForm({ patient, today, save, wait, returnTo, labCheck, completingVisit }: DetailFormProps & {
  wait?: Wait; returnTo?: string; labCheck?: boolean; completingVisit?: boolean;
}) {
  const back = returnTo ?? '/patients/' + patient.id;
  const picker = !wait && (returnTo === '/work' || returnTo === '/work?view=responses')
    ? '/responses/new?from=' + (returnTo === '/work' ? 'work' : 'responses')
    : undefined;
  const [status, setStatus] = useState<Wait['status']>(wait?.status ?? 'Waiting');
  const [type, setType] = useState<Wait['type']>(wait?.type ?? 'Laboratory return');
  const [startDate, setStartDate] = useState(wait?.startedOn ?? today);
  const [blocks, setBlocks] = useState(wait?.blocks ?? true);
  const suggestedTitle = t(type === 'Laboratory return' ? 'Lab check' : type);

  return <div className="mobile-record-form">
    <PageHeader title={t(completingVisit ? 'Complete and add follow-up' : wait ? 'Edit follow-up' : labCheck ? 'Add lab check' : 'Add follow-up')} back={picker ?? back} />
    <div className="mobile-form-patient">
      <span className="compact-row-icon"><UserCircle size={19} aria-hidden /></span>
      <strong>{patient.name}</strong>
      {picker && <a className="text-button" href={path(picker)}>{t('Change patient')}</a>}
    </div>
    <RecordForm submit={t(completingVisit ? 'Complete and save follow-up' : 'Save follow-up')} onSave={async data => {
      const next: Wait = {
        id: wait?.id ?? newId(),
        patientId: patient.id,
        title: value(data, 'title') || suggestedTitle,
        type,
        status,
        startedOn: value(data, 'startedOn'),
        reviewOn: value(data, 'reviewOn') || null,
        endedOn: status === 'Waiting' ? null : value(data, 'endedOn'),
        blocks: data.has('blocks'),
        notes: value(data, 'notes'),
      };
      await save(records => ({ ...records, waits: upsert(records.waits, next) }));
      navigate(back);
    }}>
      <fieldset className="mobile-form-choices">
        <legend>{t('Follow-up type')}</legend>
        <div>
          {waitTypes.map(option => {
            const IconComponent = followUpIcons[option];
            const label = t(option === 'Laboratory return' ? 'Laboratory' : option);
            return <label key={option} className="mobile-form-choice" data-selected={type === option}>
              <input type="radio" name="type" value={option} checked={type === option} onChange={() => setType(option)} />
              <IconComponent size={18} aria-hidden />
              <span>{label}</span>
            </label>;
          })}
        </div>
      </fieldset>
      <Field label={t('Title (optional)')}><input name="title" placeholder={suggestedTitle}
        defaultValue={wait?.title ?? ''} maxLength={255} /></Field>
      <BookingBlockSwitch checked={blocks} onChange={setBlocks} when="While the follow-up is open" />
      <details className="mobile-form-details" onInvalidCapture={event => { event.currentTarget.open = true; }}>
        <summary>
          <span><strong>{t('Details')}</strong><small>{t('Dates, status, and notes')}</small></span>
          <CaretDown size={17} aria-hidden />
        </summary>
        <div className="mobile-form-details-fields">
          <Field label={t('Status')}><select name="status" value={status}
            onChange={event => setStatus(event.target.value as Wait['status'])}><Options values={waitStatuses} /></select></Field>
          <Field label={t('Review date (optional)')}><input type="date" name="reviewOn" min={startDate} defaultValue={wait?.reviewOn ?? ''} /></Field>
          <Field label={t('Start date')}><input type="date" name="startedOn" max={today}
            value={startDate} onChange={event => setStartDate(event.target.value)} required /></Field>
          {status !== 'Waiting' && <Field label={t('End date')}><input type="date" name="endedOn" min={startDate} max={today}
            defaultValue={wait?.endedOn ?? today} required /></Field>}
          <Field label={t('Notes (optional)')}><textarea name="notes" defaultValue={wait?.notes} maxLength={20_000} /></Field>
        </div>
      </details>
    </RecordForm>
  </div>;
}
