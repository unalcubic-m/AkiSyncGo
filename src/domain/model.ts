import { z } from 'zod';
import { errorMessage, getLocale, LocalizedError } from '../i18n';
import { availabilitySettingsSchema } from './availability-settings';
import { eventBufferSchema } from './calendar-event-buffer';
import { labCheckSchema, labReminderSchema } from './notification-settings';

export const priorities = ['Normal', 'Urgent', 'Extra urgent'] as const;
export const patientStatuses = ['Active', 'Passive'] as const;
export const visitStatuses = ['Scheduled', 'Completed', 'Cancelled', 'No-show', 'Postponed'] as const;
export const contactTypes = ['Clinical visit', 'Phone call', 'Message', 'Other'] as const;
export const alertTypes = ['Allergy', 'Medication', 'Cardiac', 'Systemic', 'Infectious', 'Other'] as const;
export const severities = ['Info', 'Caution', 'Critical'] as const;
export const waitTypes = ['Patient reply', 'Consultation', 'Healing', 'Laboratory return', 'Other'] as const;
export const waitStatuses = ['Waiting', 'Resolved', 'Cancelled'] as const;
export const appointmentDifficulties = ['Easy', 'Medium', 'Hard'] as const;
export type AppointmentDifficulty = typeof appointmentDifficulties[number];
export const defaultAppointmentDurations = { Easy: 60, Medium: 90, Hard: 180 };
export const maxAppointmentDuration = 24 * 60 - 1;

export function uppercasePatientName(name: string): string {
  // Use Turkish casing for stored names regardless of the selected interface language.
  return name.normalize('NFC').replace(/i\u0307/g, 'i').toLocaleUpperCase('tr-TR').normalize('NFC');
}

const id = z.string().min(1);
const title = z.string().trim().min(1).max(255);
// Uppercasing can expand characters such as ß and ligatures. Keep expanded names readable.
const patientName = z.string().trim().min(1).transform(uppercasePatientName).pipe(z.string().max(3 * 255));
const shortText = z.string().trim().max(255);
const text = z.string().trim().max(20_000);
const date = z.iso.date();
const time = z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/);
export const slotSchema = z.object({ date, start: time, end: time });
const patient = z.object({
  id, name: patientName, phone: shortText, email: shortText, status: z.enum(patientStatuses),
  priority: z.enum(priorities), priorityNote: text, createdOn: date, summary: text, nextAction: text,
});
const treatment = z.object({
  id, patientId: id, title, startedOn: date,
}).and(z.discriminatedUnion('status', [
  z.object({ status: z.literal('Active'), closedOn: z.null(), closureNote: z.literal('') }),
  z.object({ status: z.literal('Closed'), closedOn: date, closureNote: text }),
]));
const exception = z.object({
  kind: z.enum(['Working hours / time off', 'Blocking waits', 'Blocking tasks', 'Overlapping appointments', 'Scheduling overlaps']),
  recordedAt: z.iso.datetime(), reason: title, conditions: z.array(z.string().trim().min(1)).min(1),
});
const item = slotSchema.extend({
  id, title, notes: text, exceptions: z.array(exception),
  ignoredCalendarEventIds: z.array(id).optional(), ignoredScheduleOverlapKeys: z.array(id).optional(),
});
const appointment = z.discriminatedUnion('kind', [
  item.extend({ kind: z.literal('Visit'), patientId: id, status: z.enum(visitStatuses), procedure: shortText }),
  item.extend({ kind: z.literal('Block'), patientId: z.null(), status: z.enum(['Blocked time', 'Cancelled']), procedure: z.literal('') }),
]);
const note = z.object({
  id, patientId: id, appointmentId: id.nullable(), date, type: z.enum(contactTypes),
  title: shortText, body: text.min(1), nextPlan: text,
});
const alert = z.object({
  id, patientId: id, type: z.enum(alertTypes), label: title, severity: z.enum(severities), notes: text, active: z.boolean(),
});
const wait = z.object({
  id, patientId: id, title, type: z.enum(waitTypes), status: z.enum(waitStatuses), startedOn: date,
  reviewOn: date.nullable(), endedOn: date.nullable(), blocks: z.boolean(), notes: text,
});
const task = z.object({
  id, patientId: id.nullable(), title, notes: text, completedOn: date.nullable(), blocks: z.boolean().default(false),
  bookingCallback: z.object({ dismissedReturns: z.record(id, date), bookedVisit: id.optional() }).optional(),
  // Preserve dates from existing records without assigning them to new tasks.
  dueOn: date.nullable().optional(),
});
const weekday = z.number().int().min(0).max(6);
const timeRange = z.object({ start: time, end: time });
const workingHours = timeRange.extend({ day: weekday });
const timeOff = z.object({ id, title, from: date, through: date, hours: timeRange.nullable() });
const hoursOverride = z.object({ date, windows: z.array(timeRange) });
const recurrenceEnd = z.discriminatedUnion('type', [
  z.object({ type: z.literal('never') }),
  z.object({ type: z.literal('date'), through: date }),
  z.object({ type: z.literal('count'), count: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }),
]);
const breakRule = z.object({
  id, title, from: date, hours: timeRange,
  repeat: z.object({ weekdays: z.array(weekday).min(1).max(7), end: recurrenceEnd }).nullable(),
  changes: z.array(z.object({ date, replacement: slotSchema.nullable() })),
});
const appointmentDuration = z.number().int().min(1).max(maxAppointmentDuration);
const appointmentDurations = z.object({ Easy: appointmentDuration, Medium: appointmentDuration, Hard: appointmentDuration });
const bookingDurations = z.object({ presets: z.array(appointmentDuration).min(1), defaultMinutes: appointmentDuration })
  .refine(({ presets, defaultMinutes }) => new Set(presets).size === presets.length && presets.includes(defaultMinutes),
    'Choose a default from the appointment duration presets.');

function windowsOverlap(windows: z.infer<typeof timeRange>[]) {
  const ordered = [...windows].sort((a, b) => a.start.localeCompare(b.start));
  return ordered.some((item, index) => index > 0 && ordered[index - 1].end > item.start);
}

export const recordsSchema = z.object({
  version: z.literal(1),
  patients: z.array(patient),
  treatments: z.array(treatment),
  appointments: z.array(appointment),
  notes: z.array(note),
  alerts: z.array(alert),
  waits: z.array(wait),
  tasks: z.array(task).default(() => []),
  workingHours: z.array(workingHours),
  timeOff: z.array(timeOff),
  availabilitySettings: availabilitySettingsSchema.optional(),
  calendarEventBuffer: eventBufferSchema.optional(),
  dailyLabReminder: labReminderSchema.optional(),
  dailyLabCheck: labCheckSchema.optional(),
  labPlanning: z.record(id, z.boolean()).optional(),
  appointmentDurations: appointmentDurations.default(() => ({ ...defaultAppointmentDurations })),
  bookingDurations: bookingDurations.optional(),
  hoursOverrides: z.array(hoursOverride).default(() => []),
  breaks: z.array(breakRule).default(() => []),
}).superRefine((records, context) => {
  const invalid = (message: string) => context.addIssue({ code: 'custom', message });
  const patients = new Set(records.patients.map(({ id }) => id));
  const appointments = new Map(records.appointments.map(item => [item.id, item]));
  for (const list of [records.patients, records.treatments, records.appointments, records.notes, records.alerts, records.waits, records.tasks, records.timeOff, records.breaks]) {
    if (new Set(list.map(row => row.id)).size !== list.length) invalid('A record ID is duplicated.');
  }
  for (const record of [...records.treatments, ...records.notes, ...records.alerts, ...records.waits, ...records.tasks, ...records.appointments]) {
    if (record.patientId !== null && !patients.has(record.patientId)) invalid('A record refers to a missing patient.');
  }
  for (const record of records.notes) {
    if (record.appointmentId && appointments.get(record.appointmentId)?.patientId !== record.patientId) {
      invalid('An encounter links to a visit for a different patient or to a missing visit.');
    }
  }
  for (const record of records.treatments) {
    if (record.closedOn && record.closedOn < record.startedOn) invalid('Closure must be on or after the treatment start.');
  }
  for (const record of records.waits) {
    if (record.reviewOn && record.reviewOn < record.startedOn) invalid('Review must be on or after the wait start.');
    if ((record.status === 'Waiting') !== (record.endedOn === null) || (record.endedOn && record.endedOn < record.startedOn)) {
      invalid('The wait has an invalid end date.');
    }
  }
  if (records.tasks.some(record => record.blocks && record.patientId === null)) {
    invalid('A task must be linked to a patient to block booking.');
  }
  if (records.tasks.some(record => record.bookingCallback && (record.blocks || record.patientId === null))) {
    invalid('Invalid booking callback.');
  }
  for (const record of records.timeOff) {
    if (record.from > record.through) invalid('Time off must end on or after its start date.');
  }
  const blocks = records.breaks.flatMap(rule => [rule.hours, ...rule.changes.flatMap(change => change.replacement ?? [])]);
  const overrides = records.hoursOverrides.flatMap(item => item.windows);
  for (const record of [...records.appointments, ...records.workingHours, ...records.timeOff.flatMap(item => item.hours ?? []), ...blocks, ...overrides]) {
    if (record.start >= record.end) invalid('End time must be after start time.');
  }
  if (new Set(records.hoursOverrides.map(item => item.date)).size !== records.hoursOverrides.length) invalid('A date has more than one working-hours override.');
  for (const rule of records.breaks) {
    if (!rule.repeat && rule.changes.length) invalid('Only repeating breaks can have individual changes.');
    if (rule.repeat) {
      const { weekdays, end } = rule.repeat;
      if (new Set(weekdays).size !== weekdays.length) invalid('A break weekday is duplicated.');
      if (end.type === 'date' && end.through < rule.from) invalid('A break series must end on or after its start date.');
      if (new Set(rule.changes.map(change => change.date)).size !== rule.changes.length) invalid('A break occurrence has more than one change.');
    }
  }
  const blocksByDate = records.appointments.filter(({ status }) => status === 'Blocked time')
    .sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
  if (blocksByDate.some((item, index) => index > 0 && item.date === blocksByDate[index - 1].date
    && item.start < blocksByDate[index - 1].end)) {
    invalid('Blocked time overlaps an occupied appointment.');
  }
  const weekdays = Array.from({ length: 7 }, (_, day) => records.workingHours.filter(window => window.day === day));
  if ([...weekdays, ...records.hoursOverrides.map(item => item.windows)].some(windowsOverlap)) invalid('Working hours overlap.');
});

export type Records = z.infer<typeof recordsSchema>;
export type Patient = z.infer<typeof patient>;
export type Treatment = z.infer<typeof treatment>;
export type Appointment = z.infer<typeof appointment>;
export type Visit = Extract<Appointment, { kind: 'Visit' }>;
export type Encounter = z.infer<typeof note>;
export type Alert = z.infer<typeof alert>;
export type Wait = z.infer<typeof wait>;
export type Task = z.infer<typeof task>;
export type TimeOff = z.infer<typeof timeOff>;
export type TimeRange = z.infer<typeof timeRange>;
export type HoursOverride = z.infer<typeof hoursOverride>;
export type BreakRule = z.infer<typeof breakRule>;
export type Slot = z.infer<typeof slotSchema>;
export type ExceptionKind = z.infer<typeof exception>['kind'];
export type RecordChange = (records: Records) => Records;

export function decodeRecords(value: unknown): Records {
  const result = recordsSchema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    const location = issue.path.join('.');
    const detail = location ? `${location}: ${issue.message}` : issue.message;
    throw new LocalizedError(detail, () => getLocale() === 'en' ? detail : errorMessage(issue, 'The records contain an invalid value.'));
  }
  return result.data;
}

export function emptyRecords(): Records {
  return {
    version: 1,
    patients: [], treatments: [], appointments: [], notes: [], alerts: [], waits: [], tasks: [], timeOff: [],
    appointmentDurations: { ...defaultAppointmentDurations }, hoursOverrides: [], breaks: [],
    workingHours: [1, 2, 3, 4, 5].map(day => ({ day, start: '09:00', end: '17:00' })),
  };
}

export function upsert<T extends { id: string }>(items: T[], next: T): T[] {
  return items.some(item => item.id === next.id)
    ? items.map(item => item.id === next.id ? next : item)
    : [...items, next];
}
