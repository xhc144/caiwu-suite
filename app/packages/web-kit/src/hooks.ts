import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { Account, DimensionItem, DimensionTypeId, PeriodInfo } from '@caiwu/core';
import { coreApi } from './client';

// 常用的基础资料。都有缓存，多个组件同时用只请求一次。

export function useAccounts() {
  const q = useQuery({ ...coreApi.accounts.list.queryOptions(), staleTime: 60_000 });
  const byId = useMemo(() => new Map((q.data ?? []).map((a) => [a.id, a])), [q.data]);
  const byCode = useMemo(() => new Map((q.data ?? []).map((a) => [a.code, a])), [q.data]);
  return { accounts: (q.data ?? []) as Account[], byId, byCode, loading: q.isLoading, query: q };
}

export function useDimensionItems(type?: DimensionTypeId) {
  const q = useQuery({ ...coreApi.dimensions.items.queryOptions({ type }), staleTime: 60_000 });
  const byId = useMemo(() => new Map((q.data ?? []).map((d) => [d.id, d])), [q.data]);
  return { items: (q.data ?? []) as DimensionItem[], byId, loading: q.isLoading };
}

export function usePeriods() {
  const q = useQuery({ ...coreApi.periods.list.queryOptions(), staleTime: 30_000 });
  return { periods: (q.data ?? []) as PeriodInfo[], loading: q.isLoading };
}

export function useCurrentPeriod() {
  return useQuery(coreApi.periods.current.queryOptions()).data ?? null;
}

export function useVoucherTypes() {
  return (
    useQuery({ ...coreApi.reference.voucherTypes.queryOptions(), staleTime: 300_000 }).data ?? []
  );
}

export function useBootstrap() {
  return useQuery({ ...coreApi.bootstrap.queryOptions(), staleTime: Infinity }).data ?? null;
}
