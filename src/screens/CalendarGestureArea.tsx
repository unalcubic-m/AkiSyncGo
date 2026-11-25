import { CalendarPlusIcon, CalendarSlashIcon } from '@phosphor-icons/react';
import { useCallback, useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { path } from '../components/ui';
import { clockTime, titleDate } from '../domain/dates';
import { t } from '../i18n';
import type { CalendarEntry, CalendarRange } from './CalendarViews';

const calendarHoldTime = 450;
const calendarHoldTolerance = 10;
const calendarSelectionStep = 15;

type CalendarPress = {
  input: 'touch' | 'mouse';
  id: number;
  x: number;
  y: number;
  bounds: DOMRect;
  date: string;
  anchor: number;
  min: number;
  max: number;
  timer: number;
  range?: CalendarRange;
};

export function CalendarGestureArea({ previous, next, onPage, days, clockStart, clockEnd, children }: {
  previous?: string; next?: string; onPage: (date: string) => void;
  days: { date: string; entries: CalendarEntry[] }[];
  clockStart: number; clockEnd: number;
  children: (range?: CalendarRange) => ReactNode;
}) {
  const surface = useRef<HTMLDivElement>(null);
  const chooser = useRef<HTMLDialogElement>(null);
  const swipe = useRef<{ id: number; x: number; y: number } | undefined>(undefined);
  const press = useRef<CalendarPress | undefined>(undefined);
  const claimed = useRef(false);
  const [range, setRange] = useState<CalendarRange>();
  const [choice, setChoice] = useState<CalendarRange>();

  const cancelPress = useCallback(() => {
    const current = press.current;
    if (!current) return;
    window.clearTimeout(current.timer);
    press.current = undefined;
    if (current.range) setRange(undefined);
  }, []);

  const arm = useCallback((input: CalendarPress['input'], id: number, target: EventTarget | null, x: number, y: number) => {
    cancelPress();
    if (!(target instanceof Element) || target.closest('.calendar-timed-entry')) return;
    const area = target.closest<HTMLElement>('.calendar-column-times');
    const date = area?.closest<HTMLElement>('.calendar-column')?.dataset.date;
    const day = days.find(item => item.date === date);
    if (!area || !day) return;

    const bounds = area.getBoundingClientRect();
    if (!bounds.height) return;
    const hit = clockStart + (y - bounds.top) / bounds.height * (clockEnd - clockStart);
    let min = clockStart;
    let max = Math.min(clockEnd, 1439);
    for (const entry of day.entries) {
      if (entry.tone === 'inactive') continue;
      if (entry.start <= hit && hit < entry.end) return;
      if (entry.end <= hit) min = Math.max(min, entry.end);
      if (entry.start > hit) max = Math.min(max, entry.start);
    }

    min = Math.ceil(min / calendarSelectionStep) * calendarSelectionStep;
    max = Math.floor(max / calendarSelectionStep) * calendarSelectionStep;
    if (max - min < calendarSelectionStep) return;
    const anchor = Math.max(min, Math.min(max - calendarSelectionStep,
      Math.floor(hit / calendarSelectionStep) * calendarSelectionStep));

    const timer = window.setTimeout(() => {
      const current = press.current;
      if (current?.timer !== timer) return;
      current.range = { date: day.date, start: anchor, end: Math.min(max, anchor + 30) };
      claimed.current = true;
      if (input === 'mouse') surface.current?.setPointerCapture(id);
      setRange(current.range);
    }, calendarHoldTime);

    press.current = { input, id, x, y, bounds, date: day.date, anchor, min, max, timer };
  }, [cancelPress, clockEnd, clockStart, days]);

  const resize = useCallback((input: CalendarPress['input'], id: number, x: number, y: number) => {
    const current = press.current;
    if (!current || current.input !== input || current.id !== id) return;
    if (!current.range) {
      if (Math.hypot(x - current.x, y - current.y) > calendarHoldTolerance) cancelPress();
      return;
    }
    if (Math.abs(y - current.y) < 4) return;
    const minute = clockStart + (y - current.bounds.top) / current.bounds.height * (clockEnd - clockStart);
    const tick = Math.min(current.max, Math.max(current.min,
      Math.round(minute / calendarSelectionStep) * calendarSelectionStep));
    const nextRange = {
      date: current.date,
      start: Math.min(current.anchor, tick),
      end: Math.max(current.anchor + calendarSelectionStep, tick),
    };
    if (nextRange.start === current.range.start && nextRange.end === current.range.end) return;
    current.range = nextRange;
    setRange(nextRange);
  }, [cancelPress, clockEnd, clockStart]);

  const release = useCallback((input: CalendarPress['input'], id: number) => {
    const current = press.current;
    if (!current || current.input !== input || current.id !== id) return;
    window.clearTimeout(current.timer);
    press.current = undefined;
    if (current.range) setChoice(current.range);
  }, []);

  useEffect(() => {
    const element = surface.current;
    if (!element) return;

    function startTouch(event: TouchEvent) {
      if (event.touches.length !== 1) {
        cancelPress();
        return;
      }
      const point = event.changedTouches[0];
      arm('touch', point.identifier, event.target, point.clientX, point.clientY);
    }

    function moveTouch(event: TouchEvent) {
      const current = press.current;
      if (current?.input !== 'touch') return;
      const point = Array.from(event.changedTouches).find(touch => touch.identifier === current.id);
      if (!point) return;
      // A hold owns the drag. Before it activates, let the browser scroll.
      if (current.range && event.cancelable) event.preventDefault();
      resize('touch', point.identifier, point.clientX, point.clientY);
    }

    function endTouch(event: TouchEvent) {
      const current = press.current;
      if (current?.input !== 'touch') return;
      if (!Array.from(event.changedTouches).some(touch => touch.identifier === current.id)) return;
      if (current.range && event.cancelable) event.preventDefault();
      release('touch', current.id);
    }

    element.addEventListener('touchstart', startTouch, { passive: true });
    element.addEventListener('touchmove', moveTouch, { passive: false });
    element.addEventListener('touchend', endTouch, { passive: false });
    element.addEventListener('touchcancel', cancelPress);
    return () => {
      element.removeEventListener('touchstart', startTouch);
      element.removeEventListener('touchmove', moveTouch);
      element.removeEventListener('touchend', endTouch);
      element.removeEventListener('touchcancel', cancelPress);
      if (press.current) window.clearTimeout(press.current.timer);
      press.current = undefined;
    };
  }, [arm, cancelPress, release, resize]);

  useEffect(() => {
    if (choice && chooser.current && !chooser.current.open) chooser.current.showModal();
  }, [choice]);

  function finishPointer(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType !== 'touch') release('mouse', event.pointerId);
    const origin = swipe.current;
    swipe.current = undefined;
    if (claimed.current || !origin || origin.id !== event.pointerId) return;
    const horizontal = event.clientX - origin.x;
    const vertical = event.clientY - origin.y;
    if (Math.abs(horizontal) < 56 || Math.abs(horizontal) < Math.abs(vertical) * 1.5) return;
    claimed.current = true;
    const date = horizontal < 0 ? next : previous;
    if (!date) return;
    onPage(date);
  }

  const choiceUrl = choice && path('/appointments/new?' + new URLSearchParams({
    date: choice.date, start: clockTime(choice.start), end: clockTime(choice.end), from: 'calendar',
  }));

  return <>
    <div className="calendar-gesture-area" ref={surface}
      onPointerDown={event => {
        if (!event.isPrimary || event.button !== 0) {
          swipe.current = undefined;
          return;
        }
        claimed.current = false;
        swipe.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
        if (event.pointerType !== 'touch') arm('mouse', event.pointerId, event.target, event.clientX, event.clientY);
      }}
      onPointerMove={event => {
        if (event.pointerType !== 'touch') resize('mouse', event.pointerId, event.clientX, event.clientY);
      }}
      onPointerLeave={event => {
        if (event.pointerType !== 'touch' && !claimed.current) cancelPress();
      }}
      onPointerCancel={event => {
        swipe.current = undefined;
        if (event.pointerType !== 'touch') cancelPress();
      }}
      onPointerUp={finishPointer}
      onClickCapture={event => {
        if (event.detail && claimed.current) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      onContextMenu={event => {
        if (press.current || claimed.current) event.preventDefault();
      }}
      onDragStart={event => { event.preventDefault(); }}>
      {children(range)}
    </div>
    <dialog ref={chooser} className="calendar-range-actions" aria-labelledby="calendar-choice-heading"
      onClose={() => { setRange(undefined); setChoice(undefined); }}>
      {choice && choiceUrl && <>
        <header>
          <p>{titleDate(choice.date)}</p>
          <h2 id="calendar-choice-heading">{clockTime(choice.start)}–{clockTime(choice.end)}</h2>
        </header>
        <a href={choiceUrl} className="button"><CalendarPlusIcon size={18} aria-hidden />{t('New appointment')}</a>
        <a href={choiceUrl + '&kind=block'} className="button secondary"><CalendarSlashIcon size={18} aria-hidden />{t('Close for appointments')}</a>
        <button type="button" className="text-button" onClick={() => chooser.current?.close()}>{t('Cancel')}</button>
      </>}
    </dialog>
  </>;
}
