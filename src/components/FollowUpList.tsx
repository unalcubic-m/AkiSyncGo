import { CaretRight, ChatCircleText, Check, Clock, Flask, LockSimple } from '@phosphor-icons/react';
import { useState } from 'react';
import { formatDate } from '../domain/dates';
import type { Patient, RecordChange, Wait } from '../domain/model';
import { errorMessage, t } from '../i18n';
import { Empty, path } from './ui';

type FollowUpOrigin = 'work' | 'responses' | 'today' | 'attention' | 'patient';

export function FollowUpList({ waits, patients, today, save, from }: {
  waits: Wait[]; patients: Patient[]; today: string; save: (change: RecordChange) => Promise<void>; from: FollowUpOrigin;
}) {
  const [pending, setPending] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  async function resolveLab(wait: Wait) {
    if (pending) return;
    setPending(wait.id);
    setError('');
    setNotice('');
    try {
      await save(records => ({
        ...records,
        waits: records.waits.map(item => item.id === wait.id && item.status === 'Waiting' && item.type === 'Laboratory return'
          ? { ...item, status: 'Resolved', endedOn: today }
          : item),
      }));
      setNotice(t('Lab follow-up resolved.'));
    } catch (problem) {
      setError(errorMessage(problem, 'Could not resolve the follow-up.'));
    } finally {
      setPending('');
    }
  }

  if (!waits.length) return <div className="panel"><Empty>{t('No follow-ups in this view.')}</Empty></div>;

  return <>
    <ul className={from === 'today' ? 'compact-list' : 'panel compact-list'}>
      {waits.map(wait => {
        const patient = patients.find(item => item.id === wait.patientId);
        const lab = wait.type === 'Laboratory return';
        const Icon = lab ? Flask : wait.type === 'Patient reply' ? ChatCircleText : Clock;
        const onProfile = from === 'patient';
        const target = '/patients/' + wait.patientId + '/responses/' + wait.id + (onProfile ? '' : '?from=' + from);
        const canResolve = lab && wait.status === 'Waiting';
        return <li className="compact-list-row" key={wait.id}>
          <a className="compact-row-link" href={path(target)}
            aria-label={!onProfile && lab && patient ? t('Lab follow-up for {name}', { name: patient.name }) : undefined}>
            <span className="compact-row-icon" data-lab={lab}><Icon size={17} aria-hidden /></span>
            <span className="compact-row-content">
              <strong>{onProfile ? wait.title : patient?.name ?? wait.title}</strong>
              {!onProfile && !lab && patient && <small>{wait.title}</small>}
              {onProfile && <small>{t(wait.type)}{wait.reviewOn && <> · {t('Review')} {formatDate(wait.reviewOn)}</>}</small>}
              {onProfile && wait.status === 'Waiting' && wait.blocks && <small className="follow-up-lock">
                <LockSimple size={12} aria-hidden />{t('Blocks booking')}
              </small>}
              {wait.status !== 'Waiting' && <small>{t(wait.status)}</small>}
            </span>
          </a>
          {canResolve
            ? <button className="compact-row-action icon-button" type="button"
                aria-label={t('Resolve lab follow-up for {name}', { name: patient?.name ?? wait.title })}
                title={t('Resolve lab follow-up')} disabled={!!pending}
                onClick={() => void resolveLab(wait)}><Check size={18} aria-hidden /></button>
            : <span className="compact-row-caret"><CaretRight size={15} aria-hidden /></span>}
        </li>;
      })}
    </ul>
    <span className="visually-hidden" role="status">{notice}</span>
    {error && <p className="form-error" role="alert">{error}</p>}
  </>;
}
