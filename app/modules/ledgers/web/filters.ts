import { useState } from 'react';
import { useLocation } from 'react-router';
import { useUrlFilters } from '@caiwu/ui';

const defaults = {
  from: '',
  to: '',
  account: '',
  accountTo: '',
  dims: '',
  currency: '',
  includeUnposted: '',
};

/** 标签页 location 更新期间，页面先使用刚提交的条件；地址栏仍由 useUrlFilters 持久化。 */
export function useLedgerFilters() {
  const location = useLocation();
  const [persisted, persist] = useUrlFilters(defaults);
  const source = `${location.key}:${JSON.stringify(persisted)}`;
  const [applied, setApplied] = useState<{ source: string; values: typeof defaults } | null>(null);
  const values = applied?.source === source ? applied.values : persisted;
  const set = (next: Partial<typeof defaults>) => {
    const updated = { ...values, ...next };
    setApplied({ source, values: updated });
    persist(updated);
  };
  return [values, set] as const;
}
