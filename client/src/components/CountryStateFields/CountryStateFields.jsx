import { Field } from '../common/ui.jsx';
import { INDIA, isIndia, statesOf, useCountries } from '../../utils/countries.js';

/**
 * Country, State and Pincode / postal code of an address. India: our list of
 * states and a 6-digit pincode. Abroad: that country's states (typed in when
 * the list has none) and an optional postal / ZIP code.
 * form: { country, state, pincode }; onChange(patch)
 */
export function CountryStateFields({ form, onChange, errors = {} }) {
  const countries = useCountries();
  const country = form.country || INDIA;
  const india = isIndia(country);
  const states = statesOf(countries, country);
  return (
    <>
      <Field label="Country" required error={errors.country}>
        <select className="select" value={country} onChange={(e) => onChange({ country: e.target.value, state: '', pincode: '' })} autoComplete="country-name" aria-invalid={!!errors.country}>
          {!countries.some((c) => c.name === country) && <option value={country}>{country}</option>}
          {countries.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
        </select>
      </Field>
      <Field label={india ? 'State' : 'State / region'} required error={errors.state}>
        {states.length ? (
          <select className="select" value={form.state} onChange={(e) => onChange({ state: e.target.value })} aria-invalid={!!errors.state}>
            <option value="">Select state</option>
            {form.state && !states.includes(form.state) && <option value={form.state}>{form.state}</option>}
            {states.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        ) : (
          <input className="input" value={form.state} onChange={(e) => onChange({ state: e.target.value })} maxLength={80} autoComplete="address-level1" aria-invalid={!!errors.state} />
        )}
      </Field>
      {india ? (
        <Field label="Pincode" required error={errors.pincode}>
          <input className="input" value={form.pincode} onChange={(e) => onChange({ pincode: e.target.value.replace(/\D/g, '').slice(0, 6) })} inputMode="numeric" maxLength={6} autoComplete="postal-code" aria-invalid={!!errors.pincode} />
        </Field>
      ) : (
        <Field label="Postal / ZIP code" hint="Optional" error={errors.pincode}>
          <input className="input" value={form.pincode} onChange={(e) => onChange({ pincode: e.target.value.slice(0, 12) })} maxLength={12} autoComplete="postal-code" aria-invalid={!!errors.pincode} />
        </Field>
      )}
    </>
  );
}
