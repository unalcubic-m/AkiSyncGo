import { t } from '../i18n';
import { useState } from 'react';
import { ButtonLink, newId, RecordForm } from '../components/ui';
import type { RecordChange, Records } from '../domain/model';
import { addPatientsFromList, planPatientImport, readPatientList } from '../domain/patient-management';

export default function PatientImport({ records, today, chooseFile, save }: {
  records: Records;
  today: string;
  chooseFile: () => Promise<string | undefined>;
  save: (change: RecordChange) => Promise<void>;
}) {
  const [entries, setEntries] = useState<ReturnType<typeof readPatientList>>();
  const [result, setResult] = useState<{ added: number; skipped: number }>();
  const planned = entries && planPatientImport(records, entries);
  return <div className="setup-panel">
    <h2>{t('Import patient list')}</h2>
    {planned && entries ? <RecordForm submit={t('Import patients')} disabled={!planned.additions.length} onSave={async () => {
      let actual = planned;
      await save(current => {
        actual = planPatientImport(current, entries);
        return addPatientsFromList(current, entries, today, newId);
      });
      setResult({ added: actual.additions.length, skipped: actual.skipped });
      setEntries(undefined);
    }}>
      <p role="status">{t(planned.skipped === 1 ? '{active} Active · {passive} Passive · {skipped} existing match'
        : '{active} Active · {passive} Passive · {skipped} existing matches', { active: planned.active, passive: planned.passive, skipped: planned.skipped })}</p>
      <button type="button" className="button secondary" onClick={() => setEntries(undefined)}>{t('Cancel import')}</button>
    </RecordForm> : <RecordForm submit={t('Choose patient list')} onSave={async () => {
      const file = await chooseFile();
      if (file === undefined) return;
      const next = readPatientList(file);
      setResult(undefined);
      setEntries(next);
    }}>
      <p className="form-intro">{t('Choose an AkiSync JSON patient list. Matching names keep their existing records.')}</p>
    </RecordForm>}
    {result && <div className="setup-panel">
      <p className="save-status" role="status">{t(result.added === 1 ? 'Imported {count} patient.' : 'Imported {count} patients.', { count: result.added })}{' '}
        {t(result.skipped === 1 ? '{count} existing match skipped.' : '{count} existing matches skipped.', { count: result.skipped })}</p>
      <ButtonLink secondary to="/patients">{t('View patients')}</ButtonLink>
    </div>}
  </div>;
}
