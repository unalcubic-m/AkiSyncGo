import type { CSSProperties } from 'react';
import { monthDates, placeCalendarEntries } from '../domain/calendar-view';
import { clockTime, formatDate, parseDate, titleDate } from '../domain/dates';
import type { Appointment } from '../domain/model';
import { t } from '../i18n';

export type CalendarEntry = {
  id: string;
  title: string;
  shortTitle: string;
  start: number;
  end: number;
  tone: 'visit' | 'alert' | 'blocked' | 'busy' | 'inactive';
  warnings?: string[];
  href?: string;
  appointment?: Appointment;
};

export type CalendarRange = { date: string; start: number; end: number };

type CalendarDay = { date: string; entries: CalendarEntry[]; busy: boolean };

export function CalendarTimeline({ range, days, selected, start, end, compact, daily, selectedId, dayHref, onSelect }: {
  range?: CalendarRange; days: CalendarDay[]; selected: string; start: number; end: number; compact: boolean; daily: boolean; selectedId?: string;
  dayHref: (date: string) => string; onSelect: (appointment: Appointment, control: HTMLButtonElement) => void;
}) {
  const duration = end - start;
  const hours = Array.from({ length: duration / 60 }, (_, index) => clockTime(start + index * 60));
  return <div className="panel calendar-timeline" aria-label={t('Appointment calendar')}
    style={{ '--calendar-hours': hours.length } as CSSProperties}>
    <div className="calendar-time-rail" aria-hidden="true">{hours.map(hour => <span key={hour}>{hour}</span>)}</div>
    {days.map(day => <div className="calendar-column" data-date={day.date} key={day.date}>
      <a className="calendar-column-day" href={dayHref(day.date)} aria-current={day.date === selected ? 'date' : undefined}
        aria-label={day.busy ? t('{date}, busy on device calendar', { date: titleDate(day.date) }) : titleDate(day.date)}>
        <small>{formatDate(day.date, { weekday: 'short' })}</small>
        <strong>{parseDate(day.date).getDate()}</strong>
        <span className={'calendar-day-dot' + (day.busy ? ' busy' : day.entries.length ? ' occupied' : '')} aria-hidden />
      </a>
      <div className="calendar-column-times">
        {range?.date === day.date && <div className="calendar-selected-range"
          style={{
            '--range-top': ((range.start - start) / duration * 100) + '%',
            '--range-height': ((range.end - range.start) / duration * 100) + '%',
          } as CSSProperties} aria-hidden="true">
          <span>{clockTime(range.start)}{!compact && '–' + clockTime(range.end)}</span>
        </div>}
        {placeCalendarEntries(day.entries).map(({ entry, lane, lanes }) => {
          const time = clockTime(entry.start) + '–' + clockTime(entry.end);
          const style = {
            '--event-start': `${(entry.start - start) / duration * 100}%`,
            '--event-length': `${(entry.end - entry.start) / duration * 100}%`,
            '--event-left': `${lane / lanes * 100}%`,
            '--event-width': `${100 / lanes}%`,
          } as CSSProperties;
          const label = [entry.title, time, ...(entry.warnings ?? [])].join(' · ');
          const className = 'calendar-timed-entry ' + entry.tone;
          const content = <><strong>{compact ? entry.shortTitle : entry.title}</strong>{daily && <small>{time}</small>}</>;
          const appointment = entry.appointment;
          return appointment
            ? <button key={entry.id} className={className} type="button" style={style} aria-label={label}
              aria-pressed={selectedId === appointment.id} onClick={event => onSelect(appointment, event.currentTarget)}>{content}</button>
            : <a key={entry.id} className={className} href={entry.href} style={style} aria-label={label}>{content}</a>;
        })}
      </div>
    </div>)}
  </div>;
}

export function CalendarMonth({ month, selected, dayHref, includes, count, onChoose }: {
  month: string; selected: string; dayHref: (date: string) => string;
  includes?: (date: string) => boolean; count?: (date: string) => number; onChoose?: (date: string) => void;
}) {
  const days = monthDates(month);
  return <div className="calendar-month-grid">
    {days.slice(0, 7).map(date => <span className="calendar-month-weekday" key={'weekday-' + date}>
      {formatDate(date, { weekday: 'short' })}
    </span>)}
    {days.map(date => {
      if (includes && !includes(date)) return <span className="calendar-month-empty" key={date} aria-hidden />;
      const total = count?.(date) ?? 0;
      return <a className={date.slice(0, 7) === month.slice(0, 7) ? 'calendar-month-day' : 'calendar-month-day other-month'}
        key={date} href={dayHref(date)} aria-current={date === selected ? 'date' : undefined}
        onClick={event => { if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) onChoose?.(date); }}
        aria-label={total ? t('{date}, {count} scheduled', { date: titleDate(date), count: total }) : titleDate(date)}>
        <strong>{parseDate(date).getDate()}</strong>
        {total > 0 && <small>{total}</small>}
      </a>;
    })}
  </div>;
}
