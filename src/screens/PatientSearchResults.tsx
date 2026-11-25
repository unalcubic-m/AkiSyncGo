import { CalendarBlank, CaretDown, CaretRight, ClipboardText, FileText, FirstAid, ListChecks, UserCircle, Warning } from '@phosphor-icons/react';
import { Empty, path, Pill } from '../components/ui';
import { formatDate } from '../domain/dates';
import type { PatientSearchGroup, PatientSearchHit, SearchFragment } from '../domain/patient-search';
import { t } from '../i18n';
import { useRouteField } from '../navigation';
import './patient-search-results.css';

const visibleMatches = 3;

const recordTypes = {
  patient: { label: 'Patient', icon: UserCircle },
  note: { label: 'Note', icon: FileText },
  appointment: { label: 'Appointment', icon: CalendarBlank },
  treatment: { label: 'Treatment', icon: FirstAid },
  'follow-up': { label: 'Follow-up', icon: ClipboardText },
  task: { label: 'Task', icon: ListChecks },
  alert: { label: 'Clinical alert', icon: Warning },
} as const;

type HitHref = (patientId: string, hit: PatientSearchHit) => string;

function markedText(parts: SearchFragment[]) {
  return parts.map(({ text, highlighted }, index) => highlighted ? <mark key={index}>{text}</mark> : text);
}

function RecordMatch({ hit, href }: { hit: PatientSearchHit; href: string }) {
  const { label, icon: Icon } = recordTypes[hit.kind];
  return <li>
    <a className="patient-search-hit" href={path(href)}>
      <Icon className="patient-search-hit-icon" size={16} aria-hidden />
      <span className="patient-search-hit-content">
        <span className="patient-search-meta">
          <span>{t(label)}</span>
          {hit.date && <time dateTime={hit.date}>{formatDate(hit.date, { day: 'numeric', month: 'short', year: 'numeric' })}</time>}
        </span>
        {hit.title && <strong>{hit.titleParts.length ? markedText(hit.titleParts) : hit.title}</strong>}
        {hit.excerpt.length > 0 && <span className="patient-search-excerpt">{markedText(hit.excerpt)}</span>}
      </span>
      <CaretRight size={15} aria-hidden />
    </a>
  </li>;
}

function PatientMatches({ group, hitHref }: { group: PatientSearchGroup; hitHref: HitHref }) {
  const { patient, hits, patientNameParts, contactMatch } = group;
  const [expanded, setExpanded] = useRouteField(`patient-search-expanded-${patient.id}`, false);
  const hiddenMatches = hits.length - visibleMatches;
  const contact = group.patientMatch && (patient.phone || patient.email);
  const listId = `patient-search-records-${patient.id}`;

  return <section className="panel patient-search-group" aria-label={patient.name}>
    <h2>
      <a className="patient-search-heading" href={path(`/patients/${patient.id}`)}>
        <span className="patient-search-patient">
          <strong>{patientNameParts?.length ? markedText(patientNameParts) : patient.name}</strong>
          {(contactMatch?.length || contact) && <small>{contactMatch?.length ? markedText(contactMatch) : contact}</small>}
        </span>
        <span className="patient-search-badges">
          {patient.priority !== 'Normal' && <Pill tone="amber">{t(patient.priority)}</Pill>}
          <Pill tone={patient.status === 'Active' ? 'green' : 'neutral'}>{t(patient.status)}</Pill>
        </span>
        <CaretRight size={16} aria-hidden />
      </a>
    </h2>
    {hits.length > 0 && <ul className="patient-search-hits" id={listId}>
      {(expanded ? hits : hits.slice(0, visibleMatches)).map(hit =>
        <RecordMatch key={`${hit.kind}-${hit.id}`} hit={hit} href={hitHref(patient.id, hit)} />)}
    </ul>}
    {hiddenMatches > 0 && <button type="button" className="text-button patient-search-more"
      aria-expanded={expanded} aria-controls={listId} onClick={() => setExpanded(!expanded)}>
      {expanded ? t('Show fewer matches') : t('Show {count} more matches', { count: hiddenMatches })}
      <CaretDown size={16} aria-hidden />
    </button>}
  </section>;
}

export default function PatientSearchResults({ groups, hitHref }: { groups: PatientSearchGroup[]; hitHref: HitHref }) {
  if (!groups.length) return <div className="panel"><Empty>{t('No patients or records match your search.')}</Empty></div>;
  return <div className="patient-search-results">
    {groups.map(group => <PatientMatches key={group.patient.id} group={group} hitHref={hitHref} />)}
  </div>;
}
