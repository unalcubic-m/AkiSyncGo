import { getLocale, setLocale, t } from '../i18n';
import { Field } from './ui';

export default function LanguageSelect() {
  return <Field label={t('Language')}>
    <select value={getLocale()} onChange={event => setLocale(event.target.value === 'en' ? 'en' : 'tr')}>
      <option value="tr" lang="tr">Türkçe</option>
      <option value="en" lang="en">English</option>
    </select>
  </Field>;
}
