import { useLayoutEffect, useRef } from 'react';
import './duration-wheel.css';

type Drag = { pointerId: number; startY: number; startScroll: number; moved: boolean };

function rowHeight(wheel: HTMLDivElement) {
  return (wheel.firstElementChild as HTMLElement).offsetHeight;
}

export function DurationWheel({ label, maximum, value, onChange, step = 1 }: {
  label: string; maximum: number; value: number; onChange: (value: number) => void; step?: number;
}) {
  const wheel = useRef<HTMLDivElement>(null);
  const initialIndex = useRef(value / step);
  const drag = useRef<Drag | undefined>(undefined);
  const suppressClick = useRef(false);

  useLayoutEffect(() => {
    if (wheel.current) wheel.current.scrollTop = initialIndex.current * rowHeight(wheel.current);
  }, []);

  function choose(next: number) {
    const selected = Math.max(0, Math.min(maximum, next));
    if (wheel.current) wheel.current.scrollTop = selected / step * rowHeight(wheel.current);
    onChange(selected);
  }

  function endDrag(track: HTMLDivElement, pointerId: number) {
    const gesture = drag.current;
    if (!gesture || gesture.pointerId !== pointerId) return;
    drag.current = undefined;
    suppressClick.current = gesture.moved;
    if (gesture.moved) {
      const selected = Math.round(track.scrollTop / rowHeight(track)) * step;
      delete track.dataset.dragging;
      choose(selected);
    }
  }

  return <div ref={wheel} className="duration-wheel" role="spinbutton" tabIndex={0}
    aria-label={label} aria-valuemin={0} aria-valuemax={maximum} aria-valuenow={value}
    onScroll={event => {
      const track = event.currentTarget;
      const height = rowHeight(track);
      if (height) onChange(Math.max(0, Math.min(maximum, Math.round(track.scrollTop / height) * step)));
    }}
    onKeyDown={event => {
      const steps: Record<string, number> = {
        ArrowUp: value + step, ArrowDown: value - step, PageUp: value + 5 * step, PageDown: value - 5 * step, Home: 0, End: maximum,
      };
      if (!Object.hasOwn(steps, event.key)) return;
      event.preventDefault();
      choose(steps[event.key]);
    }}
    onPointerDown={event => {
      suppressClick.current = false;
      if (event.pointerType !== 'mouse' || event.button !== 0) return;
      drag.current = { pointerId: event.pointerId, startY: event.clientY, startScroll: event.currentTarget.scrollTop, moved: false };
    }}
    onPointerMove={event => {
      const gesture = drag.current;
      if (!gesture || gesture.pointerId !== event.pointerId || !(event.buttons & 1)) return;
      const distance = event.clientY - gesture.startY;
      if (!gesture.moved && Math.abs(distance) < 5) return;
      const track = event.currentTarget;
      if (!gesture.moved) {
        gesture.moved = true;
        track.dataset.dragging = '';
        track.setPointerCapture(event.pointerId);
      }
      track.scrollTop = gesture.startScroll - distance;
    }}
    onPointerUp={event => endDrag(event.currentTarget, event.pointerId)}
    onPointerCancel={event => endDrag(event.currentTarget, event.pointerId)}
    onLostPointerCapture={event => endDrag(event.currentTarget, event.pointerId)}>
    {Array.from({ length: maximum / step + 1 }, (_, index) => {
      const option = index * step;
      return <div key={option} aria-hidden="true" data-selected={option === value || undefined}
        onClick={() => { if (!suppressClick.current) choose(option); }}>
        {String(option).padStart(2, '0')}
      </div>;
    })}
  </div>;
}
