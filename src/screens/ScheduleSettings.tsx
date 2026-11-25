import { t } from '../i18n';
import { Plus } from '@phosphor-icons/react';
import { useState } from 'react';
import { Empty, Field, More, navigate, newId, RecordForm, Section, value } from '../components/ui';
import { breakOccursOn, breakPreviewDates, hoursForDate } from '../domain/availability';
import { formatDate, parseDate, titleDate } from '../domain/dates';
import type { BreakRule, RecordChange, Records, TimeRange } from '../domain/model';
import type { ScheduleConflict } from '../domain/schedule-conflicts';

type Save = (change: RecordChange) => Promise<void>;
export const weekdays = [
  { day: 1, label: 'Monday', short: 'Mon' },
  { day: 2, label: 'Tuesday', short: 'Tue' },
  { day: 3, label: 'Wednesday', short: 'Wed' },
  { day: 4, label: 'Thursday', short: 'Thu' },
  { day: 5, label: 'Friday', short: 'Fri' },
  { day: 6, label: 'Saturday', short: 'Sat' },
  { day: 0, label: 'Sunday', short: 'Sun' },
] as const;

export function WeekdayPicker({ selected, onChange }: { selected: number[]; onChange: (days: number[]) => void }) {
  return <fieldset className="hours-day"><legend>{t('Weekdays')}</legend>
    <div className="weekday-picker">{weekdays.map(({ day, label, short }) => <label key={day} className="check">
      <input type="checkbox" checked={selected.includes(day)} aria-label={t(label)}
        onChange={event => onChange(event.target.checked ? [...selected, day] : selected.filter(item => item !== day))} />
      {t(short)}
    </label>)}</div>
  </fieldset>;
}

export function HoursFields({ hours, onChange }: { hours: TimeRange; onChange: (hours: TimeRange) => void }) {
  return <>
    <Field label={t('From')}><input type="time" value={hours.start} onChange={event => onChange({ ...hours, start: event.target.value })} required /></Field>
    <Field label={t('Until')}><input type="time" value={hours.end} onChange={event => onChange({ ...hours, end: event.target.value })} required /></Field>
  </>;
}

export function DateHours({ records, today, initialDate, editDate, save }: {
  records: Records; today: string; initialDate?: string; editDate?: string; save: Save;
}) {
  const [adding, setAdding] = useState(false);
  const [date, setDate] = useState(editDate ?? initialDate ?? today);
  const [windows, setWindows] = useState<TimeRange[]>(() => hoursForDate(records, date));
  const original = records.hoursOverrides.find(item => item.date === date);
  const editing = adding || !!editDate;
  function close() {
    setAdding(false);
    if (editDate) navigate('/availability');
  }

  return <Section title={t('Hours for a specific date')} action={!editing && <button className="button secondary" type="button" onClick={() => {
    const next = initialDate ?? today;
    setDate(next);
    setWindows(hoursForDate(records, next));
    setAdding(true);
  }}>
    <Plus aria-hidden />{' '}{t('Override a date')}
  </button>}>
    {editing && <RecordForm submit={t('Save date hours')} cancel={editDate ? '/availability' : undefined} onSave={async () => {
      await save(current => ({ ...current, hoursOverrides: [...current.hoursOverrides.filter(item => item.date !== date), { date, windows }] }));
      close();
    }}>
      <Field label={t('Date')}><input type="date" value={date} required readOnly={!!editDate} onChange={event => {
        const next = event.target.value;
        setDate(next);
        setWindows(next ? hoursForDate(records, next) : []);
      }} /></Field>
      {windows.map((hours, index) => <div className="hours-entry" key={index}>
        <HoursFields hours={hours} onChange={next => setWindows(windows.map((item, i) => i === index ? next : item))} />
        <button className="button secondary" type="button" onClick={() => setWindows(windows.filter((_, i) => i !== index))}>{t('Remove')}</button>
      </div>)}
      {!windows.length && <p className="muted">{t('Unavailable on this date')}</p>}
      <div className="row-actions">
        <button className="text-button" type="button" onClick={() => setWindows([...windows, { start: '09:00', end: '17:00' }])}><Plus aria-hidden />{' '}{t('Add hours')}</button>
        {!editDate && <button className="text-button" type="button" onClick={close}>{t('Cancel')}</button>}
      </div>
    </RecordForm>}
    {editing && original && <RecordForm submit={t('Restore weekly hours')} onSave={async () => {
      await save(current => ({ ...current, hoursOverrides: current.hoursOverrides.filter(item => item.date !== date) }));
      close();
    }} />}
    {!!records.hoursOverrides.length && <div className="panel">{[...records.hoursOverrides].sort((a, b) => a.date.localeCompare(b.date)).map(item =>
      <article className="record-row" key={item.date}>
        <div className="row-heading"><strong>{titleDate(item.date)}</strong><More to={'/availability?hours=' + item.date}>{t('Edit date hours')}</More></div>
        <p>{item.windows.map(window => `${window.start}–${window.end}`).join(', ') || t('Unavailable')}</p>
      </article>)}</div>}
  </Section>;
}

export function breakSettingsLink(rule: BreakRule, occurrence?: string) {
  const params = new URLSearchParams({ break: rule.id });
  if (occurrence && rule.repeat) params.set('occurrence', occurrence);
  return '/availability?' + params;
}

function BreakEditor({ rule, today, save, close }: { rule?: BreakRule; today: string; save: Save; close: () => void }) {
  const [from, setFrom] = useState(rule?.from ?? today);
  const [repeats, setRepeats] = useState(!!rule?.repeat);
  const [days, setDays] = useState(rule?.repeat?.weekdays ?? [parseDate(today).getDay()]);
  const initialEnd = rule?.repeat?.end;
  const [ending, setEnding] = useState(initialEnd?.type ?? 'never');
  const [through, setThrough] = useState(initialEnd?.type === 'date' ? initialEnd.through : '');
  const [count, setCount] = useState(initialEnd?.type === 'count' ? String(initialEnd.count) : '2');
  const end = ending === 'date' ? { type: 'date' as const, through } : ending === 'count'
    ? { type: 'count' as const, count: Number(count) } : { type: 'never' as const };
  const repeat = repeats ? { weekdays: days, end } : null;
  const pattern = { id: rule?.id ?? '', title: '', from, hours: { start: '', end: '' }, repeat, changes: [] };
  const canPreview = !!from && !!days.length && (end.type !== 'date' || through >= from)
    && (end.type !== 'count' || (Number.isSafeInteger(end.count) && end.count > 0));
  const preview = repeats && canPreview ? breakPreviewDates(pattern, 6) : [];

  return <>
    <RecordForm submit={t('Save break')} cancel={rule ? '/availability' : undefined} onSave={async data => {
      if (repeats && !days.length) throw new Error('Choose at least one weekday.');
      if (repeats && canPreview && !preview.length) throw new Error('No selected weekday falls within these dates.');
      const next = { ...pattern, id: rule?.id ?? newId(), title: value(data, 'title'),
        hours: { start: value(data, 'start'), end: value(data, 'end') } };
      await save(current => {
        const prior = current.breaks.find(item => item.id === next.id);
        const updated = { ...next, changes: repeat ? prior?.changes.filter(change => breakOccursOn(next, change.date)) ?? [] : [] };
        return { ...current, breaks: prior ? current.breaks.map(item => item.id === next.id ? updated : item) : [...current.breaks, updated] };
      });
      close();
    }}>
      <Field label={t('Break name')}><input name="title" defaultValue={rule?.title} maxLength={255} placeholder={t('Lunch')} required /></Field>
      <div className="form-grid">
        <Field label={t('Break starts')}><input name="start" type="time" defaultValue={rule?.hours.start ?? '12:00'} required /></Field>
        <Field label={t('Break ends')}><input name="end" type="time" defaultValue={rule?.hours.end ?? '13:00'} required /></Field>
      </div>
      <div className="form-grid">
        <Field label={t('Repeat')}><select value={repeats ? 'weekly' : 'once'} onChange={event => setRepeats(event.target.value === 'weekly')}>
          <option value="once">{t('Once')}</option><option value="weekly">{t('Weekly')}</option>
        </select></Field>
        <Field label={t(repeats ? 'Series starts' : 'Break date')}><input type="date" value={from} onChange={event => setFrom(event.target.value)} required /></Field>
      </div>
      {repeats && <>
        <WeekdayPicker selected={days} onChange={setDays} />
        <div className="form-grid">
          <Field label={t('Ends')}><select value={ending} onChange={event => setEnding(event.target.value as typeof ending)}>
            <option value="never">{t('Never')}</option><option value="date">{t('On a date')}</option><option value="count">{t('After a number of occurrences')}</option>
          </select></Field>
          {ending === 'date' && <Field label={t('Last date')}><input type="date" value={through} min={from} onChange={event => setThrough(event.target.value)} required /></Field>}
          {ending === 'count' && <Field label={t('Occurrences')}><input type="number" inputMode="numeric" min={1} max={Number.MAX_SAFE_INTEGER}
            value={count} onChange={event => setCount(event.target.value)} required /></Field>}
        </div>
        {preview.length > 0 && <p className="muted">{t(preview.length > 5 ? 'First occurrences: {dates}' : 'Occurrences: {dates}', {
          dates: preview.slice(0, 5).map(date => titleDate(date)).join('; '),
        })}</p>}
        {canPreview && !preview.length && <p className="slot-feedback">{t('No selected weekday falls within these dates.')}</p>}
      </>}
      {!rule && <button type="button" className="text-button" onClick={close}>{t('Cancel')}</button>}
    </RecordForm>
    {rule?.repeat && !!rule.changes.length && <div className="panel">{rule.changes.map(change => <article className="record-row" key={change.date}>
      <div className="row-heading"><strong>{titleDate(change.date)}</strong><More to={breakSettingsLink(rule, change.date)}>{t('Edit occurrence')}</More></div>
      <p>{change.replacement ? t('Moved to {date} · {time}', {
        date: titleDate(change.replacement.date), time: `${change.replacement.start}–${change.replacement.end}`,
      }) : t('Skipped')}</p>
    </article>)}</div>}
    {rule && <RecordForm submit={t(rule.repeat ? 'Remove break series' : 'Remove break')} onSave={async () => {
      await save(current => ({ ...current, breaks: current.breaks.filter(item => item.id !== rule.id) }));
      close();
    }} />}
  </>;
}

function BreakOccurrence({ rule, date, save }: { rule: BreakRule; date: string; save: Save }) {
  const change = rule.changes.find(item => item.date === date);
  const [action, setAction] = useState(change?.replacement === null ? 'skip' : 'move');
  return <RecordForm submit={t('Save occurrence')} cancel="/availability" onSave={async data => {
    const replacement = action === 'move' ? { date: value(data, 'date'), start: value(data, 'start'), end: value(data, 'end') } : null;
    await save(current => ({ ...current, breaks: current.breaks.map(item => {
      if (item.id !== rule.id) return item;
      const changes = item.changes.filter(entry => entry.date !== date);
      if (action !== 'restore') changes.push({ date, replacement });
      return { ...item, changes };
    }) }));
    navigate('/availability');
  }}>
    <div className="row-heading"><strong>{rule.title} · {titleDate(date)}</strong><More to={breakSettingsLink(rule)}>{t('Edit series')}</More></div>
    <Field label={t('Change this occurrence')}><select value={action} onChange={event => setAction(event.target.value)}>
      <option value="move">{t('Move occurrence')}</option><option value="skip">{t('Skip occurrence')}</option>
      {change && <option value="restore">{t('Restore original occurrence')}</option>}
    </select></Field>
    {action === 'move' && <>
      <Field label={t('New break date')}><input name="date" type="date" defaultValue={change?.replacement?.date ?? date} required /></Field>
      <div className="form-grid">
        <Field label={t('Break starts')}><input name="start" type="time" defaultValue={change?.replacement?.start ?? rule.hours.start} required /></Field>
        <Field label={t('Break ends')}><input name="end" type="time" defaultValue={change?.replacement?.end ?? rule.hours.end} required /></Field>
      </div>
    </>}
  </RecordForm>;
}

export function BreakSettings({ records, today, selected, editId, occurrence, save, conflicts }: {
  records: Records; today: string; selected?: string; editId?: string; occurrence?: string; save: Save; conflicts: ScheduleConflict[];
}) {
  const [adding, setAdding] = useState(false);
  const rule = records.breaks.find(item => item.id === editId);
  const editOccurrence = rule?.repeat && occurrence && breakOccursOn(rule, occurrence);
  const affectedVisits = new Map(conflicts.flatMap(conflict => conflict.kind === 'local' && conflict.overlap.kind === 'break'
    ? [[conflict.appointment.id, conflict.appointment.date] as const] : []));
  const conflictDates = [...new Set(affectedVisits.values())];
  return <Section title={t('Breaks')} action={!adding && !rule && <button type="button" className="button secondary" onClick={() => setAdding(true)}>
    <Plus aria-hidden />{' '}{t('Add break')}
  </button>}>
    {rule && editOccurrence && <BreakOccurrence rule={rule} date={occurrence!} save={save} />}
    {(adding || (rule && !editOccurrence)) && <BreakEditor rule={rule} today={selected ?? today} save={save} close={() => {
      setAdding(false);
      if (rule) navigate('/availability');
    }} />}
    {conflictDates.length > 0 && <div className="slot-feedback">
      <strong>{t(affectedVisits.size === 1 ? '{count} scheduled visit overlaps a break' : '{count} scheduled visits overlap breaks', { count: affectedVisits.size })}</strong>
      <div className="row-actions">
        <More to="/calendar-conflicts?from=availability">{t('View current conflicts')}</More>
        {conflictDates.map(date => <More key={date} to={'/calendar?date=' + date}>{formatDate(date)}</More>)}
      </div>
    </div>}
    <div className="panel">{records.breaks.map(item => {
      const days = item.repeat && weekdays.filter(day => item.repeat!.weekdays.includes(day.day)).map(day => t(day.short)).join(', ');
      const end = item.repeat?.end;
      return <article className="record-row" key={item.id}>
        <div className="row-heading"><strong>{item.title}</strong><More to={breakSettingsLink(item)}>{t(item.repeat ? 'Edit series' : 'Edit break')}</More></div>
        <p>{item.hours.start}–{item.hours.end} · {days ? t('Weekly on {days} from {date}', { days, date: formatDate(item.from) }) : titleDate(item.from)}</p>
        {end?.type === 'date' && <p>{t('Through {date}', { date: titleDate(end.through) })}</p>}
        {end?.type === 'count' && <p>{t(end.count === 1 ? '{count} occurrence' : '{count} occurrences', { count: end.count })}</p>}
      </article>;
    })}{!records.breaks.length && <Empty>{t('No breaks scheduled.')}</Empty>}</div>
  </Section>;
}
