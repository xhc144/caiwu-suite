import { useCallback, useEffect, useState } from 'react';
import { useTab } from '@caiwu/web-kit';
import { useUrlFilters } from '@caiwu/ui';

export type OpeningFilters = {
  year: number;
  currency: string;
  quantity: boolean;
  account: string;
  dimension: string;
};
const defaults: OpeningFilters = {
  year: 0,
  currency: '',
  quantity: false,
  account: '',
  dimension: '',
};
export function parseFilters(search: string): OpeningFilters {
  const p = new URLSearchParams(search);
  return {
    year: p.has('year') ? Number(p.get('year')) : 0,
    currency: p.get('currency') ?? '',
    quantity: ['1', 'true'].includes(p.get('quantity') ?? ''),
    account: p.get('account') ?? '',
    dimension: p.get('dimension') ?? '',
  };
}
/** 壳的标签页 location 在同路径替换参数时可能滞后。保留 useUrlFilters 写地址，
 * 本地立即更新查询；仅活动标签同步浏览器参数，隐藏标签保留自己的条件。 */
export function useOpeningFilters(): [OpeningFilters, (next: Partial<OpeningFilters>) => void] {
  const [urlFilters, setUrlFilters] = useUrlFilters(defaults);
  const { active, key } = useTab();
  const [filters, setFilters] = useState<OpeningFilters>(urlFilters);
  const browserSearch = active && window.location.pathname === key ? window.location.search : null;
  useEffect(() => {
    if (browserSearch != null) {
      const next = parseFilters(browserSearch);
      setFilters((previous) =>
        JSON.stringify(previous) === JSON.stringify(next) ? previous : next,
      );
    }
  }, [browserSearch]);
  useEffect(() => {
    const pop = () => {
      if (active && window.location.pathname === key)
        setFilters(parseFilters(window.location.search));
    };
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, [active, key]);
  const set = useCallback(
    (next: Partial<OpeningFilters>) => {
      const merged = { ...filters, ...next };
      setFilters(merged);
      setUrlFilters(merged);
    },
    [filters, setUrlFilters],
  );
  return [filters, set];
}
