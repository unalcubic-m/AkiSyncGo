import { CalendarSlashIcon, Copy, DotsThree } from '@phosphor-icons/react';
import { useRef, useState } from 'react';
import { Field } from '../components/ui';
import { formatDate } from '../domain/dates';
import type { Slot } from '../domain/model';
import { errorMessage, t } from '../i18n';
import { copyAppointmentTime } from '../platform/clipboard';

export function AppointmentSlotActions({ slot, getTitle, onBlock }: {
  slot?: Slot; getTitle: () => string; onBlock: (slot: Slot, title: string) => Promise<void>;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const blockTitle = useRef<HTMLInputElement>(null);
  const [block, setBlock] = useState<{ slot: Slot; title: string }>();
  const [blockError, setBlockError] = useState('');
  const [saving, setSaving] = useState(false);
  const [copyResult, setCopyResult] = useState<'copied' | 'failed'>();
  const fullDate = (date: string) => formatDate(date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const timeRange = ({ start, end }: Slot) => `${start}–${end}`;
  const slotText = slot ? `${fullDate(slot.date)} · ${timeRange(slot)}` : '';
  const moreActions = t('More actions');

  function openBlock() {
    if (!slot) return;
    setBlock({ slot, title: getTitle() });
    setBlockError('');
    menu.current?.hidePopover();
    dialog.current?.showModal();
    blockTitle.current?.focus();
  }

  async function confirmBlock() {
    if (!block || saving) return;
    setSaving(true);
    setBlockError('');
    try {
      await onBlock(block.slot, block.title.trim() || t('Blocked time'));
      dialog.current?.close();
    } catch (error) {
      setBlockError(errorMessage(error, 'Could not save. Try again.'));
    } finally {
      setSaving(false);
    }
  }

  async function copyTime() {
    try {
      await copyAppointmentTime(slotText);
      setCopyResult('copied');
    } catch {
      setCopyResult('failed');
    }
  }

  return <div className="booking-extra-actions">
    <button ref={trigger} type="button" className="button secondary icon-only" aria-label={moreActions}
      popoverTarget="booking-extra-menu" onClick={() => setCopyResult(undefined)}><DotsThree size={24} weight="bold" aria-hidden /></button>
    <div ref={menu} id="booking-extra-menu" popover="auto" className="booking-extra-menu" role="group" aria-label={moreActions}>
      <button type="button" disabled={!slot} onClick={openBlock}><CalendarSlashIcon size={20} aria-hidden />{t('Close for appointments')}</button>
      <button type="button" disabled={!slot} onClick={() => void copyTime()}><Copy size={20} aria-hidden />{t('Copy time')}</button>
      {copyResult && <p role="status">{copyResult === 'copied'
        ? t('Date and time copied.') : `${t('Could not copy')}. ${slotText}`}</p>}
    </div>
    <dialog ref={dialog} className="booking-block-confirm" aria-labelledby="booking-block-heading"
      aria-describedby="booking-block-summary" onClose={() => trigger.current?.focus()}
      onCancel={event => { if (saving) event.preventDefault(); }}>
      <h2 id="booking-block-heading">{t('Close for appointments')}</h2>
      {block && <div id="booking-block-summary" className="panel booking-block-summary">
        <time dateTime={block.slot.date}>{fullDate(block.slot.date)}</time>
        <strong className="booking-block-time">{timeRange(block.slot)}</strong>
      </div>}
      <Field label={t('Title')}>
        <input ref={blockTitle} maxLength={255} value={block?.title ?? ''} placeholder={t('Blocked time')} disabled={saving}
          onChange={event => { if (block) setBlock({ ...block, title: event.currentTarget.value }); }}
          onKeyDown={event => {
            if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
            event.preventDefault();
            void confirmBlock();
          }} />
      </Field>
      {blockError && <p className="form-error" role="alert">{blockError}</p>}
      <div className="booking-block-buttons">
        <button type="button" className="button secondary" disabled={saving} onClick={() => dialog.current?.close()}>{t('Cancel')}</button>
        <button type="button" className="button" disabled={saving} onClick={() => void confirmBlock()}>{t(saving ? 'Saving…' : 'Save closure')}</button>
      </div>
    </dialog>
  </div>;
}
