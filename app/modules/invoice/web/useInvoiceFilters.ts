import { useState } from 'react';
import { useUrlFilters } from '@caiwu/ui';

/** Keep submitted filters immediately usable while the shell updates its saved tab location. */
export function useInvoiceFilters<V extends Record<string, string | number | boolean | undefined>>(
  defaults: V,
): [V, (next: Partial<V>) => void] {
  const [url, setUrl] = useUrlFilters(defaults);
  const [submitted, setSubmitted] = useState<{ url: V; values: V } | null>(null);
  const filters = submitted?.url === url ? submitted.values : url;
  return [
    filters,
    (next) => {
      const values = { ...filters, ...next };
      setSubmitted({ url, values });
      setUrl(values);
    },
  ];
}
