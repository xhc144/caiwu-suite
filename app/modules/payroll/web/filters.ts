import { useState } from 'react';
import { useLocation } from 'react-router';
import { useUrlFilters } from '@caiwu/ui';
/** W0 标签页 location 快照同页查询更新滞后时，活动页以浏览器地址为准；仍由 useUrlFilters 写入。 */
export function usePayrollFilters<V extends Record<string, string | number | boolean | undefined>>(
  defaults: V,
): [V, (next: Partial<V>) => void] {
  const [url, write] = useUrlFilters(defaults),
    location = useLocation();
  const [, render] = useState(0);
  const values = { ...url };
  if (window.location.pathname.replace(/\/$/, '') === location.pathname.replace(/\/$/, '')) {
    const actual = new URLSearchParams(window.location.search);
    for (const [key, defaultValue] of Object.entries(defaults)) {
      const raw = actual.get(key);
      (values as Record<string, unknown>)[key] =
        raw == null
          ? defaultValue
          : typeof defaultValue === 'number'
            ? Number(raw)
            : typeof defaultValue === 'boolean'
              ? raw === 'true' || raw === '1'
              : raw;
    }
  }
  return [
    values,
    (next) => {
      write({ ...values, ...next });
      render((n) => n + 1);
    },
  ];
}
