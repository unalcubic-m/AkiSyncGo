import { Gear, Plus } from '@phosphor-icons/react';
import { FollowUpList } from '../../src/components/FollowUpList';
import { ButtonLink, Field, Options, PageHeader, path, Section } from '../../src/components/ui';
import { waitStatuses, type Records } from '../../src/domain/model';
import { getLocale, t } from '../../src/i18n';
import { useRouteField } from '../../src/navigation';
import { LabShortcut } from './Laboratory';
import { followUpsRoute, repository, type LabResult } from './state';

export function WorkFollowUps({ records, today, result }: { records: Records; today: string; result?: LabResult }) {
  const [status, setStatus] = useRouteField('status', 'Waiting');
  const waits = records.waits.filter(wait => status === 'All' || status === wait.status)
    .sort((a, b) => (a.reviewOn ?? '9999').localeCompare(b.reviewOn ?? '9999') || a.title.localeCompare(b.title, getLocale()));

  return <>
    <PageHeader title={t('Work')} action={<a className="icon-button" href={path('/data')} aria-label={t('Settings')}>
      <Gear size={23} aria-hidden />
    </a>} />
    <nav className="work-views" aria-label={t('Work views')}>
      <a className="button secondary" href={path('/work')}>{t('All')}</a>
      <a className="button secondary" href={path('/work?view=tasks')}>{t('Tasks')}</a>
      <a className="button secondary" href={path(followUpsRoute)} aria-current="page">{t('Follow-ups')}</a>
    </nav>
    <Section title={t('Follow-ups')} action={<ButtonLink secondary icon={Plus} to="/responses/new?from=responses">{t('Add follow-up')}</ButtonLink>}>
      <div className="lab-work-shortcut"><LabShortcut result={result} /></div>
      <div className="response-filter">
        <Field label={t('Status')}><select value={status} onChange={event => setStatus(event.target.value)}>
          <Options values={[...waitStatuses, 'All']} />
        </select></Field>
      </div>
      <FollowUpList waits={waits} patients={records.patients} today={today} from="responses" save={async change => { await repository.update(change); }} />
    </Section>
  </>;
}
