import { CalendarPlus } from '@phosphor-icons/react';
import { useEffect, useRef } from 'react';
import type { Patient } from '../domain/model';
import { t } from '../i18n';

export function BookingOffer({ patients, onProceed, onDismiss }: {
  patients: Patient[]; onProceed: () => void; onDismiss: () => void;
}) {
  const sheet = useRef<HTMLDialogElement>(null);
  const patient = patients.length === 1 ? patients[0] : undefined;

  useEffect(() => {
    if (sheet.current && !sheet.current.open) sheet.current.showModal();
  }, []);

  return <dialog ref={sheet} className="booking-sheet booking-offer" onClose={onDismiss}
    aria-labelledby="booking-offer-heading" aria-describedby="booking-offer-description">
    <div className="booking-offer-heading">
      <span className="booking-offer-icon"><CalendarPlus size={22} aria-hidden /></span>
      <h2 id="booking-offer-heading">{t('Ready to book')}</h2>
    </div>
    <p id="booking-offer-description">{patient
      ? t('Book an appointment for {name}?', { name: patient.name })
      : t('{count} patients are now ready to book.', { count: patients.length })}</p>
    <div className="booking-offer-actions">
      <button type="button" className="button" onClick={onProceed}>
        {t(patient ? 'Book visit' : 'View ready-to-book patients')}
      </button>
      <button type="button" className="button secondary" onClick={() => sheet.current?.close()}>{t('Later')}</button>
    </div>
  </dialog>;
}
