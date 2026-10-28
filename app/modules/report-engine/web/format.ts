import Decimal from 'decimal.js';
import type { ResultCell } from '../shared';

export function displayValue(c: ResultCell, format = 'general') {
  if (c.unit === 'text') return c.value;
  const amount = new Decimal(c.value);
  const n = ['cents', 'foreignCents'].includes(c.unit) ? amount.div(100) : amount;
  return format === 'percent'
    ? `${n.times(100).toFixed(2)}%`
    : format === 'decimal2' || ['cents', 'foreignCents'].includes(c.unit)
      ? n.toFixed(2)
      : n.toFixed();
}
