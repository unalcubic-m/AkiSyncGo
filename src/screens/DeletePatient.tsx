import { t } from '../i18n';
import { navigate, PageHeader, RecordForm } from '../components/ui';
import type { Patient, RecordChange } from '../domain/model';
import { deletePatient } from '../domain/patient-management';

export default function DeletePatient({ patient, save }: { patient: Patient; save: (change: RecordChange) => Promise<void> }) {
  const back = '/patients/' + patient.id + '/edit';
  return <>
    <PageHeader title={t('Delete patient')} subtitle={patient.name} back={back} />
    <RecordForm submit={t('Permanently delete patient')} destructive cancel={back} onSave={async data => {
      if (!data.has('confirmation')) throw new Error('Confirm the deletion first.');
      await save(records => deletePatient(records, patient.id));
      navigate('/patients');
    }}>
      <p>{t('This permanently deletes {patient} and their appointments, encounter notes, treatments, alerts, tasks, and expected responses.', { patient: patient.name })}</p>
      <label className="check"><input type="checkbox" name="confirmation" required />{t('Delete this patient and their linked records')}</label>
    </RecordForm>
  </>;
}
