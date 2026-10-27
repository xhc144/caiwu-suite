import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router';
import { Alert, Button, Checkbox, Form, Input, Select, Space } from 'antd';
import { useVoucherTypes } from '@caiwu/web-kit';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { amountToForm, amountToUrl, conditionAmounts, queryProblem } from './amount-filters';
import { VOUCHER_STATUS_LABELS } from '@caiwu/core';
import { BookFilterSchema, ConditionSchema } from '../shared';
import { userError } from './errors';

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
  // 查询条件跟随壳提供的标签页路由上下文；历史导航保持组件和未提交表单。
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const owner = useId();
  const sequence = useRef(0);
  const epoch = useRef(0);
  const [historyVersion, setHistoryVersion] = useState(0);
  useEffect(() => {
    // POP 是重新应用历史条件，即使目标曾由本表单提交，也不是待确认的提交。
    const onPop = () => {
      epoch.current++;
      // Router可能在原生POP回调之前提交。显式触发本目标页再次同步，隐藏页不动草稿。
      if (window.location.pathname.replace(/\/$/, '') === location.pathname.replace(/\/$/, ''))
        setHistoryVersion(epoch.current);
    };
    window.addEventListener('popstate', onPop, true);
    return () => window.removeEventListener('popstate', onPop, true);
  }, [location.pathname]);
  const values = { ...defaults };
  for (const [key, value] of params) {
    if (key === 'voided') values.voided = value === '1' || value === 'true';
    else if (key in values) (values as Record<string, string | boolean>)[key] = value;
  }
  const set = (next: Partial<UrlFilters>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) {
      if (v === '' || v === undefined || v === false) p.delete(k);
      else p.set(k, v === true ? '1' : String(v));
    }
    const commit = { owner, epoch: epoch.current, sequence: ++sequence.current };
    setParams(p, { state: { ...location.state, voucherBookFilterCommit: commit } });
  };
  const isOwnCommit = () => {
    const state = location.state as {
      voucherBookFilterCommit?: { owner: string; epoch: number; sequence: number };
    } | null;
    const commit = state?.voucherBookFilterCommit;
    return (
      !!commit &&
      commit.owner === owner &&
      commit.epoch === epoch.current &&
      commit.sequence > 0 &&
      commit.sequence <= sequence.current
    );
  };
  const num = (v: string) => (v === '' ? undefined : Number(v));
  let conditionData: unknown = [];
  let syntaxError = '';
  try {
    conditionData = values.conditions ? (JSON.parse(values.conditions) as unknown) : [];
  } catch {
    syntaxError = '综合查询条件格式有误，请清空后重新选择，查询未执行';
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
    ([values.amountFrom, values.amountTo].some((value) => value !== '' && !/^-?\d+$/.test(value))
      ? '金额查询条件无效，请在筛选栏重新输入金额'
      : '') ||
    (values.scope && !['filter', 'all', 'unposted', 'posted'].includes(values.scope)
      ? '凭证范围参数非法'
      : '') ||
    (values.level && !['root', 'leaf'].includes(values.level) ? '汇总级次参数非法' : '') ||
    (values.foreign && !['0', '1'].includes(values.foreign) ? '原币展开参数非法' : '') ||
    (!Number.isSafeInteger(page) || page < 1 ? '页码必须是正整数' : '') ||
    (!result.success ? result.error.issues.map(queryProblem).join('；') : '');
  return {
    values,
    set,
    error,
    isOwnCommit,
    historyVersion,
    filter: result.success && !error ? result.data : null,
  };
}
const formKeys = [
  'period',
  'periodTo',
  'dateFrom',
  'dateTo',
  'type',
  'status',
  'numberFrom',
  'numberTo',
  'account',
  'amountFrom',
  'amountTo',
  'summary',
  'creator',
  'voided',
  'conditions',
] as const;
export function Filters({
  values,
  set,
  error,
  isOwnCommit,
  historyVersion,
}: {
  values: UrlFilters;
  set: (v: Partial<UrlFilters>) => void;
  error: string;
  isOwnCommit: () => boolean;
  historyVersion: number;
}) {
  const types = useVoucherTypes();
  const creators = useQuery(api.creators.queryOptions());
  const formValues = useMemo(() => {
    const result = {
      ...values,
      amountFrom: amountToForm(values.amountFrom),
      amountTo: amountToForm(values.amountTo),
    };
    try {
      result.conditions = conditionAmounts(values.conditions, amountToForm);
    } catch {
      /* 查询和条件编辑器呈现错误 */
    }
    return result;
  }, [values]);
  const validateMoney = async (_rule: unknown, value: string) => {
    amountToUrl(value ?? '');
  };
  const validateConditions = async (_rule: unknown, value: string) => {
    const converted = conditionAmounts(value ?? '', amountToUrl);
    const rows: unknown = converted ? JSON.parse(converted) : [];
    const result = BookFilterSchema.safeParse({ conditions: rows });
    if (!result.success) throw new Error(result.error.issues.map(queryProblem).join('；'));
  };
  const formId = useId();
  const [form] = Form.useForm<UrlFilters>();
  const [draft, setDraft] = useState<Partial<UrlFilters>>(formValues);
  const applied = JSON.stringify([values, historyVersion]);
  const previous = useRef(applied);
  useLayoutEffect(() => {
    const ownCommit = isOwnCommit();
    if (previous.current === applied) return;
    previous.current = applied;
    // 本次查询的导航确认只更新已应用条件，不能覆盖提交后继续编辑的草稿。
    // 真正改变条件的外部导航/历史导航同步表单，但保持同一Form及抽屉生命周期。
    if (!ownCommit) {
      form.setFieldsValue(formValues);
      setDraft(formValues);
    }
  }, [applied, formValues, form, isOwnCommit]);
  const dirty = formKeys.some((key) => (draft[key] ?? defaults[key]) !== formValues[key]);
  return (
    <>
      <Form<UrlFilters>
        name={`voucher-book-filters-${formId}`}
        layout="inline"
        className="cw-filter-bar"
        form={form}
        initialValues={formValues}
        onValuesChange={(_, all: UrlFilters) => setDraft(all)}
        onFinish={(v) =>
          set({
            ...v,
            amountFrom: amountToUrl(v.amountFrom ?? ''),
            amountTo: amountToUrl(v.amountTo ?? ''),
            conditions: conditionAmounts(v.conditions ?? '', amountToUrl),
            page: '1',
            id: '',
          })
        }
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
        <Form.Item name="amountFrom" label="金额起（元）" rules={[{ validator: validateMoney }]}>
          <Input inputMode="decimal" onFocus={(e) => e.target.select()} style={{ width: 110 }} />
        </Form.Item>
        <Form.Item name="amountTo" label="金额止（元）" rules={[{ validator: validateMoney }]}>
          <Input inputMode="decimal" onFocus={(e) => e.target.select()} style={{ width: 110 }} />
        </Form.Item>
        <Form.Item name="summary" label="摘要">
          <Input data-voucher-summary="true" style={{ width: 170 }} />
        </Form.Item>
        <Form.Item name="creator" label="制单人">
          <Select
            aria-label="制单人"
            allowClear
            showSearch={{ optionFilterProp: 'label' }}
            style={{ width: 190 }}
            loading={creators.isPending}
            options={[
              ...(creators.data ?? []).map((u) => ({
                value: String(u.id),
                label: `${u.name}（${u.code}${u.disabled ? '，已停用' : ''}）`,
              })),
              ...(formValues.creator &&
              !creators.data?.some((u) => String(u.id) === formValues.creator)
                ? [
                    {
                      value: formValues.creator,
                      label: creators.isPending
                        ? '正在读取制单人…'
                        : creators.isError
                          ? '制单人读取失败'
                          : '制单人已不存在，请重新选择',
                    },
                  ]
                : []),
            ]}
            notFoundContent={
              creators.isPending
                ? '正在读取制单人…'
                : creators.isError
                  ? '读取失败，请刷新重试'
                  : '没有匹配的制单人'
            }
          />
        </Form.Item>
        <Form.Item name="voided" valuePropName="checked">
          <Checkbox>含作废</Checkbox>
        </Form.Item>
        <Form.Item
          name="conditions"
          label="综合查询"
          tooltip="所有条件同时满足；金额按元输入，日期使用有效年月日。"
          rules={[{ validator: validateConditions }]}
        >
          <ConditionEditor />
        </Form.Item>
        <Form.Item>
          <Button type="primary" htmlType="submit">
            查询
          </Button>
          <Button
            onClick={() => {
              form.setFieldsValue(defaults);
              setDraft(defaults);
              set(defaults);
            }}
          >
            重置
          </Button>
        </Form.Item>
      </Form>
      {creators.isError && (
        <Alert
          type="warning"
          title="无法读取制单人"
          description={userError(creators.error, '请检查本地服务后重试')}
          action={<Button onClick={() => void creators.refetch()}>重试</Button>}
        />
      )}
      {dirty && (
        <Alert
          type="info"
          showIcon
          title="筛选条件已修改，尚未查询"
          description={`当前结果仍按已应用条件显示；已应用摘要：${values.summary || '不限'}。点击查询应用新条件。`}
        />
      )}
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
          r != null &&
          typeof r === 'object' &&
          'field' in r &&
          'operator' in r &&
          'value' in r &&
          ConditionSchema.shape.field.safeParse(r.field).success &&
          ConditionSchema.shape.operator.safeParse(r.operator).success &&
          typeof r.value === 'string',
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
              { value: 'amount', label: '金额（元）' },
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
            onFocus={(e) => {
              if (r.field === 'amount') e.target.select();
            }}
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
