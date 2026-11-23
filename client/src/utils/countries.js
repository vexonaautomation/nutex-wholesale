import { useEffect, useState } from 'react';
import { INDIAN_STATES } from '../constants/index.js';

// Every country with its states / regions (country-region-data). Loaded only
// on the address forms, so the shop pages stay light. India keeps our own
// list of states (as on every order so far).
export const INDIA = 'India';
export const isIndia = (country) => !country || String(country).trim().toLowerCase() === 'india';

let loading = null;
export function loadCountries() {
  loading ||= import('country-region-data').then(({ allCountries }) => allCountries
    .map(([name, , regions]) => ({ name, states: name === INDIA ? INDIAN_STATES : regions.map(([r]) => r) })));
  return loading;
}

/** [{ name, states }] once loaded; India alone until then. */
export function useCountries() {
  const [list, setList] = useState(null);
  useEffect(() => {
    let live = true;
    loadCountries().then((l) => { if (live) setList(l); }).catch(() => {});
    return () => { live = false; };
  }, []);
  return list || [{ name: INDIA, states: INDIAN_STATES }];
}

/** The states of a country ([] = type it in). */
export const statesOf = (countries, country) => (countries.find((c) => c.name === (country || INDIA))?.states || []);

/** The country's own spelling of a typed / saved state, else ''. */
export const stateOption = (states, value) => states.find((s) => s.toLowerCase() === String(value || '').trim().toLowerCase()) || '';
