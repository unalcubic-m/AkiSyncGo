import { addDays, localDate } from '../../src/domain/dates';
import type { Appointment, Records } from '../../src/domain/model';
import type { BookingDurations } from './BookingDurationsMock';

export const optimumDemoDurations: BookingDurations = { presets: [30, 60, 90, 180], defaultMinutes: 90 };

export function optimumDemoNow(now = new Date()) {
  const monday = new Date(now);
  monday.setDate(now.getDate() + ((8 - now.getDay()) % 7 || 7));
  monday.setHours(7, 30, 0, 0);
  return monday;
}

export function optimumDemoRecords(records: Records, now: Date): Records {
  const monday = localDate(now);
  const tuesday = addDays(monday, 1);
  const wednesday = addDays(monday, 2);
  const nextMonday = addDays(monday, 7);
  const nextTuesday = addDays(monday, 8);
  const patients = ['demo-mira', 'demo-eli', 'demo-nora', 'demo-ada', 'demo-jonah'];

  const visit = (date: string, start: string, end: string, patient: number): Appointment => ({
    id: `optimum-${date}-${start.replace(':', '')}`, date, start, end, kind: 'Visit', status: 'Scheduled',
    patientId: patients[patient], title: 'Kontrol muayenesi', procedure: '', notes: '', exceptions: [],
  });
  const lunch = (date: string): Appointment => ({
    id: `optimum-lunch-${date}`, date, start: '12:00', end: '13:00', kind: 'Block', status: 'Blocked time',
    patientId: null, title: 'Öğle arası', procedure: '', notes: '', exceptions: [],
  });

  return {
    ...records,
    workingHours: [1, 2, 3].map(day => ({ day, start: '09:00', end: '17:00' })),
    hoursOverrides: [
      { date: nextMonday, windows: [{ start: '09:00', end: '11:00' }, { start: '13:00', end: '15:00' }] },
      { date: nextTuesday, windows: [{ start: '09:00', end: '12:05' }] },
    ],
    appointments: [
      ...records.appointments.filter(item => item.date < monday),
      lunch(monday),
      visit(monday, '14:00', '15:30', 0),
      visit(monday, '16:00', '17:00', 1),
      visit(tuesday, '09:45', '10:30', 2),
      visit(tuesday, '11:15', '12:00', 3),
      lunch(tuesday),
      visit(tuesday, '13:45', '14:45', 4),
      visit(tuesday, '16:00', '17:00', 0),
      visit(wednesday, '10:30', '12:00', 1),
      lunch(wednesday),
      visit(wednesday, '13:00', '13:30', 2),
      visit(wednesday, '14:30', '15:35', 3),
    ],
  };
}
