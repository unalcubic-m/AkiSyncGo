import { errorMessage, t, type Message } from '../i18n';
import { ArrowLeft, ArrowRight, CalendarBlank, CalendarPlusIcon, CaretRight, Clock, Warning, type Icon } from '@phosphor-icons/react';
import type { FormEvent, ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { formatDate } from '../domain/dates';
import type { Alert, Appointment, Records } from '../domain/model';
import { activeAlerts } from '../domain/workflows';
import { finishRoute } from '../navigation';

export function path(route: string) { return '#' + route; }
export function navigate(route: string) { finishRoute(route); }

export function ButtonLink({ to, children, icon: IconComponent, secondary = false, back = false }: {
  to: string; children: ReactNode; icon?: Icon; secondary?: boolean; back?: boolean;
}) {
  return <a className={'button' + (secondary ? ' secondary' : '')} href={path(to)} data-navigation-back={back ? '' : undefined}>
    {IconComponent && <IconComponent aria-hidden />} {children}
  </a>;
}

export function PageHeader({ title, subtitle, action, back }: { title: string; subtitle?: string; action?: ReactNode; back?: string }) {
  return <header className="page-header">
    {back && <a className="back" href={path(back)}><ArrowLeft aria-hidden />{' '}{t('Back')}</a>}
    <div className="page-heading">
      <div>{subtitle && <p className="eyebrow">{subtitle}</p>}<h1>{title}</h1></div>
      {action}
    </div>
  </header>;
}

export function Section({ title, action, children, className = '' }: {
  title: string; action?: ReactNode; children: ReactNode; className?: string;
}) {
  return <section className={'section ' + className}><div className="section-heading"><h2>{title}</h2>{action}</div>{children}</section>;
}

export function More({ to, children }: { to: string; children: ReactNode }) {
  return <a className="more" href={path(to)}>{children}<ArrowRight aria-hidden /></a>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

export function Pill({ children, tone = 'neutral' }: { children: ReactNode; tone?: string }) {
  return <span className={'pill ' + tone}>{children}</span>;
}

export function AlertBadge({ alert }: { alert: Alert }) {
  return <span className={`alert-badge ${alert.severity.toLowerCase()}`}><Warning aria-hidden />
    <span>{t(alert.severity)}: {alert.label}</span>
  </span>;
}

export function VisitList({ records, visits, dates, alerts, from, calendarConflicts, breakConflicts, pendingOutcomeIds }: {
  records: Records; visits: Appointment[]; dates?: boolean; alerts?: boolean; from?: 'today' | 'calendar' | 'attention';
  calendarConflicts?: Set<string>;
  breakConflicts?: Set<string>;
  pendingOutcomeIds?: ReadonlySet<string>;
}) {
  return <div className="visit-list">
    {visits.map(item => {
      const patient = records.patients.find(patient => patient.id === item.patientId);
      const warnings = alerts && patient ? activeAlerts(records, patient.id) : [];
      const block = item.kind === 'Block';
      const pending = pendingOutcomeIds?.has(item.id);
      return <a href={path(`/appointments/${item.id}${from ? '?from=' + from : ''}`)} key={item.id}
        className={'visit-row' + (block ? ' blocked' : '') + (pending ? ' outcome-pending' : '')}>
        <div className="visit-time">
          {dates && <span>{formatDate(item.date)}</span>}
          <strong>{item.start}</strong><span>{item.end}</span>
        </div>
        <div className="visit-main">
          <strong>{patient?.name ?? item.title}</strong>
          {patient && <span>{item.title}{item.procedure ? ' · ' + item.procedure : ''}</span>}
          {warnings.map(alert => <AlertBadge key={alert.id} alert={alert} />)}
          {calendarConflicts?.has(item.id) && <Pill tone="amber">{t('Calendar conflict')}</Pill>}
          {breakConflicts?.has(item.id) && <Pill tone="amber">{t('Break conflict')}</Pill>}
        </div>
        <Pill tone={pending ? 'amber' : item.status === 'Scheduled' ? 'blue' : item.status === 'Completed' ? 'green' : 'neutral'}>
          {pending ? <><Clock size={12} weight="bold" aria-hidden />{t('Outcome pending')}</>
            : block && item.status === 'Blocked time' ? <><Clock aria-hidden /> {t('Blocked')}</> : t(item.status)}
        </Pill>
        <CaretRight aria-hidden className="visit-chevron" />
      </a>;
    })}
  </div>;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

export function Options({ values }: { values: readonly Message[] }) {
  return <>{values.map(value => <option key={value} value={value}>{t(value)}</option>)}</>;
}

export class FormWarning extends Error {}

export function RecordForm({ children, onSave, submit = t('Save'), cancel, disabled, resetOnSave, destructive, screen, beforeSubmit }: {
  children?: ReactNode; beforeSubmit?: ReactNode; onSave: (data: FormData) => Promise<void>; submit?: string; cancel?: string | (() => void); disabled?: boolean; resetOnSave?: boolean; destructive?: boolean; screen?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ error: unknown }>();
  const feedbackElement = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (screen && feedback) feedbackElement.current?.scrollIntoView({ block: 'nearest' });
  }, [screen, feedback]);
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    if (screen && form.querySelector('dialog[open]')) return;
    const data = new FormData(form);
    setFeedback(undefined);
    setBusy(true);
    try { await onSave(data); if (resetOnSave) form.reset(); }
    catch (error) { setFeedback({ error }); }
    finally { setBusy(false); }
  }
  const fields = <>
    {children}
    {feedback && <p ref={feedbackElement} className={feedback.error instanceof FormWarning ? 'slot-feedback' : 'form-error'} role="alert">
      {errorMessage(feedback.error, 'Could not save. Try again.')}
    </p>}
  </>;
  return <form className={screen ? 'record-form screen-form' : 'record-form'} onSubmit={handleSubmit}>
    {screen ? <div className="record-form-body">{fields}</div> : fields}
    <div className="form-actions">
      {beforeSubmit}
      <button type="submit" className={destructive ? "button danger" : "button"} disabled={busy || disabled}>{busy ? t('Saving…') : submit}</button>
      {typeof cancel === 'string' ? <ButtonLink secondary to={cancel} back>{t('Cancel')}</ButtonLink> : cancel &&
        <button type="button" className="button secondary" onClick={cancel} disabled={busy}>{t('Cancel')}</button>}
    </div>
  </form>;
}

export const value = (data: FormData, key: string) => String(data.get(key) ?? '').trim();
export const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');

export function NewVisitLink({ to = '/appointments/new', label = t('New appointment'), iconOnly = false }: {
  to?: string; label?: string; iconOnly?: boolean;
}) {
  return iconOnly ? <a className="button icon-only" href={path(to)} aria-label={label} title={label}>
    <CalendarPlusIcon aria-hidden />
  </a> : <ButtonLink to={to} icon={CalendarPlusIcon}>{label}</ButtonLink>;
}

export function AgendaEmpty({ children }: { children: ReactNode }) {
  return <div className="agenda-empty"><CalendarBlank aria-hidden size={31} /><p>{children}</p></div>;
}
