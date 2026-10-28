import { useEffect, useRef, useState } from 'react';
import { useUrlFilters } from '@caiwu/ui';
import type { Settings } from '../shared';

type Filters = {
  from: string;
  to: string;
  codeFrom: string;
  codeTo: string;
  currency: string;
  dims: string;
  includeUnposted: boolean;
  onlyActivity: boolean;
  level: number;
  expanded: string;
  dimension: string;
  dimensionFrom: string;
  dimensionTo: string;
  dimensionChildren: boolean;
  dimensionLevel: number;
  dimensionOrder: string;
};

/**
 * W0 标签页的路由 transition 可能延迟提交，地址栏已变但 location 仍旧。
 * 模块内立即应用同一份筛选快照，同时仍由 useUrlFilters 写地址；每次写入全量
 * 筛选以免延迟的 location 导致连续点击覆盖前一个条件。无需改共享路由。
 */
export function useBalanceFilters(
  settings: Settings,
  auxiliary = false,
): [Filters, (patch: Partial<Filters>) => void] {
  const [url, setUrl] = useUrlFilters<Filters>({
    from: '',
    to: '',
    codeFrom: '',
    codeTo: '',
    currency: '',
    dims: '{}',
    includeUnposted: false,
    onlyActivity: settings.display.onlyActivity,
    level: settings.display.level,
    expanded: '',
    dimension: auxiliary ? 'project' : '',
    dimensionFrom: '',
    dimensionTo: '',
    dimensionChildren: settings.display.dimensionChildren ?? false,
    dimensionLevel: settings.display.dimensionLevel ?? 0,
    dimensionOrder: settings.display.dimensionOrder ?? 'dimension',
  });
  const [filters, setFilters] = useState(url);
  const latest = useRef(filters);
  useEffect(() => {
    latest.current = url;
    setFilters(url);
  }, [url]);
  return [
    filters,
    (patch) => {
      const next = { ...latest.current, ...patch };
      latest.current = next;
      setFilters(next);
      setUrl(next);
    },
  ];
}
