import type { Records } from './model';
import { readyToBookPatients } from './workflows';

function readyIds(records: Records, today: string) {
  return new Set(readyToBookPatients(records, today).map(patient => patient.id));
}

export function trackLabClearance(previous: Records, next: Records, today: string): Records {
  if (previous.patients === next.patients && previous.waits === next.waits
    && previous.tasks === next.tasks && previous.appointments === next.appointments) return next;

  const readyBefore = readyIds(previous, today);
  const readyAfter = readyIds(next, today);
  const nextWaits = new Map(next.waits.map(wait => [wait.id, wait]));
  const completedLabs = previous.waits.filter(wait => {
    if (wait.type !== 'Laboratory return' || !wait.blocks || wait.status !== 'Waiting') return false;
    const saved = nextWaits.get(wait.id);
    return saved?.type === wait.type && saved.patientId === wait.patientId && saved.status === 'Resolved';
  });

  // A completion qualifies if resolving the lab blockers alone would have made the patient ready.
  const completeIds = new Set(completedLabs.map(wait => wait.id));
  const readyAfterLabs = completeIds.size ? readyIds({
    ...previous, waits: previous.waits.filter(wait => !completeIds.has(wait.id)),
  }, today) : undefined;
  const patientIds = new Set(next.patients.map(patient => patient.id));
  const tracked = new Map(Object.entries(next.labPlanning ?? {}).filter(([id]) => patientIds.has(id)));

  // False records a known change in readiness, so older blocker dates are not reused for that patient.
  for (const patientId of readyBefore) {
    if (patientIds.has(patientId) && !readyAfter.has(patientId)) tracked.set(patientId, false);
  }
  for (const patientId of readyAfter) {
    if (!readyBefore.has(patientId)) tracked.set(patientId, readyAfterLabs?.has(patientId) ?? false);
  }
  for (const { patientId } of completedLabs) {
    if (!readyAfter.has(patientId)) tracked.set(patientId, false);
  }

  if (!tracked.size && !next.labPlanning) return next;
  return { ...next, labPlanning: tracked.size ? Object.fromEntries(tracked) : undefined };
}

export function labClearedPatientIds(records: Records, today: string): Set<string> {
  const latestLab = new Map<string, string>();
  const latestOther = new Map<string, string>();
  const uncertain = new Set<string>();

  function recordRelease(patientId: string, date: string | null, releases: Map<string, string>) {
    if (!date || date > today) uncertain.add(patientId);
    else if (date > (releases.get(patientId) ?? '')) releases.set(patientId, date);
  }

  for (const wait of records.waits) {
    if (!wait.blocks || wait.status === 'Waiting') continue;
    const completedLab = wait.type === 'Laboratory return' && wait.status === 'Resolved';
    recordRelease(wait.patientId, wait.endedOn, completedLab ? latestLab : latestOther);
  }
  for (const task of records.tasks) {
    if (task.blocks && task.patientId !== null && task.completedOn) recordRelease(task.patientId, task.completedOn, latestOther);
  }

  const matches = new Set<string>();
  for (const { id } of readyToBookPatients(records, today)) {
    if (records.labPlanning && Object.hasOwn(records.labPlanning, id)) {
      if (records.labPlanning[id]) matches.add(id);
      continue;
    }
    const lab = latestLab.get(id);
    if (lab && !uncertain.has(id) && lab > (latestOther.get(id) ?? '')) matches.add(id);
  }
  return matches;
}
