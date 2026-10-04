import { S } from '../store';

/** "$15.49" in the currency picked on the Repeats page (USD by default). */
export function fmtMoney(n: number, opts: { cents?: boolean } = {}) {
  const currency = S().settings.currency || 'USD';
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: opts.cents === false ? 0 : 2 }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency}`;
  }
}
