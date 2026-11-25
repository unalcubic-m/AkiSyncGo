import { useEffect, useState } from 'react';

type NavigationEntry = {
  route: string;
  trail: string[];
  top?: number;
  fields?: Record<string, unknown>;
};

const key = 'akisyncNavigation';

export function readRoute() {
  const hash = window.location.hash.slice(1);
  return hash.startsWith('/') && !hash.startsWith('//') ? hash : '/today';
}

function readEntry(): NavigationEntry {
  const route = readRoute();
  const saved = window.history.state?.[key] as NavigationEntry | undefined;
  return saved?.route === route ? saved : { route, trail: [] };
}

function writeEntry(entry: NavigationEntry, action: 'pushState' | 'replaceState') {
  const previous = window.location.href;
  window.history[action]({ ...window.history.state, [key]: entry }, '', '#' + entry.route);
  if (previous !== window.location.href) {
    window.dispatchEvent(new HashChangeEvent('hashchange', { oldURL: previous, newURL: window.location.href }));
  }
}

function savePosition(entry: NavigationEntry) {
  writeEntry({ ...entry, top: window.scrollY }, 'replaceState');
}

export function restoreScrollPosition() {
  window.scrollTo(0, readEntry().top ?? 0);
}

export function openRoute(route: string, keepScroll = false) {
  const current = readEntry();
  if (route === current.route) return;
  savePosition(current);
  writeEntry({ route, trail: [...current.trail.slice(-63), current.route], top: keepScroll ? window.scrollY : 0 }, 'pushState');
}

export function finishRoute(route: string) {
  const current = readEntry();
  if (route === current.route) return;
  const matchingPage = current.trail.lastIndexOf(route);
  if (matchingPage >= 0) {
    window.history.go(matchingPage - current.trail.length);
    return;
  }
  writeEntry({ route, trail: current.trail }, 'replaceState');
}

export function returnToPreviousRoute(fallback: string) {
  const current = readEntry();
  if (current.trail.length) {
    savePosition(current);
    window.history.back();
    return;
  }
  finishRoute(fallback);
}

export function useAppRoute() {
  const [route, setRoute] = useState(readRoute);

  useEffect(() => {
    const before = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';

    function sync() {
      setRoute(readRoute());
    }

    function follow(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href^="#/"]') : null;
      if (!link || link.hasAttribute('download') || (link.target && link.target !== '_self')) return;
      const target = link.getAttribute('href')?.slice(1);
      if (!target || target.startsWith('//')) return;
      event.preventDefault();
      if (link.matches('.back, [data-navigation-back]')) returnToPreviousRoute(target);
      else openRoute(target);
    }

    window.addEventListener('hashchange', sync);
    window.addEventListener('popstate', sync);
    document.addEventListener('click', follow);
    return () => {
      window.removeEventListener('hashchange', sync);
      window.removeEventListener('popstate', sync);
      document.removeEventListener('click', follow);
      window.history.scrollRestoration = before;
    };
  }, []);

  return route;
}

export function useRouteField<T>(field: string, fallback: T) {
  const [state, setState] = useState<T>(() => (readEntry().fields?.[field] as T | undefined) ?? fallback);

  function update(next: T) {
    const current = readEntry();
    // Store filters with their history entry so Back restores that instance of the list.
    writeEntry({ ...current, fields: { ...current.fields, [field]: next } }, 'replaceState');
    setState(next);
  }

  return [state, update] as const;
}
