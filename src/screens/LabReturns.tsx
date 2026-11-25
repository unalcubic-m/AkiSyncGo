import { CalendarBlank, CalendarPlus, CaretDown, LockSimple } from '@phosphor-icons/react';
import { Empty, path, Pill } from '../components/ui';
import { formatDate } from '../domain/dates';
import { labReturnsView, returnedLabPatients, type LabReturnRow } from '../domain/lab-returns';
import type { Records } from '../domain/model';
import { t } from '../i18n';
import { useRouteField } from '../navigation';
import './lab-returns.css';

const dateLabel = (date: string) => formatDate(date, { day: 'numeric', month: 'short' });

function ReturnedPatientRow({ entry }: { entry: LabReturnRow }) {
  const { patient, jobs } = entry;
  const patientRoute = '/patients/' + patient.id;
  const visit = 'visit' in entry ? entry.visit : undefined;
  const holds = 'holds' in entry ? entry.holds : undefined;
  const firstHold = holds?.[0];
  const holdCount = holds?.length ?? 0;
  const origin = '?from=' + labReturnsView;
  const profile = patientRoute + origin;
  let action;
  if (visit) {
    action = <a className="planning-book-action" href={path('/appointments/' + visit.id + origin)}>{t('Open appointment')}</a>;
  } else if (firstHold) {
    const detail = firstHold.kind === 'Blocking waits' ? `${patientRoute}/responses/${firstHold.id}` : '/tasks/' + firstHold.id;
    const target = holdCount === 1 ? detail + origin : profile + '&view=follow-up';
    action = <a className="planning-book-action" href={path(target)}>{t('View booking holds')}</a>;
  } else if (holds) {
    action = <a className="planning-book-action" href={path(profile)}>{t('Open patient')}</a>;
  } else {
    action = <a className="planning-book-action" href={path(`/appointments/new${origin}&patient=${patient.id}`)}
      aria-label={t('Schedule an appointment for {name}', { name: patient.name })}>
      <CalendarPlus size={17} aria-hidden />{t('Schedule visit')}</a>;
  }

  return <li className="compact-list-row planning-patient-row returned-patient" data-booked={!!visit}>
    <a className="compact-row-link" href={path(profile)}>
      <span className="compact-row-content">
        <strong>{patient.name}</strong>
        {jobs.map(job => <small key={job.id}>{job.title} · {dateLabel(job.endedOn)}</small>)}
        {visit && <small>{dateLabel(visit.date)} · {visit.start}–{visit.end}
          {'outcomePending' in entry && entry.outcomePending && <> · {t('Outcome pending')}</>}</small>}
        {firstHold && <small className="returned-hold"><LockSimple size={13} aria-hidden /> {firstHold.title}
          {holdCount > 1 && ` (+${holdCount - 1})`}</small>}
        {!visit && !firstHold && patient.status === 'Passive' && <small>{t('Passive')}</small>}
        {!visit && !holds && patient.priority !== 'Normal' && <small className="planning-priority">{t(patient.priority)}</small>}
      </span>
    </a>
    {action}
  </li>;
}

export function LabReturnList({ records, today, now }: { records: Records; today: string; now: Date }) {
  const [bookedOpen, setBookedOpen] = useRouteField('labBookedOpen', false);
  const { ready, blocked, booked } = returnedLabPatients(records, today, now);
  if (!ready.length && !blocked.length && !booked.length) {
    return <div className="panel"><Empty>{t('No patients with work returned from lab.')}</Empty></div>;
  }

  return <div className="returned-patients">
    {ready.length > 0 && <section aria-labelledby="returned-ready-heading">
      <h2 id="returned-ready-heading">{t('Ready to book')}</h2>
      <ul className="panel compact-list">{ready.map(entry => <ReturnedPatientRow key={entry.patient.id} entry={entry} />)}</ul>
    </section>}
    {blocked.length > 0 && <section aria-labelledby="returned-blocked-heading">
      <h2 id="returned-blocked-heading">{t('Booking on hold')}</h2>
      <ul className="panel compact-list">{blocked.map(entry => <ReturnedPatientRow key={entry.patient.id} entry={entry} />)}</ul>
    </section>}
    {booked.length > 0 && <details className="panel returned-booked" open={bookedOpen}
      onToggle={event => { if (event.currentTarget.open !== bookedOpen) setBookedOpen(event.currentTarget.open); }}>
      <summary><span className="compact-row-icon"><CalendarBlank size={19} aria-hidden /></span>
        <strong>{t('Patients with appointments')}</strong>
        <Pill>{booked.length}</Pill><CaretDown className="opening-caret" size={16} aria-hidden /></summary>
      <ul className="compact-list">{booked.map(entry => <ReturnedPatientRow key={entry.patient.id} entry={entry} />)}</ul>
    </details>}
  </div>;
}
