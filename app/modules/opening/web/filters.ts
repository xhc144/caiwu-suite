import { useCallback, useEffect, useState } from 'react';
import { useTab } from '@caiwu/web-kit';
import { useUrlFilters } from '@caiwu/ui';

export type OpeningFilters = {
  year: number;
  currency: string;
  quantity: boolean;
  account: string;
  dimension: string;
  item: string;
};
const defaults: OpeningFilters = {
  year: 0,
  currency: '',
  quantity: false,
  account: '',
  dimension: '',
  item: '',
};
export function parseFilters(search: string): OpeningFilters {
  const p = new URLSearchParams(search);
  return {
    year: p.has('year') ? Number(p.get('year')) : 0,
    currency: p.get('currency') ?? '',
    quantity: ['1', 'true'].includes(p.get('quantity') ?? ''),
    account: p.get('account') ?? '',
    dimension: p.get('dimension') ?? '',
    item: p.get('item') ?? '',
  };
}
const tabPath = (pathname: string) => pathname.replace(/\/+$/, '') || '/';
/** 保留 useUrlFilters 写地址并即时更新本地条件；活动标签同步浏览器参数，
 * 隐藏标签保留自己的条件。尾斜杠与壳的标签身份采用同样的比较口径。 */
export function useOpeningFilters(): [OpeningFilters, (next: Partial<OpeningFilters>) => void] {
  const [urlFilters, setUrlFilters] = useUrlFilters(defaults);
  const { active, key } = useTab();
  const [filters, setFilters] = useState<OpeningFilters>(urlFilters);
  const browserSearch =
    active && tabPath(window.location.pathname) === tabPath(key) ? window.location.search : null;
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
      if (active && tabPath(window.location.pathname) === tabPath(key))
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
