import { pendingLabs } from './daily-lab';
import { addDays } from './dates';
import type { Patient, Records, Visit, Wait } from './model';
import { bookingBlockers, outstandingVisits, planningCandidates, slotOrder, upcomingVisits } from './workflows';

export const labReturnsView = 'lab-returns';
export const labReturnsRoute = '/planning?view=' + labReturnsView;

type ReturnedJob = Wait & { endedOn: string };
type Hold = ReturnType<typeof bookingBlockers>[number];
type LabReturnPatient = { patient: Patient; jobs: ReturnedJob[] };
type BookedReturn = LabReturnPatient & { visit: Visit; outcomePending: boolean };
type BlockedReturn = LabReturnPatient & { holds: Hold[] };
export type LabReturnRow = LabReturnPatient | BookedReturn | BlockedReturn;

function byPatient<T extends { patientId: string | null }>(items: T[]) {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    if (item.patientId === null) continue;
    const group = groups.get(item.patientId);
    if (group) group.push(item);
    else groups.set(item.patientId, [item]);
  }
  return groups;
}

export function returnedLabPatients(records: Records, today: string, now: Date) {
  const lastCompletedVisit = new Map<string, string>();
  for (const visit of records.appointments) {
    if (visit.kind !== 'Visit' || visit.status !== 'Completed' || visit.date > today) continue;
    if (visit.date > (lastCompletedVisit.get(visit.patientId) ?? '')) lastCompletedVisit.set(visit.patientId, visit.date);
  }

  const returned = byPatient(records.waits.filter((wait): wait is ReturnedJob =>
    wait.type === 'Laboratory return' && wait.status === 'Resolved' && !!wait.endedOn
    && wait.endedOn <= today && wait.endedOn > (lastCompletedVisit.get(wait.patientId) ?? '')));
  const upcoming = byPatient(upcomingVisits(records, today, now));
  const outstanding = byPatient(outstandingVisits(records, now));
  const holds = byPatient(bookingBlockers(records));
  const readyRank = new Map(planningCandidates(records, today).map(({ patient }, index) => [patient.id, index]));

  const ready: LabReturnPatient[] = [];
  const blocked: BlockedReturn[] = [];
  const booked: BookedReturn[] = [];
  for (const patient of records.patients) {
    const jobs = returned.get(patient.id);
    if (!jobs?.length) continue;
    jobs.sort((a, b) => b.endedOn.localeCompare(a.endedOn));

    const next = upcoming.get(patient.id)?.[0];
    const lastUnclosed = outstanding.get(patient.id)?.at(-1);
    const pending = lastUnclosed && lastUnclosed.date >= jobs[jobs.length - 1].endedOn ? lastUnclosed : undefined;
    const visit = next ?? pending;
    if (visit) booked.push({ patient, jobs, visit, outcomePending: !next });
    else if (readyRank.has(patient.id)) ready.push({ patient, jobs });
    else blocked.push({ patient, jobs, holds: holds.get(patient.id) ?? [] });
  }

  ready.sort((a, b) => readyRank.get(a.patient.id)! - readyRank.get(b.patient.id)!);
  booked.sort((a, b) => slotOrder(a.visit, b.visit));
  return { ready, blocked, booked };
}

export function labAppointmentsAtRisk(records: Records, today: string) {
  const tomorrow = addDays(today, 1);
  const pending = byPatient(pendingLabs(records).filter(wait => wait.blocks));
  const patients = new Map(records.patients.map(patient => [patient.id, patient]));
  return records.appointments.flatMap(visit => {
    if (visit.kind !== 'Visit' || visit.status !== 'Scheduled' || (visit.date !== today && visit.date !== tomorrow)) return [];
    const patient = patients.get(visit.patientId);
    const jobs = pending.get(visit.patientId);
    return patient && jobs ? [{ visit, patient, jobs }] : [];
  }).sort((a, b) => slotOrder(a.visit, b.visit));
}
