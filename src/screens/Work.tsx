import { getLocale, t } from '../i18n';
import { Gear, Plus } from '@phosphor-icons/react';
import { useRouteField } from '../navigation';
import { ButtonLink, Field, Options, PageHeader, path, Section } from '../components/ui';
import { FollowUpList } from '../components/FollowUpList';
import { PatientSearch } from '../components/WorkFormControls';
import { waitStatuses, type RecordChange, type Records } from '../domain/model';
import { TaskList } from './Tasks';
import { LabCheckShortcut } from './DailyLabCheck';

type Save = (change: RecordChange) => Promise<void>;

const views = [
  { value: null, label: 'All' },
  { value: 'tasks', label: 'Tasks' },
  { value: 'responses', label: 'Follow-ups' },
] as const;

export function Work({ records, today, save, native, view }: {
  records: Records; today: string; save: Save; native: boolean; view: string | null;
}) {
  const [status, setStatus] = useRouteField('status', 'Waiting');
  const selected = views.find(item => item.value === view)?.value ?? null;
  const waits = records.waits.filter(wait => status === 'All' || status === wait.status)
    .sort((a, b) => (a.reviewOn ?? '9999').localeCompare(b.reviewOn ?? '9999') || a.title.localeCompare(b.title, getLocale()));
  return <>
    <PageHeader title={t('Work')} action={<a className="icon-button" href={path('/data')} aria-label={t(native ? 'Settings' : 'Preview data')}>
      <Gear size={23} aria-hidden />
    </a>} />
    <nav className="work-views" aria-label={t('Work views')}>
      {views.map(item => <a key={item.label} className="button secondary"
        aria-current={selected === item.value ? 'page' : undefined}
        href={path(item.value ? '/work?view=' + item.value : '/work')}>{t(item.label)}</a>)}
    </nav>
    <div className={selected ? undefined : 'work-columns'}>
      {selected !== 'responses' && <Section title={t('Tasks')} action={<ButtonLink icon={Plus} to={'/tasks/new?from=' + (selected ? 'tasks' : 'work')}>{t('Add task')}</ButtonLink>}>
        <TaskList tasks={records.tasks} patients={records.patients} today={today} save={save} from={selected ? 'tasks' : 'work'} history />
      </Section>}
      {selected !== 'tasks' && <Section title={t('Follow-ups')} action={<ButtonLink secondary icon={Plus}
        to={'/responses/new?from=' + (selected ? 'responses' : 'work')}>{t('Add follow-up')}</ButtonLink>}>
        {selected === 'responses' && <>
          <div className="lab-work-shortcut"><LabCheckShortcut records={records} today={today} fromWork /></div>
          <div className="response-filter">
            <Field label={t('Status')}><select value={status} onChange={event => setStatus(event.target.value)}>
              <Options values={[...waitStatuses, 'All']} />
            </select></Field>
          </div>
        </>}
        <FollowUpList waits={waits} patients={records.patients} today={today} save={save} from={selected ? 'responses' : 'work'} />
      </Section>}
    </div>
  </>;
}

export function ChooseResponsePatient({ records, from }: { records: Records; from: 'work' | 'responses' }) {
  return <div className="patient-picker-page">
    <PageHeader title={t('Choose a patient')} back={from === 'work' ? '/work' : '/work?view=responses'} />
    <PatientSearch patients={records.patients} to={patient => '/patients/' + patient.id + '/responses/new?from=' + from} />
  </div>;
}
