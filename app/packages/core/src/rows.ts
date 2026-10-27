/** Ignore only entirely blank editing rows; keep original row numbers for diagnostics. */
export function normalizeRows<T extends object>(
  rows: readonly T[],
): { rows: T[]; rowNumbers: number[] } {
  const ignored = new Set(['id', 'key', 'rowId', 'clientId', '_key']);
  const empty = (value: unknown): boolean => {
    if (value == null || value === '') return true;
    if (typeof value === 'string') return value.trim() === '';
    if (typeof value === 'object') return Object.values(value).every(empty);
    return false;
  };
  const kept: T[] = [],
    rowNumbers: number[] = [];
  rows.forEach((row, index) => {
    const blank = Object.entries(row).every(
      ([key, value]) =>
        ignored.has(key) || ((key === 'debit' || key === 'credit') && value === 0) || empty(value),
    );
    if (!blank) {
      kept.push(row);
      rowNumbers.push(index + 1);
    }
  });
  return { rows: kept, rowNumbers };
}
