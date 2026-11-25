import { z } from 'zod';

export const labReminderSchema = z.object({
  enabled: z.boolean(),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  days: z.array(z.number().int().min(0).max(6)).min(1).max(7).refine(days => new Set(days).size === days.length),
});

export const labCheckSchema = z.object({ date: z.iso.date(), result: z.enum(['finished', 'nothing', 'dismissed']) });
export type LabResult = z.infer<typeof labCheckSchema>['result'];
export const defaultLabReminder: z.infer<typeof labReminderSchema> = { enabled: true, time: '10:00', days: [0, 1, 2, 3, 4, 5, 6] };
