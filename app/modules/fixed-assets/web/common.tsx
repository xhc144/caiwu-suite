import { Select, Popconfirm, Button, Alert } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { queryClient } from '@caiwu/web-kit';
import { api } from './api';
import { useEffect, useState, type ReactNode } from 'react';
import { useUrlFilters as useCoreUrlFilters } from '@caiwu/ui';
export const refresh = () => queryClient.invalidateQueries({ queryKey: api.pathKey() });
export function MasterSelect({
  kind,
  value,
  onChange,
  id,
}: {
  kind: string;
  value?: number;
  onChange?: (v: number) => void;
  id?: string;
}) {
  const { data = [] } = useQuery(api.masters.queryOptions());
  return (
    <Select
      id={id}
      aria-label={
        id
          ? undefined
          : ({ category: '类别', purpose: '用途', status: '状态', reason: '注销原因' }[kind] ??
            '基础档案')
      }
      value={value}
      onChange={onChange}
      showSearch={{ optionFilterProp: 'label' }}
      options={data
        .filter((m) => m.kind === kind && !m.disabled)
        .map((m) => ({ value: m.id, label: `${m.code} ${m.name}` }))}
    />
  );
}
export function Confirm({
  title,
  onConfirm,
  children,
  danger = false,
}: {
  title: string;
  onConfirm: () => unknown;
  children: ReactNode;
  danger?: boolean;
}) {
  return (
    <Popconfirm title={title} onConfirm={() => void onConfirm()} okText="确认" cancelText="取消">
      <Button danger={danger} size="small">
        {children}
      </Button>
    </Popconfirm>
  );
}
export function EmptyError({ error }: { error: { message: string } | null }) {
  return error ? <Alert type="error" title={error.message} showIcon /> : null;
}

/** 查询条件立即应用于当前标签页，同时使用壳提供的 URL 筛选接口持久化。 */
export function useAssetFilters<V extends Record<string, string | number | boolean | undefined>>(
  defaults: V,
): [V, (next: Partial<V>) => void] {
  const [urlFilters, writeUrl] = useCoreUrlFilters(defaults);
  const [filters, setFilters] = useState(urlFilters);
  useEffect(() => setFilters(urlFilters), [urlFilters]);
  return [
    filters,
    (next) => {
      setFilters((prev) => ({ ...prev, ...next }));
      writeUrl(next);
    },
  ];
}
