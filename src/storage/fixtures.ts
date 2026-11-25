import { addDays, localDate } from '../domain/dates';
import { emptyRecords, uppercasePatientName, type Appointment, type Patient, type Records } from '../domain/model';

export function fictionalRecords(now = new Date()): Records {
  const today = localDate(now);
  const earlier = (days: number) => addDays(today, -days);
  const makePatient = (id: string, name: string, fields: Partial<Patient> = {}): Patient => ({
    id, name: uppercasePatientName(name), phone: '', email: '', status: 'Active', priority: 'Normal', priorityNote: '',
    createdOn: earlier(60), summary: '', nextAction: '', ...fields,
  });
  const patients = [
    makePatient('demo-mira', 'Mira Arden', { phone: '+1 202-555-0101', priority: 'Urgent',
      summary: 'Check comfort and fit at the next review.', nextAction: 'Review the temporary restoration.' }),
    makePatient('demo-eli', 'Eli Demir', { phone: '+1 202-555-0102', createdOn: earlier(30) }),
    makePatient('demo-nora', 'Nora Vale', { phone: '+1 202-555-0103', priority: 'Normal' }),
    makePatient('demo-ada', 'Ada Kestrel', { phone: '+1 202-555-0104', priority: 'Extra urgent' }),
    makePatient('demo-jonah', 'Jonah Lake', { phone: '+1 202-555-0105', createdOn: earlier(42) }),
    makePatient('demo-lena', 'Lena Finch', { phone: '+1 202-555-0106', status: 'Passive' }),
  ];
  const visit = (id: string, patientId: string, date: string, start: string, end: string, title: string, details: Partial<Appointment> = {}): Appointment => ({
    id, patientId, date, start, end, title, kind: 'Visit', procedure: '', notes: '', status: 'Scheduled', exceptions: [], ...details,
  } as Appointment);

  return {
    ...emptyRecords(), patients,
    appointments: [
      visit('demo-1', 'demo-mira', today, '09:00', '09:45', 'Restoration review', { notes: 'Have the previous shade record on hand.' }),
      visit('demo-2', 'demo-eli', today, '10:30', '11:00', 'Routine examination'),
      { id: 'demo-block', date: today, start: '12:00', end: '13:00', title: 'Lunch break', kind: 'Block', patientId: null,
        procedure: '', notes: '', status: 'Blocked time', exceptions: [] },
      visit('demo-3', 'demo-nora', today, '14:00', '14:45', 'Hygiene visit'),
      visit('demo-4', 'demo-eli', addDays(today, 2), '11:30', '12:00', 'Progress check'),
      visit('demo-5', 'demo-nora', addDays(today, 4), '09:30', '10:15', 'Restoration review'),
    ],
    treatments: [
      { id: 'demo-restoration', patientId: 'demo-mira', title: 'Temporary restoration', startedOn: earlier(14),
        status: 'Active', closedOn: null, closureNote: '' },
    ],
    notes: [
      { id: 'demo-note', patientId: 'demo-mira', appointmentId: null, type: 'Clinical visit', date: earlier(14), title: 'Initial review',
        body: 'Reviewed comfort and recorded shade. Arrange a follow-up to check the fit.', nextPlan: 'Check contact points and bite.' },
    ],
    alerts: [
      { id: 'demo-allergy', patientId: 'demo-mira', type: 'Allergy', severity: 'Critical', label: 'Latex allergy',
        notes: 'Use latex-free supplies.', active: true },
    ],
    waits: [
      { id: 'demo-wait', patientId: 'demo-jonah', title: 'Confirm availability', type: 'Patient reply', status: 'Waiting',
        blocks: true, startedOn: earlier(5), reviewOn: today, endedOn: null, notes: 'Review when the patient replies.' },
    ],
  };
}
