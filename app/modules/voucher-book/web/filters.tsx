import { useId, useRef, useSyncExternalStore } from 'react';
import { useSearchParams } from 'react-router';
import { Alert, Button, Checkbox, Form, Input, Select, Space } from 'antd';
import { useTab, useVoucherTypes } from '@caiwu/web-kit';
import { VOUCHER_STATUS_LABELS } from '@caiwu/core';
import { BookFilterSchema } from '../shared';

const defaults = {
  period: '',
  periodTo: '',
  dateFrom: '',
  dateTo: '',
  type: '',
  status: '',
  numberFrom: '',
  numberTo: '',
  account: '',
  amountFrom: '',
  amountTo: '',
  summary: '',
  creator: '',
  voided: false,
  page: '1',
  size: '30',
  id: '',
  conditions: '',
  scope: '',
  level: '',
  foreign: '',
};
export type UrlFilters = typeof defaults;
export function useBookFilters() {
  const [scopedParams, setParams] = useSearchParams();
  const tab = useTab();
  const lastSearch = useRef(scopedParams.toString());
  // W0 壳的同路径导航会更新地址，但 useUrlFilters 得到的标签页 location 滞后。
  // 模块内观察原生当前历史条目；不修改全局 history，也不修改共享层。
  const subscribe = (changed: () => void) => {
    const navigation = (window as Window & { navigation?: EventTarget }).navigation;
    const ownsPath = () =>
      window.location.pathname === '/m/voucher-book' ||
      window.location.pathname.startsWith('/m/voucher-book/');
    const onPop = (event: PopStateEvent) => {
      if (ownsPath()) {
        // W0 TitleOnMount 在同路径 POP 时反复更新父标签标题。完整重载保留 URL
        // 与 sessionStorage，并让浏览器原生后退/前进可用；不改共享壳或 history。
        event.stopImmediatePropagation();
        window.location.reload();
      } else changed();
    };
    window.addEventListener('popstate', onPop, true);
    window.addEventListener('voucher-book-search', changed);
    const onEntry = (event: Event) => {
      if (
        (event as Event & { navigationType?: string }).navigationType === 'traverse' &&
        ownsPath()
      ) {
        event.stopImmediatePropagation();
        window.location.reload();
      } else changed();
    };
    navigation?.addEventListener('currententrychange', onEntry);
    return () => {
      window.removeEventListener('popstate', onPop, true);
      window.removeEventListener('voucher-book-search', changed);
      navigation?.removeEventListener('currententrychange', onEntry);
    };
  };
  const search = useSyncExternalStore(subscribe, () =>
    tab.active && window.location.pathname.replace(/\/$/, '') === tab.key.replace(/\/$/, '')
      ? window.location.search.slice(1)
      : lastSearch.current,
  );
  lastSearch.current = search;
  const params = new URLSearchParams(search);
  const values = { ...defaults };
  for (const [key, value] of params) {
    if (key === 'voided') values.voided = value === '1' || value === 'true';
    else if (key in values) (values as Record<string, string | boolean>)[key] = value;
  }
  const set = (next: Partial<UrlFilters>) => {
    const p = new URLSearchParams(search);
    for (const [k, v] of Object.entries(next)) {
      if (v === '' || v === undefined || v === false) p.delete(k);
      else p.set(k, v === true ? '1' : String(v));
    }
    setParams(p);
    window.dispatchEvent(new Event('voucher-book-search'));
  };
  const num = (v: string) => (v === '' ? undefined : Number(v));
  let conditionData: unknown = [];
  let syntaxError = '';
  try {
    conditionData = values.conditions ? (JSON.parse(values.conditions) as unknown) : [];
  } catch {
    syntaxError = '综合查询条件必须是有效 JSON 数组，查询未执行';
  }
  const page = Number(values.page),
    size = Number(values.size);
  const result = BookFilterSchema.safeParse({
    id: num(values.id),
    periodFrom: num(values.period),
    periodTo: num(values.periodTo || values.period),
    dateFrom: values.dateFrom || undefined,
    dateTo: values.dateTo || undefined,
    voucherTypeId: num(values.type),
    statuses: values.status ? [values.status] : undefined,
    numberFrom: num(values.numberFrom),
    numberTo: num(values.numberTo),
    accountCode: values.account || undefined,
    amountFrom: num(values.amountFrom),
    amountTo: num(values.amountTo),
    summaryContains: values.summary || undefined,
    createdBy: num(values.creator),
    includeVoided: values.voided,
    limit: size,
    offset: (page - 1) * size,
    conditions: conditionData,
  });
  const error =
    syntaxError ||
    ([...params.keys()].some((k) => !(k in defaults))
      ? '地址栏含未支持的查询字段，请检查链接'
      : '') ||
    (params.has('voided') && !['0', '1', 'true', 'false'].includes(params.get('voided')!)
      ? '含作废参数必须为0或1'
      : '') ||
    (values.scope && !['filter', 'all', 'unposted', 'posted'].includes(values.scope)
      ? '凭证范围参数非法'
      : '') ||
    (values.level && !['root', 'leaf'].includes(values.level) ? '汇总级次参数非法' : '') ||
    (values.foreign && !['0', '1'].includes(values.foreign) ? '原币展开参数非法' : '') ||
    (!Number.isSafeInteger(page) || page < 1 ? '页码必须是正整数' : '') ||
    (!result.success ? result.error.issues.map((i) => i.message).join('；') : '');
  return { values, set, error, filter: result.success && !error ? result.data : null };
}
export function Filters({
  values,
  set,
  error,
}: {
  values: UrlFilters;
  set: (v: Partial<UrlFilters>) => void;
  error: string;
}) {
  const types = useVoucherTypes();
  const formId = useId();
  return (
    <>
      <Form<UrlFilters>
        name={`voucher-book-filters-${formId}`}
        layout="inline"
        className="cw-filter-bar"
        key={JSON.stringify(values)}
        initialValues={values}
        onFinish={(v) => set({ ...v, page: '1', id: '' })}
      >
        <Form.Item name="period" label="期间">
          <Input placeholder="202601" style={{ width: 105 }} />
        </Form.Item>
        <Form.Item name="periodTo" label="至期间">
          <Input placeholder="同起点" style={{ width: 105 }} />
        </Form.Item>
        <Form.Item name="dateFrom" label="日期起">
          <Input type="date" />
        </Form.Item>
        <Form.Item name="dateTo" label="日期止">
          <Input type="date" />
        </Form.Item>
        <Form.Item name="type" label="凭证类型">
          <Select
            allowClear
            style={{ width: 110 }}
            options={types.map((t) => ({ value: String(t.id), label: t.code }))}
          />
        </Form.Item>
        <Form.Item name="status" label="状态">
          <Select
            allowClear
            style={{ width: 110 }}
            options={Object.entries(VOUCHER_STATUS_LABELS).map(([value, label]) => ({
              value,
              label,
            }))}
          />
        </Form.Item>
        <Form.Item name="numberFrom" label="编号起">
          <Input style={{ width: 85 }} />
        </Form.Item>
        <Form.Item name="numberTo" label="编号止">
          <Input style={{ width: 85 }} />
        </Form.Item>
        <Form.Item name="account" label="科目含下级">
          <Input style={{ width: 120 }} />
        </Form.Item>
        <Form.Item name="amountFrom" label="金额起（分）">
          <Input style={{ width: 110 }} />
        </Form.Item>
        <Form.Item name="amountTo" label="金额止（分）">
          <Input style={{ width: 110 }} />
        </Form.Item>
        <Form.Item name="summary" label="摘要">
          <Input data-voucher-summary="true" style={{ width: 170 }} />
        </Form.Item>
        <Form.Item name="creator" label="制单人ID">
          <Input style={{ width: 90 }} />
        </Form.Item>
        <Form.Item name="voided" valuePropName="checked">
          <Checkbox>含作废</Checkbox>
        </Form.Item>
        <Form.Item
          name="conditions"
          label="综合查询"
          tooltip="所有条件同时满足；编号和金额（分）使用整数，日期使用有效年月日。"
        >
          <ConditionEditor />
        </Form.Item>
        <Form.Item>
          <Button type="primary" htmlType="submit">
            查询
          </Button>
          <Button onClick={() => set(defaults)}>重置</Button>
        </Form.Item>
      </Form>
      {error && (
        <Alert type="error" title="查询条件有误，未执行查询" description={error} showIcon />
      )}
    </>
  );
}

type Condition = { field: string; operator: string; value: string };
function ConditionEditor({
  value = '',
  onChange,
}: {
  value?: string;
  onChange?: (value: string) => void;
}) {
  let rows: Condition[];
  try {
    const parsed: unknown = value ? (JSON.parse(value) as unknown) : [];
    if (
      !Array.isArray(parsed) ||
      !parsed.every(
        (r) =>
          r != null && typeof r === 'object' && 'field' in r && 'operator' in r && 'value' in r,
      )
    )
      throw new Error();
    rows = parsed as Condition[];
  } catch {
    return (
      <Alert
        type="error"
        title="地址栏中的综合条件有误"
        action={<Button onClick={() => onChange?.('')}>清空后重选条件</Button>}
      />
    );
  }
  const change = (next: Condition[]) => onChange?.(next.length ? JSON.stringify(next) : '');
  const update = (i: number, next: Partial<Condition>) =>
    change(rows.map((r, n) => (n === i ? { ...r, ...next } : r)));
  return (
    <Space orientation="vertical">
      {rows.map((r, i) => (
        <Space key={i} wrap>
          <Select
            aria-label={`综合查询字段${i + 1}`}
            style={{ width: 120 }}
            value={r.field}
            onChange={(field) => update(i, { field })}
            options={[
              { value: 'date', label: '凭证日期' },
              { value: 'number', label: '凭证编号' },
              { value: 'amount', label: '金额（分）' },
              { value: 'summary', label: '分录摘要' },
              { value: 'creator', label: '制单人名称' },
            ]}
          />
          <Select
            aria-label={`综合查询操作${i + 1}`}
            style={{ width: 110 }}
            value={r.operator}
            onChange={(operator) => update(i, { operator })}
            options={[
              { value: 'eq', label: '等于' },
              { value: 'ne', label: '不等于' },
              { value: 'gte', label: '大于等于' },
              { value: 'lte', label: '小于等于' },
              {
                value: 'contains',
                label: '含有',
                disabled: !['summary', 'creator'].includes(r.field),
              },
              {
                value: 'notContains',
                label: '不含有',
                disabled: !['summary', 'creator'].includes(r.field),
              },
            ]}
          />
          <Input
            aria-label={`综合查询值${i + 1}`}
            style={{ width: 170 }}
            type={r.field === 'date' ? 'date' : 'text'}
            value={r.value}
            onChange={(e) => update(i, { value: e.target.value })}
          />
          <Button onClick={() => change(rows.filter((_, n) => n !== i))}>移除</Button>
        </Space>
      ))}
      <Button
        disabled={rows.length >= 20}
        onClick={() => change([...rows, { field: 'summary', operator: 'contains', value: '' }])}
      >
        添加查询条件
      </Button>
    </Space>
  );
}
