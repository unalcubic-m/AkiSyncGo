import { CaretRight, LockSimple, MagnifyingGlass } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import type { Patient } from '../domain/model';
import { searchBookingPatients } from '../domain/workflows';
import { t, type Message } from '../i18n';
import { Empty, path, Pill } from './ui';

const patientPageSize = 8;
type PatientSearchProps = { patients: Patient[] } & (
  { to: (patient: Patient) => string; onSelect?: never } |
  { to?: never; onSelect: (patient: Patient) => void }
);

export function PatientSearch({ patients, to, onSelect }: PatientSearchProps) {
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(patientPageSize);
  const results = useRef<HTMLUListElement>(null);
  const nextFocus = useRef<number | null>(null);
  const matches = searchBookingPatients(patients, query);

  useEffect(() => {
    if (nextFocus.current === null) return;
    results.current?.querySelectorAll<HTMLElement>('a, button')[nextFocus.current]?.focus();
    nextFocus.current = null;
  }, [limit]);

  if (!patients.length) return <Empty><a href={path('/patients/new')}>{t('Add your first patient to get started.')}</a></Empty>;

  return <div className="patient-search">
    <label className="search">
      <MagnifyingGlass size={20} aria-hidden />
      <input type="search" aria-label={t('Search patients')} placeholder={t('Name, phone, or email')} value={query}
        onChange={event => { setQuery(event.target.value); setLimit(patientPageSize); }} />
    </label>
    {matches.length > 0 ? <>
      <ul ref={results} className="panel compact-list patient-search-results">
        {matches.slice(0, limit).map(patient => {
          const lastFour = patient.phone.replace(/\D/g, '').slice(-4);
          const label = <>
            <span className="compact-row-content">
              <strong>{patient.name}</strong>
              {lastFour.length === 4 && <small>•••• {lastFour}</small>}
            </span>
            {patient.status === 'Passive' && <Pill>{t('Passive')}</Pill>}
            <CaretRight size={15} aria-hidden />
          </>;
          return <li className="compact-list-row patient-search-row" key={patient.id}>
            {to ? <a className="compact-row-link" href={path(to(patient))}>{label}</a>
              : <button type="button" className="compact-row-link" onClick={() => onSelect(patient)}>{label}</button>}
          </li>;
        })}
      </ul>
      {matches.length > limit && <button type="button" className="text-button patient-search-more" onClick={() => {
        nextFocus.current = limit;
        setLimit(limit + patientPageSize);
      }}>{t('Show more patients')}</button>}
    </> : <p className="patient-search-message" role="status">{t(query.trim()
      ? 'No matching patients. Try a surname or the last four digits of the phone number.'
      : 'Search by name, phone number, or email.')}</p>}
  </div>;
}

export function BookingBlockSwitch({ checked, onChange, when }: {
  checked: boolean; onChange: (checked: boolean) => void; when: Message;
}) {
  return <label className="booking-block-switch">
    <span className="compact-row-icon"><LockSimple size={17} aria-hidden /></span>
    <span><strong>{t('Block booking')}</strong><small>{t(when)}</small></span>
    <input type="checkbox" role="switch" name="blocks" checked={checked}
      onChange={event => onChange(event.target.checked)} />
  </label>;
}
