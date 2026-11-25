import { returnedLabPatients } from './lab-returns';
import { upsert, type Patient, type Records, type Task } from './model';
import { planningCandidates } from './workflows';

export type BookingCallback = { patient: Patient; returns: { id: string; endedOn: string; title: string }[] };

export function bookingCallbacksDue(records: Records, today: string, now: Date): BookingCallback[] {
  const tasks = new Map(records.tasks.filter(task => task.bookingCallback).map(task => [task.patientId, task]));
  const returned = new Map(returnedLabPatients(records, today, now).ready.map(({ patient, jobs }) => [patient.id, jobs]));
  return planningCandidates(records, today).flatMap(({ patient }) => {
    const task = tasks.get(patient.id);
    const returns = (returned.get(patient.id) ?? []).filter(job => task?.bookingCallback?.dismissedReturns[job.id] !== job.endedOn);
    return returns.length || (task && !task.completedOn) ? [{ patient, returns }] : [];
  });
}

function callbackTask(records: Records, patientId: string, id: string, title: string): Task {
  return records.tasks.find(item => item.patientId === patientId && item.bookingCallback) ?? {
    id, patientId, title, notes: '', blocks: false, completedOn: null, bookingCallback: { dismissedReturns: {} },
  };
}

export function requestBookingCallback(records: Records, patientId: string, id: string, title: string): Records {
  const task = callbackTask(records, patientId, id, title);
  return { ...records, tasks: upsert(records.tasks, { ...task, completedOn: null,
    bookingCallback: { dismissedReturns: task.bookingCallback?.dismissedReturns ?? {} } }) };
}

export function dismissBookingCallback(records: Records, callback: BookingCallback, today: string, id: string, title: string): Records {
  const task = callbackTask(records, callback.patient.id, id, title);
  const dismissedReturns = { ...task.bookingCallback?.dismissedReturns };
  for (const { id, endedOn } of callback.returns) dismissedReturns[id] = endedOn;
  return { ...records, tasks: upsert(records.tasks, { ...task, completedOn: today, bookingCallback: { dismissedReturns } }) };
}

export function updateCallbacksForBookings(previous: Records, next: Records, today: string): Records {
  if (previous.appointments === next.appointments || !next.tasks.some(task => task.bookingCallback)) return next;
  const before = new Map(previous.appointments.map(visit => [visit.id, visit.status]));
  const after = new Map(next.appointments.map(visit => [visit.id, visit.status]));
  const booked = new Map(next.appointments.flatMap(visit => visit.kind === 'Visit' && visit.status === 'Scheduled'
    && visit.date >= today && before.get(visit.id) !== 'Scheduled' ? [[visit.patientId, visit.id] as const] : []));
  let changed = false;
  const tasks = next.tasks.map(task => {
    if (!task.bookingCallback || !task.patientId) return task;
    const { dismissedReturns, bookedVisit } = task.bookingCallback;
    const newlyBooked = booked.get(task.patientId);
    if (!task.completedOn && newlyBooked) {
      changed = true;
      return { ...task, completedOn: today, bookingCallback: { dismissedReturns, bookedVisit: newlyBooked } };
    }
    if (bookedVisit && before.get(bookedVisit) === 'Scheduled' && after.get(bookedVisit) === 'Postponed') {
      changed = true;
      return { ...task, completedOn: null, bookingCallback: { dismissedReturns } };
    }
    return task;
  });
  return changed ? { ...next, tasks } : next;
}
