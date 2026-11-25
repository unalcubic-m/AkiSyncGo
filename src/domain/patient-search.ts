import { getLocale, t } from '../i18n';
import { parseDate } from './dates';
import type { Patient, Records } from './model';
import { normalizePatientSearch, searchPatients } from './workflows';

export type PatientSearchKind = 'patient' | 'note' | 'appointment' | 'treatment' | 'follow-up' | 'task' | 'alert';
export type SearchFragment = { text: string; highlighted: boolean };

export type PatientSearchHit = {
  kind: PatientSearchKind;
  id: string;
  title: string;
  titleParts: SearchFragment[];
  date?: string;
  excerpt: SearchFragment[];
};

export type PatientSearchGroup = {
  patient: Patient;
  patientMatch: boolean;
  patientNameParts?: SearchFragment[];
  contactMatch?: SearchFragment[];
  hits: PatientSearchHit[];
};

type TextField = { text: string; normalized: string };
type IndexedHit = Pick<PatientSearchHit, 'kind' | 'id' | 'date'> & { title: TextField; fields: TextField[] };
type TextRange = { start: number; end: number };

const indexes = new WeakMap<Records, { locale: ReturnType<typeof getLocale>; byPatient: Map<string, IndexedHit[]> }>();
const excerptLength = 120;
const beforeMatch = 32;
const digitsOnly = (text: string) => text.replace(/\D/g, '');

function textField(value: string): TextField {
  const text = value.trim().replace(/\s+/g, ' ');
  return { text, normalized: normalizePatientSearch(text) };
}

function searchIndex(records: Records) {
  const locale = getLocale();
  const cached = indexes.get(records);
  if (cached?.locale === locale) return cached.byPatient;

  const byPatient = new Map<string, IndexedHit[]>();
  const dateFormatter = new Intl.DateTimeFormat(locale, { dateStyle: 'long' });
  const dates = new Map<string, string>();

  function dateFields(values: (string | null | undefined)[]) {
    return [...new Set(values.filter((date): date is string => !!date))].flatMap(date => {
      let formatted = dates.get(date);
      if (formatted === undefined) {
        formatted = dateFormatter.format(parseDate(date));
        dates.set(date, formatted);
      }
      return [date, formatted];
    });
  }

  function add(patientId: string, kind: PatientSearchKind, id: string, title: string, fields: string[], date?: string) {
    const entries = byPatient.get(patientId) ?? [];
    entries.push({ kind, id, date, title: textField(title), fields: fields.map(textField).filter(field => field.text) });
    byPatient.set(patientId, entries);
  }

  for (const patient of records.patients) {
    const memory = [patient.summary, patient.nextAction, patient.priorityNote].filter(Boolean);
    if (memory.length) add(patient.id, 'patient', patient.id, t('Patient memory'), memory);
  }
  for (const note of records.notes) {
    add(note.patientId, 'note', note.id, note.title || t('Encounter note'),
      [note.body, note.nextPlan, t(note.type), ...dateFields([note.date])], note.date);
  }
  for (const visit of records.appointments) {
    if (visit.kind !== 'Visit') continue;
    add(visit.patientId, 'appointment', visit.id, visit.title,
      [visit.notes, visit.procedure, ...visit.exceptions.map(exception => exception.reason), t(visit.status),
        ...dateFields([visit.date]), `${visit.start}–${visit.end}`], visit.date);
  }
  for (const treatment of records.treatments) {
    add(treatment.patientId, 'treatment', treatment.id, treatment.title,
      [treatment.closureNote, t(treatment.status), ...dateFields([treatment.startedOn, treatment.closedOn])],
      treatment.closedOn ?? treatment.startedOn);
  }
  for (const wait of records.waits) {
    add(wait.patientId, 'follow-up', wait.id, wait.title,
      [wait.notes, t(wait.type), t(wait.status), ...dateFields([wait.startedOn, wait.reviewOn, wait.endedOn])],
      wait.endedOn ?? wait.reviewOn ?? wait.startedOn);
  }
  for (const task of records.tasks) {
    if (task.bookingCallback) continue;
    if (task.patientId === null) continue;
    add(task.patientId, 'task', task.id, task.title, [task.notes, ...dateFields([task.completedOn, task.dueOn])],
      task.completedOn ?? task.dueOn ?? undefined);
  }
  for (const alert of records.alerts) {
    add(alert.patientId, 'alert', alert.id, alert.label, [alert.notes, t(alert.type), t(alert.severity)]);
  }

  indexes.set(records, { locale, byPatient });
  return byPatient;
}

function toSourceRanges(text: string, ranges: TextRange[], normalize: (text: string) => string) {
  if (!ranges.length) return [];
  const preservesAscii = normalize === normalizePatientSearch;
  if (preservesAscii && !/[^\x00-\x7f]/.test(text)) return ranges;
  const ordered = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end);
  const source: TextRange[] = [];
  let offset = 0;
  let index = 0;
  let first: number | undefined;

  // Map folded text back to whole source characters, including accents and case expansions.
  for (const match of text.matchAll(/\P{M}\p{M}*|\p{M}+/gu)) {
    const character = match[0];
    const length = preservesAscii && character.length === 1 && character.charCodeAt(0) < 128 ? 1 : normalize(character).length;
    if (!length) continue;
    const end = offset + length;
    while (index < ordered.length && ordered[index].start < end) {
      first ??= match.index;
      if (ordered[index].end > end) break;
      source.push({ start: first, end: match.index + character.length });
      first = undefined;
      index++;
    }
    if (index === ordered.length) break;
    offset = end;
  }
  return source;
}

function mergeRanges(ranges: TextRange[]) {
  const merged: TextRange[] = [];
  for (const range of ranges.sort((a, b) => a.start - b.start || a.end - b.end)) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}

function highlightedParts(text: string, terms: string[], normalize = normalizePatientSearch): SearchFragment[] {
  if (!text) return [];
  const normalized = normalize(text);
  const ranges: TextRange[] = [];
  for (const term of terms) {
    if (!term) continue;
    for (let start = normalized.indexOf(term); start >= 0; start = normalized.indexOf(term, start + term.length)) {
      ranges.push({ start, end: start + term.length });
    }
  }

  const parts: SearchFragment[] = [];
  let offset = 0;
  for (const { start, end } of mergeRanges(toSourceRanges(text, mergeRanges(ranges), normalize))) {
    if (start > offset) parts.push({ text: text.slice(offset, start), highlighted: false });
    parts.push({ text: text.slice(start, end), highlighted: true });
    offset = end;
  }
  if (offset < text.length) parts.push({ text: text.slice(offset), highlighted: false });
  return parts;
}

function excerpt(field: TextField, terms: string[]) {
  const matches = terms.flatMap(term => {
    const start = field.normalized.indexOf(term);
    return start >= 0 ? [{ start, end: start + term.length }] : [];
  }).sort((a, b) => a.start - b.start || b.end - a.end);
  const focus = toSourceRanges(field.text, matches.slice(0, 1), normalizePatientSearch)[0];
  let start = Math.max(0, (focus?.start ?? 0) - beforeMatch);
  let end = Math.min(field.text.length, start + excerptLength);
  const nextSpace = field.text.indexOf(' ', start);
  if (start && nextSpace >= start && focus && nextSpace < focus.start) start = nextSpace + 1;
  const lastSpace = field.text.lastIndexOf(' ', end);
  if (end < field.text.length && lastSpace > Math.max(end - 20, focus?.end ?? start)) end = lastSpace;
  if (start > 0 && /[\uDC00-\uDFFF]/u.test(field.text[start])) start--;
  if (end < field.text.length && /[\uD800-\uDBFF]/u.test(field.text[end - 1])) end--;
  const snippet = field.text.slice(start, end).trim();
  const parts = highlightedParts(snippet, terms);
  if (start) parts.unshift({ text: '…', highlighted: false });
  if (end < field.text.length) parts.push({ text: '…', highlighted: false });
  return parts;
}

function countTerms(value: string, terms: string[]) {
  return terms.reduce((total, term) => total + Number(value.includes(term)), 0);
}

function matchingFields(hit: IndexedHit, terms: string[]) {
  let bestField: TextField | undefined;
  let bestCount = 0;
  for (const field of hit.fields) {
    const count = countTerms(field.normalized, terms);
    if (count > bestCount) {
      bestCount = count;
      bestField = field;
    }
  }
  return bestField;
}

function matchingContact(patient: Patient, terms: string[]) {
  const digitTerms = terms.map(digitsOnly).filter(Boolean);
  const phoneMatches = countTerms(digitsOnly(patient.phone), digitTerms);
  const emailMatches = countTerms(normalizePatientSearch(patient.email), terms);
  if (phoneMatches && phoneMatches >= emailMatches) return highlightedParts(patient.phone, digitTerms, digitsOnly);
  if (emailMatches) return highlightedParts(patient.email, terms);
}

export function searchPatientHistory(records: Records, query: string, status = 'All', priority = 'All'): PatientSearchGroup[] {
  const terms = [...new Set(normalizePatientSearch(query).trim().split(/\s+/).filter(Boolean))];
  if (!terms.length) return [];

  const directMatches = new Set(searchPatients(records, query, status, priority).map(patient => patient.id));
  const visiblePatients = searchPatients(records, '', status, priority);
  if (!visiblePatients.length) return [];
  const patientTerms = new Map(terms.map(term => [term, new Set(searchPatients(records, term, status, priority).map(patient => patient.id))]));
  const index = searchIndex(records);

  const groups: PatientSearchGroup[] = [];
  for (const patient of visiblePatients) {
    const patientMatch = directMatches.has(patient.id);
    const requiredTerms = terms.filter(term => !patientTerms.get(term)?.has(patient.id));
    const hits: PatientSearchHit[] = [];
    for (const record of index.get(patient.id) ?? []) {
      const matchesRecord = (term: string) => record.title.normalized.includes(term)
        || record.fields.some(field => field.normalized.includes(term));
      if (requiredTerms.length ? !requiredTerms.every(matchesRecord) : !terms.some(matchesRecord)) continue;
      const field = matchingFields(record, requiredTerms.length ? requiredTerms : terms);
      hits.push({
        kind: record.kind,
        id: record.id,
        date: record.date,
        title: record.title.text,
        titleParts: highlightedParts(record.title.text, terms),
        excerpt: field ? excerpt(field, terms) : [],
      });
    }

    if (patientMatch || hits.length) {
      const patientNameParts = countTerms(normalizePatientSearch(patient.name), terms) ? highlightedParts(patient.name, terms) : undefined;
      hits.sort((left, right) => (right.date ?? '').localeCompare(left.date ?? ''));
      groups.push({ patient, patientMatch, patientNameParts, contactMatch: matchingContact(patient, terms), hits });
    }
  }
  return groups.sort((left, right) => Number(right.patientMatch) - Number(left.patientMatch));
}
