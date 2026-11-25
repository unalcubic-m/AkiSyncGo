import { describe, expect, it } from 'vitest';
import { calendarPublishingSnapshot } from '../src/domain/calendar-publishing';
import { emptyRecords, type Appointment, type Records } from '../src/domain/model';

const day = '2026-11-23';
const visit: Extract<Appointment, { kind: 'Visit' }> = {
  id: 'visit', kind: 'Visit', patientId: 'patient', title: 'Treatment title',
  date: day, start: '09:00', end: '09:45', status: 'Scheduled',
  procedure: 'Private procedure', notes: 'Private notes', exceptions: [],
};
const records: Records = {
  ...emptyRecords(),
  patients: [{
    id: 'patient', name: 'Fictional Patient', phone: '', email: '', status: 'Active',
    priority: 'Normal', priorityNote: '', createdOn: '2026-11-01', summary: '', nextAction: '',
  }],
};

describe('calendar publishing snapshot', () => {
  it('starts at midnight yesterday and includes far-future visits with the patient name and times', () => {
    const snapshot = calendarPublishingSnapshot({
      ...records,
      appointments: [
        { ...visit, id: 'older', date: '2026-11-21' },
        { ...visit, id: 'yesterday', date: '2026-11-22', start: '00:00', end: '00:45', status: 'Completed' },
        { ...visit, id: 'today' },
        { ...visit, id: 'future', date: '2036-05-02' },
        { ...visit, id: 'cancelled', status: 'Cancelled' },
        { ...visit, id: 'postponed', status: 'Postponed' },
        { ...visit, id: 'no-show', status: 'No-show' },
        { ...visit, id: 'block', kind: 'Block', status: 'Blocked time', patientId: null, procedure: '' },
      ],
    }, day);

    const cutoff = new Date('2026-11-22T00:00:00').getTime();
    expect(snapshot.cutoff).toBe(cutoff);
    expect(snapshot.zone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    expect(snapshot.visits).toEqual([
      { id: 'yesterday', title: 'Fictional Patient', start: cutoff, end: cutoff + 45 * 60_000 },
      { id: 'today', title: 'Fictional Patient', start: new Date('2026-11-23T09:00').getTime(), end: new Date('2026-11-23T09:45').getTime() },
      { id: 'future', title: 'Fictional Patient', start: new Date('2036-05-02T09:00').getTime(), end: new Date('2036-05-02T09:45').getTime() },
    ]);
  });

  it('uses the same rolling window and current patient name on subsequent publishing passes', () => {
    const saved = { ...records, appointments: [visit] };
    expect(calendarPublishingSnapshot(saved, '2026-11-24').visits).toHaveLength(1);
    expect(calendarPublishingSnapshot(saved, '2026-11-25').visits).toHaveLength(0);
    const renamed = { ...saved, patients: [{ ...saved.patients[0], name: 'Renamed Fictional Patient' }] };
    expect(calendarPublishingSnapshot(renamed, day).visits[0]).toMatchObject({ id: visit.id, title: 'Renamed Fictional Patient' });
  });
});
