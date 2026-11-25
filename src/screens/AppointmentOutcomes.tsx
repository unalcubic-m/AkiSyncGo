import { ArrowLeft, ArrowRight, CaretRight, CheckCircle, ClipboardText, Clock } from '@phosphor-icons/react';
import { useRef } from 'react';
import { path } from '../components/ui';
import { formatDate } from '../domain/dates';
import type { Records, Visit } from '../domain/model';
import { t } from '../i18n';
import { useRouteField } from '../navigation';

export const outcomesRoute = '/appointment-outcomes';
export const attentionOutcomesRoute = outcomesRoute + '?from=attention';
export const outcomeReturnRoutes = new Map([
  ['appointment-outcomes', outcomesRoute],
  ['attention-outcomes', attentionOutcomesRoute],
]);

const dateLabel = (date: string) => formatDate(date, { day: 'numeric', month: 'short' });

export function OutcomeShortcut({ visits, today, fromAttention = false }: { visits: Visit[]; today: string; fromAttention?: boolean }) {
  const count = visits.length;
  if (!count) return null;
  const todayCount = visits.filter(item => item.date === today).length;
  return <a className="outcome-shortcut"
    href={path(fromAttention ? attentionOutcomesRoute : outcomesRoute)}>
    <span className="outcome-shortcut-icon"><ClipboardText size={22} weight="duotone" aria-hidden /></span>
    <span className="outcome-shortcut-copy">
      <strong>{t('Awaiting appointment outcomes')}</strong>
      <small>{t('{today} today · {earlier} from earlier days', { today: todayCount, earlier: count - todayCount })}</small>
    </span>
    <span className="outcome-shortcut-end">
      <span className="outcome-shortcut-count">{count}</span><CaretRight size={16} weight="bold" aria-hidden />
    </span>
  </a>;
}

const filters = ['all', 'today', 'earlier'] as const;
type Filter = typeof filters[number];

function OutcomeQueueRow({ visit, patientName, showDate, href }: {
  visit: Visit; patientName?: string; showDate: boolean; href: string;
}) {
  return <li className="outcome-row">
    <a className="outcome-row-link" href={href}>
      <span className="outcome-row-detail">
        <strong>{patientName ?? visit.title}</strong>
        {patientName && <span>{visit.title}</span>}
        <small><Clock size={13} aria-hidden />
          <span>{showDate && <>{dateLabel(visit.date)} · </>}{visit.start}–{visit.end}</span>
        </small>
      </span>
      <span className="outcome-row-action">{t('Record outcome')}<CaretRight size={14} aria-hidden /></span>
    </a>
  </li>;
}

export default function AppointmentOutcomes({ visits, records, today, fromAttention }: {
  visits: Visit[]; records: Records; today: string; fromAttention: boolean;
}) {
  const [filter, setFilter] = useRouteField<Filter>('outcomeFilter', 'all');
  const heading = useRef<HTMLHeadingElement>(null);
  const origin = fromAttention ? 'attention-outcomes' : 'appointment-outcomes';
  const detailLink = (visit: Visit) => '/appointments/' + visit.id + '?from=' + origin;
  const patients = new Map(records.patients.map(patient => [patient.id, patient]));

  const groups = {
    today: { label: t('Today'), visits: visits.filter(visit => visit.date === today) },
    earlier: { label: t('Earlier days'), visits: visits.filter(visit => visit.date < today) },
  };
  const counts = { all: visits.length, today: groups.today.visits.length, earlier: groups.earlier.visits.length };
  const labels = { all: t('All'), today: t('Today'), earlier: t('Earlier') };
  const emptyLabels = { all: t('No visits to update.'), today: t('No outcomes pending today.'), earlier: t('No outcomes pending from earlier days.') };
  const visibleGroups = filter === 'all' ? ['today', 'earlier'] as const : [filter];

  return <div className="outcome-queue">
    <header className="outcome-queue-header">
      <a className="back" href={path(fromAttention ? '/attention' : '/today')}><ArrowLeft size={16} aria-hidden />
        {t(fromAttention ? 'Needs attention' : 'Today')}</a>
      <h1 ref={heading} tabIndex={-1}>{t('Awaiting appointment outcomes')}</h1>
      <p>{t('Appointments that have ended and still need an outcome.')}</p>
    </header>
    <div className="outcome-filters" role="group" aria-label={t('Filter appointments by date')}>
      {filters.map(item => <button type="button" key={item} aria-pressed={filter === item} onClick={() => setFilter(item)}>
        {labels[item]} <span>{counts[item]}</span>
      </button>)}
    </div>
    {counts[filter] === 0 && <div className="panel outcome-queue-empty">
      <CheckCircle size={28} weight="duotone" aria-hidden />
      <strong>{visits.length ? emptyLabels[filter] : emptyLabels.all}</strong>
      {visits.length > 0 && <button type="button" className="text-button" onClick={() => {
        setFilter('all');
        heading.current?.focus({ preventScroll: true });
      }}>{t('Show all appointments')}<ArrowRight size={16} aria-hidden /></button>}
    </div>}
    {visibleGroups.map(group => {
      const entries = groups[group].visits;
      if (!entries.length) return null;
      return <section className="outcome-group" key={group} aria-labelledby={`outcomes-${group}`}>
        <h2 id={`outcomes-${group}`}>{groups[group].label}</h2>
        <ul className="panel outcome-list">
          {entries.map(visit => <OutcomeQueueRow key={visit.id} visit={visit} patientName={patients.get(visit.patientId)?.name}
            showDate={group === 'earlier'} href={path(detailLink(visit))} />)}
        </ul>
      </section>;
    })}
  </div>;
}
