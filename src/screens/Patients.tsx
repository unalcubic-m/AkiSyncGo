import { t } from '../i18n';
import { CaretRight, MagnifyingGlass, Plus } from '@phosphor-icons/react';
import { useDeferredValue, useMemo } from 'react';
import { useRouteField } from '../navigation';
import { ButtonLink, Empty, Field, Options, PageHeader, path, Pill } from '../components/ui';
import { patientStatuses, priorities, type Records } from '../domain/model';
import { searchPatientHistory, type PatientSearchHit } from '../domain/patient-search';
import { searchPatients } from '../domain/workflows';
import PatientSearchResults from './PatientSearchResults';

function hitHref(patientId: string, hit: PatientSearchHit) {
  const profile = `/patients/${patientId}`;
  const fromSearch = '?from=patient-search';
  switch (hit.kind) {
    case 'patient': return profile;
    case 'note': return `${profile}?note=${encodeURIComponent(hit.id)}`;
    case 'appointment': return `/appointments/${hit.id}${fromSearch}`;
    case 'treatment': return `${profile}/treatments/${hit.id}`;
    case 'follow-up': return `${profile}/responses/${hit.id}${fromSearch}`;
    case 'task': return `/tasks/${hit.id}${fromSearch}`;
    case 'alert': return `${profile}/alerts/${hit.id}`;
  }
}

export default function Patients({ records }: { records: Records }) {
  const [query, setQuery] = useRouteField('search', '');
  const [chosenStatus, setChosenStatus] = useRouteField<string | undefined>('status', undefined);
  const [priority, setPriority] = useRouteField('priority', 'All');
  const status = chosenStatus ?? (query.trim() ? 'All' : 'Active');
  const deferredQuery = useDeferredValue(query.trim());
  const groups = useMemo(() => deferredQuery ? searchPatientHistory(records, deferredQuery, status, priority) : undefined,
    [records, deferredQuery, status, priority]);
  const patients = useMemo(() => groups ? [] : searchPatients(records, '', status, priority), [records, groups, status, priority]);
  const count = groups?.length ?? patients.length;
  return <>
    <PageHeader title={t('Patients')} action={<ButtonLink to="/patients/new" icon={Plus}>{t('Add patient')}</ButtonLink>} />
    <div className="patient-filters">
      <label className="search"><MagnifyingGlass aria-hidden /><input aria-label={t('Search patients')} type="search" placeholder={t('Search patients and records')} value={query} onChange={event => setQuery(event.target.value)} /></label>
      <Field label={t('Status')}><select value={status} onChange={event => setChosenStatus(event.target.value)}><Options values={['All', ...patientStatuses]} /></select></Field>
      <Field label={t('Priority')}><select value={priority} onChange={event => setPriority(event.target.value)}><Options values={['All', ...priorities]} /></select></Field>
    </div>
    <p className="result-count" role="status">{t(count === 1 ? '{count} patient' : '{count} patients', { count })}</p>
    {groups ? <PatientSearchResults groups={groups} hitHref={hitHref} /> : <div className="panel">
      {patients.map(patient => <a className="patient-row" key={patient.id} href={path(`/patients/${patient.id}`)}>
        <span className="avatar" aria-hidden>{patient.name.split(/\s+/).slice(0, 2).map(word => [...word][0]).join('')}</span>
        <span><strong>{patient.name}</strong><small>{patient.phone || patient.email || t('No contact details')}</small></span>
        {patient.priority !== 'Normal' && <Pill tone="amber">{t(patient.priority)}</Pill>}
        <Pill tone={patient.status === 'Active' ? 'green' : 'neutral'}>{t(patient.status)}</Pill><CaretRight aria-hidden />
      </a>)}
      {patients.length === 0 && <Empty>{t(records.patients.length ? 'No patients match these filters.' : 'Add your first patient to get started.')}</Empty>}
    </div>}
  </>;
}
